/**
 * Payment provider interface. The concrete Peach Payments implementation and a
 * deterministic stub both satisfy this, so booking/payment logic and tests never
 * depend on a real account. Currency is EUR throughout (prices come from the DB).
 */
export interface CreateCheckoutInput {
  /** Our booking reference (idempotency anchor across provider + webhook). */
  bookingRef: string;
  /** Total to charge, in EUR. Computed server-side from DB prices only. */
  amountEur: number;
  customerEmail: string;
  description: string;
  /** Where the hosted checkout redirects the customer back to. */
  returnUrl: string;
}

export interface CheckoutSession {
  /** Provider-side checkout/session id. */
  id: string;
  /** Hosted checkout URL to redirect the customer to. */
  redirectUrl: string;
  provider: string;
}

export interface VerifyWebhookInput {
  rawBody: string;
  signature: string | null;
  /** Optional extra headers some providers sign over. */
  headers?: Record<string, string>;
}

export type PaymentOutcome = 'paid' | 'failed' | 'pending' | 'refunded' | 'unknown';

export interface PaymentEvent {
  outcome: PaymentOutcome;
  bookingRef: string | null;
  providerReference: string | null;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Verifies the webhook signature and normalises the payload. Throws on invalid signature. */
  verifyWebhook(input: VerifyWebhookInput): Promise<PaymentEvent>;
}
