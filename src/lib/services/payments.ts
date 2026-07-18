import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { CheckoutPendingError } from './errors';
import { paymentCreateResultSchema, type PaymentLink } from '@/lib/validation/booking';

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
  if (payment.existingCheckoutId) {
    return {
      sessionId: payment.existingCheckoutId,
      checkoutId: payment.existingCheckoutId,
      provider: ctx.payments.name,
    };
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
  try {
    await callRpc(adminCtx, 'api_record_payment_charge', {
      paymentId: payment.paymentId,
      chargedAmountMinor: Math.round(chargeAmount * 100),
      chargedCurrency: chargeCurrency,
    });
  } catch (error) {
    console.error('failed to record payment charge', { paymentId: payment.paymentId, error });
  }

  // Persist the Peach checkout id — REQUIRED, not best-effort (unlike the charge record above). It is
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
  };
}
