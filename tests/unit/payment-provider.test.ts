import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { getPaymentProvider } from '@/lib/payments';
import { PeachPaymentProvider, outcomeFor, extractWebhookFields } from '@/lib/payments/peach';
import { resetServerEnvCache } from '@/lib/config/env';

const PEACH_KEYS = [
  'PEACH_CLIENT_ID',
  'PEACH_CLIENT_SECRET',
  'PEACH_MERCHANT_ID',
  'PEACH_ENTITY_ID',
  'PEACH_WEBHOOK_SECRET',
  'PEACH_AUTH_BASE_URL',
  'PEACH_CHECKOUT_BASE_URL',
  'PEACH_WEBHOOK_URL',
] as const;

function clearPeachKeys(): void {
  for (const key of PEACH_KEYS) delete process.env[key];
}

function setRealPeachKeys(): void {
  process.env.PEACH_CLIENT_ID = 'client';
  process.env.PEACH_CLIENT_SECRET = 'secret';
  process.env.PEACH_MERCHANT_ID = 'merchant';
  process.env.PEACH_ENTITY_ID = 'entity';
  process.env.PEACH_WEBHOOK_SECRET = 'whsec';
  process.env.PEACH_AUTH_BASE_URL = 'https://auth.example.com';
  process.env.PEACH_CHECKOUT_BASE_URL = 'https://checkout.example.com';
}

/**
 * The stub provider confirms bookings without verifying a signature, so it must never be
 * served in a live environment. getPaymentProvider() fails closed instead.
 */
describe('getPaymentProvider — fail-closed', () => {
  afterEach(() => {
    clearPeachKeys();
    process.env.PEACH_ENVIRONMENT = 'test';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
  });

  it('falls back to the stub in local dev / CI (no production signals) when Peach keys are absent', () => {
    clearPeachKeys();
    process.env.PEACH_ENVIRONMENT = 'test';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
    expect(getPaymentProvider().name).toBe('stub');
  });

  it('REFUSES the stub when PEACH_ENVIRONMENT=live and keys are missing', () => {
    clearPeachKeys();
    process.env.PEACH_ENVIRONMENT = 'live';
    resetServerEnvCache();
    expect(() => getPaymentProvider()).toThrow(/PEACH_ENVIRONMENT=live/);
  });

  it('REFUSES the stub when the backend is production-configured, even with PEACH_ENVIRONMENT=test (F1)', () => {
    // The danger config: Supabase live, Peach keys absent, PEACH_ENVIRONMENT left at its default.
    // The gate must fail closed on the service-role-key signal rather than trust PEACH_ENVIRONMENT.
    clearPeachKeys();
    process.env.PEACH_ENVIRONMENT = 'test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
    resetServerEnvCache();
    expect(() => getPaymentProvider()).toThrow(/Refusing to serve the unauthenticated stub/);
  });

  it('uses the real provider only when EVERY Peach value is present (even in live)', () => {
    setRealPeachKeys();
    process.env.PEACH_ENVIRONMENT = 'live';
    resetServerEnvCache();
    expect(getPaymentProvider().name).toBe('peach');
  });

  it('still fails closed in live when only SOME Peach values are present (partial config)', () => {
    setRealPeachKeys();
    delete process.env.PEACH_CHECKOUT_BASE_URL; // one missing → not "fully configured"
    process.env.PEACH_ENVIRONMENT = 'live';
    resetServerEnvCache();
    expect(() => getPaymentProvider()).toThrow(/Refusing to serve the unauthenticated stub/);
  });
});

const CONFIG = {
  clientId: 'c',
  clientSecret: 's',
  merchantId: 'm',
  entityId: 'e',
  webhookSecret: 'whsec',
  authBaseUrl: 'https://auth.example.com',
  checkoutBaseUrl: 'https://checkout.example.com',
  webhookUrl: 'https://tunnel.example.com/api/v1/webhooks/payments',
  environment: 'test' as const,
};

function sign(timestamp: string, webhookId: string, url: string, payload: string): string {
  return createHmac('sha256', CONFIG.webhookSecret)
    .update(`${timestamp}.${webhookId}.${url}.${payload}`)
    .digest('hex');
}

