/**
 * Payment provider interface. The concrete Peach Payments implementation and a
 * deterministic stub both satisfy this, so booking/payment logic and tests never
 * depend on a real account.
 *
 * TWO CURRENCIES, ONE LEDGER: prices and the ledger are EUR (the contractual price), but the CARD
 * is charged in MUR — the live Peach account has no EUR facility (2026-07-30). The MUR figure is
 * pinned once per payment row inside `api_create_payment` (server-controlled rate, whole rupees) and
 * recorded as `payments.charged_amount_minor`/`charged_currency`: the EXPECTED SETTLEMENT that
 * reconcile measures provider events against — not receipt decoration. The service charges exactly
 * the pinned figure; nothing outside SQL ever converts currency.
 */
export interface CreateCheckoutInput {
  /** Our booking reference (idempotency anchor across provider + webhook). */
  bookingRef: string;
  /** Amount to charge, in `currency`'s major units — the PINNED charge figure handed back by
   *  api_create_payment, never a figure computed here. */
  amount: number;
  /** ISO-4217 currency to charge in — the pinned charge currency (MUR; EUR only on legacy rows). */
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
   * the verified payload. `null`/absent means "amount not provided". A settled event (paid/refunded)
   * with no amount is NOT credited — reconcilePaymentEvent quarantines it (no ledger write) and the
   * periodic status re-query retries with a complete payload. It is never assumed to be the full
   * booking total: that turned a malformed/partial provider payload into a full-value settlement.
   */
  amountMinor?: number | null;
  /**
   * ISO-4217 currency of the settled amount, as reported by the provider. Settled events must carry
   * it and it must match the payment's EXPECTED settlement currency (`charged_currency`, i.e. MUR —
   * the ledger currency only for legacy EUR-era rows), or the event is quarantined — an amount in
   * the wrong currency credited at face value would mis-settle the ledger.
   */
  currency?: string | null;
  /**
   * TRUE only when the provider says this checkout session can never be paid — the customer
   * abandoned/cancelled it, so the session is closed rather than merely unfinished.
   *
   * `createPaymentLink` reuses an already-minted session rather than opening a second payable one
   * (the double-charge guard); a closed session makes that reuse a trap — the widget reports
   * "cancelled" the instant it mounts and bounces the customer back to their booking, forever.
   * This flag is the ONLY signal that licenses minting a replacement, so providers must set it
   * conservatively: never for a decline or a timeout (where the session usually still accepts a
   * retry, and a second session could double-charge), and never when the state is uncertain.
   */
  checkoutTerminal?: boolean;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /**
   * Optional: begin any expensive setup a later `createCheckout` will need (Peach's OAuth token, and
   * the connection to the host serving it), WITHOUT blocking. Called as early as possible so that
   * work overlaps the DB round-trips instead of queueing behind them. Must never throw or reject —
   * it is fire-and-forget, and the real call reports any failure.
   */
  prewarm?(): void;
  /** Verifies the webhook signature and normalises the payload. Throws on invalid signature. */
  verifyWebhook(input: VerifyWebhookInput): Promise<PaymentEvent>;
  /**
   * Queries the provider for a checkout's authoritative payment status (by the provider's checkout
   * id). This is the webhook-independent confirmation path: we ask the provider directly rather than
   * trusting an inbound notification, so a booking confirms even when webhooks are unsigned or missed.
   */
  getCheckoutStatus(providerCheckoutId: string): Promise<PaymentEvent>;
}
