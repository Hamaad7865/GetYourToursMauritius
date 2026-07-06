import type { ServiceContext } from './context';
import { callRpc } from './rpc';
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
 */
export async function createPaymentLink(
  ctx: ServiceContext,
  input: CreatePaymentLinkInput,
): Promise<PaymentLink> {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const data = await callRpc(ctx, 'api_create_payment', {
    bookingRef: input.bookingRef,
    idempotencyKey,
  });
  const payment = paymentCreateResultSchema.parse(data);

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
  const session = await ctx.payments.createCheckout({
    bookingRef: payment.bookingRef,
    amount: chargeAmount,
    currency: chargeCurrency,
    customerEmail: payment.customerEmail,
    description: `Belle Mare Tours booking ${payment.bookingRef}`,
    returnUrl: input.returnUrl,
  });

  // Persist what the card was actually charged (EUR, minor units) for the receipt/invoice. Now that we
  // charge EUR it equals the ledger total, but recording it keeps the receipt accurate if the charge
  // currency ever changes again. Best-effort: the checkout already succeeded, so a failure here must
  // never strand the customer — log and continue.
  try {
    await callRpc(ctx, 'api_record_payment_charge', {
      paymentId: payment.paymentId,
      chargedAmountMinor: Math.round(chargeAmount * 100),
      chargedCurrency: chargeCurrency,
    });
  } catch (error) {
    console.error('failed to record payment charge', { paymentId: payment.paymentId, error });
  }

  // Persist the Peach checkout id so a later server-side reconciliation sweep can re-query the payment's
  // status. Best-effort like the charge record above: the checkout already succeeded, so a failure here
  // must never strand the customer — log (no PII) and continue.
  try {
    await callRpc(ctx, 'api_record_payment_checkout', {
      paymentId: payment.paymentId,
      checkoutId: session.checkoutId,
    });
  } catch (error) {
    console.error('failed to record payment checkout id', { paymentId: payment.paymentId, error });
  }

  return {
    sessionId: session.id,
    redirectUrl: session.redirectUrl,
    checkoutId: session.checkoutId,
    provider: session.provider,
  };
}