describe('PeachPaymentProvider.verifyWebhook', () => {
  const provider = new PeachPaymentProvider(CONFIG);
  const timestamp = '2026-06-19T10:00:00Z';
  const webhookId = 'wh_1';
  const payload =
    'merchantTransactionId=BMT-123&amount=120.00&currency=EUR&result.code=000.100.110&paymentType=DB&id=txn_9';

  it('accepts a correctly-signed settlement and normalises it (form-urlencoded)', async () => {
    const signature = sign(timestamp, webhookId, CONFIG.webhookUrl, payload);
    const event = await provider.verifyWebhook({
      rawBody: payload,
      signature: null,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-webhook-timestamp': timestamp,
        'x-webhook-id': webhookId,
        'x-webhook-signature': signature,
      },
    });
    expect(event.outcome).toBe('paid');
    expect(event.bookingRef).toBe('BMT-123');
    expect(event.amountMinor).toBe(12000);
    expect(event.providerReference).toBe('txn_9');
  });

  it('rejects a tampered body (signature no longer matches)', async () => {
    const signature = sign(timestamp, webhookId, CONFIG.webhookUrl, payload);
    await expect(
      provider.verifyWebhook({
        rawBody: `${payload}&amount=1.00`, // attacker lowers the amount
        signature: null,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-webhook-timestamp': timestamp,
          'x-webhook-id': webhookId,
          'x-webhook-signature': signature,
        },
      }),
    ).rejects.toThrow(/Invalid Peach webhook signature/);
  });

  it('fails closed when the signed webhook URL is not configured', async () => {
    const noUrl = new PeachPaymentProvider({ ...CONFIG, webhookUrl: undefined });
    await expect(
      noUrl.verifyWebhook({
        rawBody: payload,
        signature: null,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-webhook-timestamp': timestamp,
          'x-webhook-id': webhookId,
          'x-webhook-signature': 'deadbeef',
        },
      }),
    ).rejects.toThrow(/PEACH_WEBHOOK_URL is not configured/);
  });

  it('rejects a notification missing the signature headers', async () => {
    await expect(
      provider.verifyWebhook({ rawBody: payload, signature: null, headers: {} }),
    ).rejects.toThrow(/Missing Peach webhook signature headers/);
  });
});

describe('outcomeFor — Peach result-code mapping', () => {
  it('maps success codes to paid (or refunded for RF)', () => {
    expect(outcomeFor('000.100.110', 'DB')).toBe('paid');
    expect(outcomeFor('000.000.000', 'DB')).toBe('paid');
    expect(outcomeFor('000.100.110', 'RF')).toBe('refunded');
  });

  it('maps pending and rejection codes', () => {
    expect(outcomeFor('000.200.000', 'DB')).toBe('pending');
    expect(outcomeFor('800.100.100', 'DB')).toBe('failed');
    expect(outcomeFor('100.396.101', 'DB')).toBe('failed');
    expect(outcomeFor(null, 'DB')).toBe('unknown');
  });
});

describe('extractWebhookFields — JSON body', () => {
  it('reads nested result.code and converts the amount to minor units', () => {
    const json = JSON.stringify({
      merchantTransactionId: 'BMT-9',
      amount: '85.00',
      currency: 'EUR',
      paymentType: 'DB',
      id: 't1',
      result: { code: '000.100.110' },
    });
    const f = extractWebhookFields(json, 'application/json');
    expect(f.resultCode).toBe('000.100.110');
    expect(f.merchantTransactionId).toBe('BMT-9');
    expect(f.amountMinor).toBe(8500);
    expect(f.transactionId).toBe('t1');
  });
});

describe('PeachPaymentProvider.createCheckout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a token then creates a checkout with the right body and returns the checkoutId', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init: init ?? {} });
      if (u.endsWith('/api/oauth/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 300, token_type: 'Bearer' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (u.endsWith('/v2/checkout')) {
        return new Response(JSON.stringify({ checkoutId: 'cid_123', result: { code: '000.200.000' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PeachPaymentProvider(CONFIG);
    const session = await provider.createCheckout({
      bookingRef: 'BMT-1',
      amount: 120,
      currency: 'USD',
      customerEmail: 'a@b.com',
      description: 'Belle Mare Tours booking BMT-1',
      returnUrl: 'https://site.example.com/bookings/BMT-1',
    });

    expect(session.checkoutId).toBe('cid_123');
    expect(session.id).toBe('cid_123');
    expect(session.provider).toBe('peach');

    expect(calls.some((c) => c.url.endsWith('/api/oauth/token'))).toBe(true);
    const checkout = calls.find((c) => c.url.endsWith('/v2/checkout'));
    expect(checkout).toBeDefined();
    const body = JSON.parse(String(checkout!.init.body));
    expect(body.merchantTransactionId).toBe('BMT-1');
    expect(body.amount).toBe('120.00');
    expect(body.currency).toBe('USD');
    expect(body.paymentType).toBe('DB');
    expect(body.authentication.entityId).toBe('e');
    expect(body.notificationUrl).toBe(CONFIG.webhookUrl);
    expect(typeof body.nonce).toBe('string');
    const headers = checkout!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers.Origin).toBe('https://site.example.com');
  });
});

describe('PeachPaymentProvider.getCheckoutStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-queries the status endpoint and normalises a paid result', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/api/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 300 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.endsWith('/v2/checkout/cid_9/status')) {
        return new Response(
          JSON.stringify({
            'result.code': '000.100.110',
            merchantTransactionId: 'BMT-1',
            amount: '97.00',
            currency: 'USD',
            paymentType: 'DB',
            id: 'txn_42',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PeachPaymentProvider(CONFIG);
    const event = await provider.getCheckoutStatus('cid_9');

    expect(event.outcome).toBe('paid');
    expect(event.bookingRef).toBe('BMT-1');
    expect(event.providerReference).toBe('txn_42');
    expect(event.amountMinor).toBe(9700);
  });
});
