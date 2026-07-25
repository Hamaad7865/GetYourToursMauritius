import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { CheckoutPendingError } from './errors';
import { paymentCreateResultSchema, type PaymentLink } from '@/lib/validation/booking';

/**
 * Can this already-minted checkout still take the customer's money?
 *
 * FAIL SAFE, in the money sense: anything short of the provider explicitly declaring the session
 * closed counts as payable, so we reuse it. Minting a replacement while the original is still live
 * would leave TWO payable sessions for one booking — the exact double-charge the reuse guard exists
 * to prevent — so an unreachable provider, an unrecognised status or a paid/pending session all keep
 * the existing one. The cost of being wrong here is one extra provider round-trip on retry; the cost
 * of being wrong the other way is charging the card twice.
 */
async function isCheckoutStillPayable(ctx: ServiceContext, checkoutId: string): Promise<boolean> {
  try {
    const status = await ctx.payments.getCheckoutStatus(checkoutId);
    return status.checkoutTerminal !== true;
  } catch (error) {
    console.error('checkout liveness query failed — reusing the existing session', {
      checkoutId,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return true;
  }
}

export interface CreatePaymentLinkInput {
  bookingRef: string;
  /** Where the hosted checkout redirects back to after payment. */
  returnUrl: string;
  idempotencyKey?: string;
}

/**
 * Creates a payment for a booking and a hosted-checkout link. The amount comes
 * only from the DB (api_create_payment reads the booking total); the model/client
 * never supplies it. Confirmation happens later via the verified webhook.
 *
 * `adminCtx` (service-role rpc port) is REQUIRED for the two post-checkout writes:
 * api_record_payment_charge / api_record_payment_checkout are locked to service_role, because their
 * values (what the card was charged; which checkout the reconcile sweep queries) are server-derived
 * facts — an authenticated booking owner must not be able to falsify their own invoice's charge or the
 * sweep's checkout pointer. `ctx` stays the CALLER's context so api_create_payment keeps enforcing
 * booking ownership on the caller's identity. The route passes serviceRoleRpcContext().
 */
export async function createPaymentLink(
  ctx: ServiceContext,
  input: CreatePaymentLinkInput,
  adminCtx: ServiceContext,
): Promise<PaymentLink> {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();

  // Overlap the provider's cold-start with our own DB work. Peach needs an OAuth token from a
  // separate host before it will mint a checkout — 1.0-1.8s on a cold edge isolate, and it depends on
  // nothing below — so starting it here makes the customer wait for the SLOWER of {token, DB} rather
  // than for both in sequence. Non-blocking and never throws.
  ctx.payments.prewarm?.();

  let data = await callRpc(ctx, 'api_create_payment', {
    bookingRef: input.bookingRef,
    idempotencyKey,
  });
  let payment = paymentCreateResultSchema.parse(data);

  // Single-flight: another request holds the checkout lease (two tabs / a double-click racing).
  // The winner records its session id within a second or two of getting it from Peach, so ONE short
  // in-place re-check resolves the common race into a clean reuse; if the lease is still held after
  // that, surface checkout_pending (409) and let the caller retry the POST.
  if (payment.checkoutPending) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    data = await callRpc(ctx, 'api_create_payment', {
      bookingRef: input.bookingRef,
      idempotencyKey,
    });
    payment = paymentCreateResultSchema.parse(data);
    if (payment.checkoutPending) throw new CheckoutPendingError();
  }

  // Double-charge guard: if the DB already has a still-fresh checkout for this pending payment (the
  // customer hit back/reload and is paying again before the webhook confirmed), REUSE that same Peach
  // session instead of minting a second one. A completed session can't be re-charged, so this prevents
  // charging the card twice. api_create_payment only surfaces a recent (<25 min) checkout id.
  //
  // ...but ONLY while that session can still be paid. A customer who abandons the widget leaves it
  // CLOSED at Peach, and reusing a closed session trapped them for good: the widget reported
  // "cancelled" the moment it mounted and bounced them back to their booking page, where the only
  // affordance was the button that had just handed them the same corpse (production 2026-07-24,
  // booking BMTE5CAD9FB1A5E3). Ask the provider first, and retire a session it declares dead.
  if (payment.existingCheckoutId) {
    if (await isCheckoutStillPayable(ctx, payment.existingCheckoutId)) {
      return {
        sessionId: payment.existingCheckoutId,
        checkoutId: payment.existingCheckoutId,
        provider: ctx.payments.name,
      };
    }

    // Compare-and-clear (service-role): retires the dead pointer ONLY if it is still the stored one,
    // so a concurrent request that already minted a replacement doesn't lose its live session.
    await callRpc(adminCtx, 'api_clear_payment_checkout', {
      paymentId: payment.paymentId,
      checkoutId: payment.existingCheckoutId,
    });

    // Re-enter: with the pointer cleared this call takes the CLAIM path, so minting the replacement
    // still happens under the single-flight lease (never two payable sessions).
    data = await callRpc(ctx, 'api_create_payment', {
      bookingRef: input.bookingRef,
      idempotencyKey,
    });
    payment = paymentCreateResultSchema.parse(data);
    if (payment.checkoutPending) throw new CheckoutPendingError();
    // Another request won the race and minted a fresh session while we were clearing — use theirs
    // rather than opening a second one.
    if (payment.existingCheckoutId) {
      return {
        sessionId: payment.existingCheckoutId,
        checkoutId: payment.existingCheckoutId,
        provider: ctx.payments.name,
      };
    }
  }

  // Peach now accepts EUR on the card (enabled 2026-06-24), so we charge the EUR booking total directly
  // — no FX conversion, and the card statement matches the price shown. The ledger is already EUR, so a
  // successful full settlement confirms it cleanly. (Alt methods like MCB Juice / Maucus are MUR-only and
  // aren't offered here.)
  const chargeCurrency = 'EUR';
  const chargeAmount = payment.amountMinor / 100;
  let session;
  try {
    session = await ctx.payments.createCheckout({
      bookingRef: payment.bookingRef,
      amount: chargeAmount,
      currency: chargeCurrency,
      customerEmail: payment.customerEmail,
      description: `Belle Mare Tours booking ${payment.bookingRef}`,
      returnUrl: input.returnUrl,
    });
  } catch (error) {
    // We hold the single-flight lease; hand it back so the customer's retry doesn't have to sit out
    // the rest of the 90-second window. Best-effort — the lease expiry covers a failure here too.
    try {
      await callRpc(adminCtx, 'api_release_checkout_claim', { paymentId: payment.paymentId });
    } catch {
      /* lease expiry is the backstop */
    }
    throw error;
  }

  // Persist what the card was actually charged (EUR, minor units) for the receipt/invoice. Now that we
  // charge EUR it equals the ledger total, but recording it keeps the receipt accurate if the charge
  // currency ever changes again. Best-effort: the checkout already succeeded, so a failure here must
  // never strand the customer — log and continue.
  //
  // Started HERE but awaited BELOW, alongside the checkout-id write: the two are independent writes
  // that the customer is sitting and waiting on, and running them back-to-back spent a whole extra
  // network round-trip on the critical path for no reason.
  const chargeRecorded = callRpc(adminCtx, 'api_record_payment_charge', {
    paymentId: payment.paymentId,
    chargedAmountMinor: Math.round(chargeAmount * 100),
    chargedCurrency: chargeCurrency,
  }).catch((error: unknown) => {
    console.error('failed to record payment charge', { paymentId: payment.paymentId, error });
  });

  // Persist the Peach checkout id — REQUIRED, not best-effort (unlike the charge record above). It is
  // what (a) lets the reconciliation sweep re-query this payment's status, and (b) makes a retry of
  // api_create_payment REUSE this same session (existingCheckoutId) instead of minting a SECOND payable
  // one once the 90-second single-flight lease expires. If it can't be recorded, the one-payable-session
  // invariant is broken, so we must NOT hand back a session the system can no longer track: release the
  // lease and fail closed. The customer's retry then mints — or, if the id did land but only the ack was
  // lost, reuses — a properly-recorded session. The orphaned Peach session is harmless: it is never
  // returned to the customer, so it is never paid, and it expires on its own.
  try {
    await Promise.all([
      callRpc(adminCtx, 'api_record_payment_checkout', {
        paymentId: payment.paymentId,
        checkoutId: session.checkoutId,
      }),
      // Already in flight (see above) — joined here so a success never returns with the charge write
      // still outstanding, which on the edge could be torn down with the isolate. It has its own
      // `.catch`, so it can only settle, never reject: the fail-closed branch below stays owned
      // exclusively by the checkout-id write.
      chargeRecorded,
    ]);
  } catch (error) {
    console.error('failed to record payment checkout id — failing closed', {
      paymentId: payment.paymentId,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    try {
      await callRpc(adminCtx, 'api_release_checkout_claim', { paymentId: payment.paymentId });
    } catch {
      /* lease expiry is the backstop */
    }
    // Surface the same 409 the caller already retries on: the lease is now free, so the retry mints a
    // fresh recorded session (or reuses this one if the id actually landed and only the ack was lost).
    throw new CheckoutPendingError();
  }

  return {
    sessionId: session.id,
    redirectUrl: session.redirectUrl,
    checkoutId: session.checkoutId,
    provider: session.provider,
  };
}
