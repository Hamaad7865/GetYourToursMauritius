import type { ServiceContext } from './context';
import { NotImplementedError } from './errors';

export interface CreatePaymentLinkInput {
  bookingRef: string;
  returnUrl: string;
}

export interface PaymentLink {
  sessionId: string;
  redirectUrl: string;
  provider: string;
}

export async function createPaymentLink(
  ctx: ServiceContext,
  input: CreatePaymentLinkInput,
): Promise<PaymentLink> {
  // Phase 4: load the booking, recompute the amount from DB prices, then call
  // ctx.payments.createCheckout(...). The model/client never supplies the amount.
  void ctx;
  throw new NotImplementedError(`createPaymentLink("${input.bookingRef}")`);
}
