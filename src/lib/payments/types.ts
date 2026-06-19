/**
 * Payment provider interface. The concrete Peach Payments implementation and a
 * deterministic stub both satisfy this, so booking/payment logic and tests never
 * depend on a real account. Currency is EUR throughout (prices come from the DB).
 */
export interface CreateCheckoutInput {
  /** Our booking reference (idempotency anchor across provider + webhook). */
  bookingRef: string;
  /** Amount to charge, in `currency`'s major units (server-computed from the DB price). */
  amount: number;
  /** ISO-4217 currency to charge in. The Mauritius card acquirer settles in USD, so the EUR booking
   *  total is converted to USD at charge time while the ledger stays in EUR. */
  currency: string;
  customerEmail: string;
  description: string;
  /** Where the hosted checkout redirects the customer back to. */
  returnUrl: string;
}

export interface CheckoutSession {
  /** Provider-side checkout/session id. */
  id: string;
  /**
   * Hosted-checkout URL to redirect the customer to. Present for redirect-style providers (and the
   * dev stub); absent for an embedded widget, which mounts client-side via `checkoutId` instead.
   */
  redirectUrl?: string;
  /** Embedded-checkout instance id — the browser mounts the Peach widget with this. */
  checkoutId?: string;
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
  /**
   * Settled/refunded amount in minor units as reported by the provider, when it can be parsed from
   * the verified payload. `null`/absent means "amount not provided" — the webhook then falls back
   * to the full booking total. A real provider that supports partial captures/refunds MUST set
   * this so the ledger records the true amount (the SQL reducer already handles partials).
   */
  amountMinor?: number | null;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Verifies the webhook signature and normalises the payload. Throws on invalid signature. */
  verifyWebhook(input: VerifyWebhookInput): Promise<PaymentEvent>;
  /**
   * Queries the provider for a checkout's authoritative payment status (by the provider's checkout
   * id). This is the webhook-independent confirmation path: we ask the provider directly rather than
   * trusting an inbound notification, so a booking confirms even when webhooks are unsigned or missed.
   */
  getCheckoutStatus(providerCheckoutId: string): Promise<PaymentEvent>;
}
