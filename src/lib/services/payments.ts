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

  const session = await ctx.payments.createCheckout({
    bookingRef: payment.bookingRef,
    amountEur: payment.amountMinor / 100,
    customerEmail: payment.customerEmail,
    description: `Belle Mare Tours booking ${payment.bookingRef}`,
    returnUrl: input.returnUrl,
  });

  return { sessionId: session.id, redirectUrl: session.redirectUrl, provider: session.provider };
}
