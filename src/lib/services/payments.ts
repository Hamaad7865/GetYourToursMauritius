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
  /**
   * Which money this checkout is for. Defaults to the booking total (the DEPOSIT, for a quote booking).
   *
   * 'pickup_addon' is the transport supplement for a pickup added AFTER the booking was paid — a
   * second payments row on the same booking, whose amount api_request_pickup already wrote from the
   * server-derived fare. 'balance' is the outstanding remainder on a deposit-confirmed quote booking —
   * a further payments row whose amount create_payment sizes from the booking's balance_due_minor. Both
   * are server-derived, never client input. Every guard below (the FX pin, the reuse window, the
   * single-flight lease, the liveness re-query) applies to them unchanged — they are all per-PAYMENT-ROW.
   */
  purpose?: 'booking' | 'pickup_addon' | 'balance';
  /**
   * WHICH ENTRY POINT AUTHORIZES THIS CHECKOUT. Default 'caller' — api_create_payment, which checks
   * that `ctx`'s identity owns the booking (or is staff). That is every customer checkout, and it is
   * deliberately untouched: the public booking ref is not a bearer credential.
   *
   * 'quote' routes to api_create_quote_payment instead, for the one case where there is no identity to
   * check: a quote booking has no user_id because the guest has no account. Authorization there is the
   * emailed LINK TOKEN, verified by resolveQuoteForToken before the route reaches this function, and
   * the RPC is granted to service_role only so nothing reachable from a browser can call it. Both
   * entry points share ONE SQL body, so they take the SAME single-flight checkout lease — the thing
   * that stops a booking having two payable Peach sessions. Every guard below applies unchanged.
   */
  authorizedBy?: 'caller' | 'quote';
}

/**
 * Creates a payment for a booking and a hosted-checkout link. The amount comes
 * only from the DB (api_create_payment reads the booking total); the model/client
 * never supplies it. Confirmation happens later via the verified webhook.
 *
 * THE CHARGE IS PINNED IN SQL, NOT COMPUTED HERE: api_create_payment converts the EUR total to whole
 * MUR rupees at the server-controlled fx_rates rate ONCE per payment row (first-write-wins) and hands
 * the figure back as chargedAmountMinor/chargedCurrency. This function charges exactly that figure —
 * every re-minted session for a payment charges the identical amount, the pay page displays it, and
 * reconcile measures the settlement against it. Do NOT reintroduce a conversion here: a per-session
 * figure at a moved rate would drift from the pinned expectation and quarantine real payments.
 *
 * `adminCtx` (service-role rpc port) is REQUIRED for the post-checkout write:
 * api_record_payment_checkout (and api_clear_payment_checkout above) are locked to service_role,
 * because the checkout pointer the reconcile sweep queries is a server-derived fact — an
 * authenticated booking owner must not be able to falsify it. `ctx` stays the CALLER's context so
 * api_create_payment keeps enforcing booking ownership on the caller's identity. The route passes
 * serviceRoleRpcContext().
 *
 * The ONE exception is `authorizedBy: 'quote'` (see the field's own note): a quote booking has no
 * owner for that check to be about, so the quote pay route — which has already verified the emailed
 * link token — passes the service-role port as BOTH ports and gets api_create_quote_payment. It shares
 * api_create_payment's SQL body, so everything documented above still holds for it.
 */
