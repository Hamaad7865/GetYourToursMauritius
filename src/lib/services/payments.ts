import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { paymentCreateResultSchema, type PaymentLink } from '@/lib/validation/booking';
import { getUsdRate } from '@/lib/money/fx';

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

  // The Mauritius card acquirer settles in USD (not EUR/MUR), so convert the EUR booking total to
  // USD at charge time — whole dollars, matching the on-site USD display. The ledger stays in EUR:
  // a successful full settlement confirms the EUR-denominated payment.
  const chargeCurrency = 'USD';
  const rate = await getUsdRate();
  const chargeAmount = Math.round((payment.amountMinor / 100) * rate);
  const session = await ctx.payments.createCheckout({
    bookingRef: payment.bookingRef,
    amount: chargeAmount,
    currency: chargeCurrency,
    customerEmail: payment.customerEmail,
    description: `Belle Mare Tours booking ${payment.bookingRef}`,
    returnUrl: input.returnUrl,
  });

  // Persist what the card was actually charged (USD, minor units) so the receipt/invoice can show
  // the real billed amount rather than the EUR ledger figure. Best-effort: the checkout already
  // succeeded, so a failure here must never strand the customer — log and continue.
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
