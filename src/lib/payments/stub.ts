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

/**
 * What each stub checkout was created FOR, keyed by checkout id. Settlement is strict since the
 * 2026-07-17 review (a settled event must carry its amount + currency or it is quarantined, never
 * credited as the full total), so the stub must report truthfully what a real provider would: the
 * amount it was asked to charge. Module-level so the dev flow works across requests; tests that
 * fabricate checkout ids without creating them get `amountMinor: null` back — which is exactly the
 * malformed-provider case the quarantine path exists for.
 */
const stubCheckouts = new Map<string, { amountMinor: number; currency: string }>();

export class StubPaymentProvider implements PaymentProvider {
  readonly name = 'stub';

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const id = `stub_${input.bookingRef}`;
    stubCheckouts.set(id, {
      amountMinor: Math.round(input.amount * 100),
      currency: input.currency,
    });
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
    const known = bookingRef ? stubCheckouts.get(`stub_${bookingRef}`) : undefined;
    const outcome: PaymentOutcome =
      typeof parsed?.outcome === 'string' && isOutcome(parsed.outcome) ? parsed.outcome : 'paid';
    const providerReference =
      typeof parsed?.providerReference === 'string'
        ? parsed.providerReference
        : `stub_ref_${bookingRef ?? 'unknown'}`;
    // An explicit amount/currency in the posted body wins (tests exercising partials/mismatches);
    // otherwise report what the checkout was created for, like a real provider would.
    const amountMinor =
      typeof parsed?.amountMinor === 'number' && Number.isFinite(parsed.amountMinor)
        ? parsed.amountMinor
        : (known?.amountMinor ?? null);
    const currency =
      typeof parsed?.currency === 'string' ? parsed.currency : (known?.currency ?? 'EUR');

    return { outcome, bookingRef, providerReference, amountMinor, currency, raw: parsed };
  }

  async getCheckoutStatus(checkoutId: string): Promise<PaymentEvent> {
    // createCheckout mints the id as `stub_${bookingRef}`; recover the ref and report a paid status,
    // so the dev/CI re-query confirmation flow completes end-to-end without a real provider.
    const bookingRef = checkoutId.startsWith('stub_') ? checkoutId.slice('stub_'.length) : null;
    const known = stubCheckouts.get(checkoutId);
    return {
      outcome: 'paid',
      bookingRef,
      providerReference: `stub_status_${bookingRef ?? 'unknown'}`,
      amountMinor: known?.amountMinor ?? null,
      currency: known?.currency ?? 'EUR',
      raw: { checkoutId },
    };
  }
}

function isOutcome(value: string): value is PaymentOutcome {
  return ['paid', 'failed', 'pending', 'refunded', 'unknown'].includes(value);
}