export async function createPaymentLink(
  ctx: ServiceContext,
  input: CreatePaymentLinkInput,
  adminCtx: ServiceContext,
): Promise<PaymentLink> {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  // ONE decision, made once and reused by all three call sites below — the re-entrant clear-and-retry
  // path must never fall back to the caller-authorized function, or a quote guest would be refused
  // half-way through recovering from a dead session.
  const createPaymentFn =
    input.authorizedBy === 'quote' ? 'api_create_quote_payment' : 'api_create_payment';
  const createPaymentArgs = {
    bookingRef: input.bookingRef,
    idempotencyKey,
    purpose: input.purpose ?? 'booking',
  };

  // Overlap the provider's cold-start with our own DB work. Peach needs an OAuth token from a
  // separate host before it will mint a checkout — 1.0-1.8s on a cold edge isolate, and it depends on
  // nothing below — so starting it here makes the customer wait for the SLOWER of {token, DB} rather
  // than for both in sequence. Non-blocking and never throws.
  ctx.payments.prewarm?.();

  let data = await callRpc(ctx, createPaymentFn, createPaymentArgs);
  let payment = paymentCreateResultSchema.parse(data);

  // Single-flight: another request holds the checkout lease (two tabs / a double-click racing).
  // The winner records its session id within a second or two of getting it from Peach, so ONE short
  // in-place re-check resolves the common race into a clean reuse; if the lease is still held after
  // that, surface checkout_pending (409) and let the caller retry the POST.
  if (payment.checkoutPending) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    data = await callRpc(ctx, createPaymentFn, createPaymentArgs);
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
        // Exact figures: the pin is per-PAYMENT, so a reused session's charge is identical.
        chargeAmountMinor: payment.chargedAmountMinor ?? undefined,
        chargeCurrency: payment.chargedCurrency ?? undefined,
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
    data = await callRpc(ctx, createPaymentFn, createPaymentArgs);
    payment = paymentCreateResultSchema.parse(data);
    if (payment.checkoutPending) throw new CheckoutPendingError();
    // Another request won the race and minted a fresh session while we were clearing — use theirs
    // rather than opening a second one.
    if (payment.existingCheckoutId) {
      return {
        sessionId: payment.existingCheckoutId,
        checkoutId: payment.existingCheckoutId,
        provider: ctx.payments.name,
        chargeAmountMinor: payment.chargedAmountMinor ?? undefined,
        chargeCurrency: payment.chargedCurrency ?? undefined,
      };
    }
  }

  // Charge EXACTLY what the DB pinned (MUR since 2026-07-30 — the live Peach account has no EUR
  // facility). The pinned figure is what every session for this payment charges, what the pay page
  // displays, and what reconcile measures the settlement against — three things that must be one
  // number. The EUR fallback exists only for a legacy pre-cutover row whose pin the migration
  // deliberately left (a settled/terminal booking); a payable legacy row was un-pinned by the
  // cutover fix and re-pins in MUR on this very call.
  const chargeCurrency = payment.chargedCurrency ?? 'EUR';
  const chargeMinor = payment.chargedAmountMinor ?? payment.amountMinor;
  // chargeMinor is whole rupees (a multiple of 100), so /100 is exact and peach.ts's `.toFixed(2)`
  // round-trips byte-identically against what api_create_payment recorded. No float crosses the
  // provider boundary with sub-cent precision.
  const chargeAmount = chargeMinor / 100;
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

  // (The charge record is NOT written here any more: api_create_payment pinned it before this
  // function ever saw the payment — atomically, first-write-wins — so there is nothing best-effort
  // left to fail. api_record_payment_charge still exists for its original callers/tests.)

  // Persist the Peach checkout id — REQUIRED, not best-effort. It is
  // what (a) lets the reconciliation sweep re-query this payment's status, and (b) makes a retry of
  // api_create_payment REUSE this same session (existingCheckoutId) instead of minting a SECOND payable
  // one once the 90-second single-flight lease expires. If it can't be recorded, the one-payable-session
  // invariant is broken, so we must NOT hand back a session the system can no longer track: release the
  // lease and fail closed. The customer's retry then mints — or, if the id did land but only the ack was
  // lost, reuses — a properly-recorded session. The orphaned Peach session is harmless: it is never
  // returned to the customer, so it is never paid, and it expires on its own.
  try {
    await callRpc(adminCtx, 'api_record_payment_checkout', {
      paymentId: payment.paymentId,
      checkoutId: session.checkoutId,
    });
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
    chargeAmountMinor: payment.chargedAmountMinor ?? undefined,
    chargeCurrency: payment.chargedCurrency ?? undefined,
  };
}
