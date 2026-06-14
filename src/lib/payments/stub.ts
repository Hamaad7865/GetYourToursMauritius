import type {
  CheckoutSession,
  CreateCheckoutInput,
  PaymentEvent,
  PaymentOutcome,
  PaymentProvider,
  VerifyWebhookInput,
} from './types';

/**
 * Deterministic in-memory payment provider for local dev and tests. No network,
 * no secrets. Lets the full booking -> payment -> webhook flow run end-to-end
 * before real Peach credentials exist.
 */
export class StubPaymentProvider implements PaymentProvider {
  readonly name = 'stub';

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const id = `stub_${input.bookingRef}`;
    const url = new URL(input.returnUrl);
    url.searchParams.set('stub_session', id);
    url.searchParams.set('status', 'success');
    return { id, redirectUrl: url.toString(), provider: this.name };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<PaymentEvent> {
    let parsed: Record<string, unknown> | null = null;
    try {
      const value: unknown = JSON.parse(input.rawBody);
      parsed =
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    const bookingRef = typeof parsed?.bookingRef === 'string' ? parsed.bookingRef : null;
    const outcome: PaymentOutcome =
      typeof parsed?.outcome === 'string' && isOutcome(parsed.outcome) ? parsed.outcome : 'paid';
    const providerReference =
      typeof parsed?.providerReference === 'string'
        ? parsed.providerReference
        : `stub_ref_${bookingRef ?? 'unknown'}`;

    return { outcome, bookingRef, providerReference, raw: parsed };
  }
}

function isOutcome(value: string): value is PaymentOutcome {
  return ['paid', 'failed', 'pending', 'refunded', 'unknown'].includes(value);
}
