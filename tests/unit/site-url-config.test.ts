import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLocalhostUrl,
  isSiteUrlConfiguredForLive,
  isProductionLikeRuntime,
} from '@/lib/config/runtime';
import { getServerEnv, resetServerEnvCache } from '@/lib/config/env';

/**
 * NEXT_PUBLIC_SITE_URL is declared with a `.default('http://localhost:3000')`, so a deploy that
 * forgets to set it (or typos it) silently becomes localhost. That URL is load-bearing on the MONEY
 * path — it builds the Peach return URL (shopperResultUrl) and the request Origin — and on every
 * canonical/OG/sitemap link. We fail CLOSED when production-like + localhost, but keep the default so
 * local dev / CI / tests run unchanged. The "is live" signal is the shared isProductionLikeRuntime
 * gate (vitest runs NODE_ENV=test, so a configured Supabase service-role key makes it live-like).
 */

function clearLiveSignals(): void {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.PEACH_ENVIRONMENT = 'test';
  delete process.env.NEXT_PUBLIC_SITE_URL;
}

describe('isLocalhostUrl', () => {
  it('treats loopback hosts (any port) as localhost', () => {
    expect(isLocalhostUrl('http://localhost:3000')).toBe(true);
    expect(isLocalhostUrl('http://localhost')).toBe(true);
    expect(isLocalhostUrl('https://127.0.0.1:8080')).toBe(true);
    expect(isLocalhostUrl('http://[::1]:3000')).toBe(true);
    expect(isLocalhostUrl('http://app.localhost')).toBe(true);
  });

  it('treats unset / malformed URLs as not-configured (localhost)', () => {
    expect(isLocalhostUrl(undefined)).toBe(true);
    expect(isLocalhostUrl(null)).toBe(true);
    expect(isLocalhostUrl('')).toBe(true);
    expect(isLocalhostUrl('not a url')).toBe(true);
  });

  it('treats a real https origin as configured (not localhost)', () => {
    expect(isLocalhostUrl('https://www.getyourtours.mu')).toBe(false);
    expect(isLocalhostUrl('https://bellemaretours.com')).toBe(false);
  });
});

describe('isSiteUrlConfiguredForLive', () => {
  afterEach(() => {
    clearLiveSignals();
    resetServerEnvCache();
  });

  it('passes in dev / CI (not production-like) even with the localhost default', () => {
    clearLiveSignals();
    resetServerEnvCache();
    const env = getServerEnv();
    expect(isProductionLikeRuntime(env)).toBe(false);
    expect(isSiteUrlConfiguredForLive(env)).toBe(true);
  });

  it('FAILS when production-like (service-role key set) and the site URL is the localhost default', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
    delete process.env.NEXT_PUBLIC_SITE_URL; // → localhost default
    resetServerEnvCache();
    const env = getServerEnv();
    expect(isProductionLikeRuntime(env)).toBe(true);
    expect(isSiteUrlConfiguredForLive(env)).toBe(false);
  });

  it('FAILS when PEACH_ENVIRONMENT=live and the site URL is localhost', () => {
    process.env.PEACH_ENVIRONMENT = 'live';
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    resetServerEnvCache();
    expect(isSiteUrlConfiguredForLive(getServerEnv())).toBe(false);
  });

  it('PASSES when production-like with a real https origin', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.getyourtours.mu';
    resetServerEnvCache();
    expect(isSiteUrlConfiguredForLive(getServerEnv())).toBe(true);
  });
});

/**
 * Money-path guard: the payments route throws a ConfigError (code site_url_not_configured) BEFORE
 * creating a checkout when production-like + localhost. We mock auth/body/context so the test
 * exercises only the guard, and spy on createPaymentLink to prove it is NOT reached.
 */
const createPaymentLinkSpy = vi.fn();
vi.mock('@/lib/http/auth', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/lib/http/context', () => ({
  buildServiceContext: () => ({}),
  serviceRoleRpcContext: () => ({}),
}));
vi.mock('@/lib/services/payments', () => ({
  createPaymentLink: (...args: unknown[]) => createPaymentLinkSpy(...args),
}));

const { POST: paymentsPost } = await import('../../app/api/v1/payments/route');

function paymentRequest(): Request {
  return new Request('http://localhost/api/v1/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bookingRef: 'BMT-123' }),
  });
}

describe('POST /api/v1/payments — site-url money-path guard', () => {
  afterEach(() => {
    clearLiveSignals();
    createPaymentLinkSpy.mockReset();
    createPaymentLinkSpy.mockResolvedValue({
      sessionId: 's',
      redirectUrl: 'https://pay.example/s',
      checkoutId: 'c',
      provider: 'stub',
    });
    resetServerEnvCache();
  });

  it('THROWS site_url_not_configured (and never creates a checkout) when live + localhost', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
    delete process.env.NEXT_PUBLIC_SITE_URL; // → localhost default
    resetServerEnvCache();

    // 5xx ServiceError messages are scrubbed to a generic message + errorId for the client (the real
    // message is logged with a correlation id). So assert the response is a 500 config_error AND the
    // load-bearing behaviour — no checkout was created — AND that the real reason is logged.
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await paymentsPost(paymentRequest());
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('config_error');
      expect(createPaymentLinkSpy).not.toHaveBeenCalled();
      const logged = errorLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toMatch(/site_url_not_configured/);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('passes the guard (creates a checkout) when live + a real https site URL', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.getyourtours.mu';
    createPaymentLinkSpy.mockResolvedValue({
      sessionId: 's',
      redirectUrl: 'https://pay.example/s',
      checkoutId: 'c',
      provider: 'peach',
    });
    resetServerEnvCache();

    const res = await paymentsPost(paymentRequest());
    expect(res.status).toBe(201);
    expect(createPaymentLinkSpy).toHaveBeenCalledTimes(1);
    const arg = createPaymentLinkSpy.mock.calls[0]![1] as { returnUrl: string };
    expect(arg.returnUrl).toBe('https://www.getyourtours.mu/bookings/BMT-123');
  });

  it('passes the guard in dev / CI (localhost default, not production-like)', async () => {
    clearLiveSignals(); // no live signals → stays on localhost default, but not live
    createPaymentLinkSpy.mockResolvedValue({
      sessionId: 's',
      redirectUrl: 'https://pay.example/s',
      checkoutId: 'c',
      provider: 'stub',
    });
    resetServerEnvCache();

    const res = await paymentsPost(paymentRequest());
    expect(res.status).toBe(201);
    expect(createPaymentLinkSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * Health gate: when production-like with a localhost/unset site URL, /health returns 503 with the
 * failing siteUrlConfigured check, so a misconfigured deploy is caught by monitoring immediately.
 */
const { GET: healthGet } = await import('../../app/api/v1/health/route');

describe('GET /api/v1/health — siteUrlConfigured gate', () => {
  afterEach(() => {
    clearLiveSignals();
    resetServerEnvCache();
  });

  it('returns 503 with siteUrlConfigured=false when live (PEACH live) + localhost site URL', async () => {
    process.env.PEACH_ENVIRONMENT = 'live';
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    resetServerEnvCache();

    const res = await healthGet(new Request('http://localhost/api/v1/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.details.checks.siteUrlConfigured).toBe(false);
  });

  it('reports siteUrlConfigured=true in a non-live env (localhost default is fine)', async () => {
    clearLiveSignals();
    resetServerEnvCache();
    const res = await healthGet(new Request('http://localhost/api/v1/health'));
    const body = await res.json();
    // Shallow health in dev is 200; the site-url check is satisfied.
    expect(body.data.checks.siteUrlConfigured).toBe(true);
  });
});
