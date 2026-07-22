import { describe, it, expect, vi } from 'vitest';

/**
 * The release pipeline's post-deploy verification (scripts/release/verify-health.mjs) polls
 * /api/v1/health?deep=true and asserts the returned releaseSha equals the artifact SHA it just
 * deployed. releaseSha/releaseRunId are baked into the bundle at build time (see
 * src/lib/config/release-metadata.generated.ts) rather than read from env — non-sensitive (a git
 * SHA and a run id), and null on any build that isn't the release pipeline's own.
 */
const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  PEACH_ENVIRONMENT: 'test',
  NEXT_PUBLIC_SITE_URL: 'https://bellemaretours.com',
  ACCEPT_LEGACY_HS256: false,
  RESEND_API_KEY: 're_x',
  RESEND_FROM: 'Belle Mare Tours <bookings@example.com>',
  INTERNAL_TASK_SECRET: 's3cret',
};

describe('GET /health — release provenance fields', () => {
  // Generous timeout: vi.resetModules() + a dynamic import re-collects the whole health-route
  // module graph, which under heavy parallel test-runner load (many files at once) can run past
  // vitest's 5s default — seen locally on a full `test:coverage` run, not in isolation.
  it('surfaces releaseSha, releaseRunId, environment and paymentMode when baked into the build', async () => {
    vi.resetModules();
    vi.doMock('@/lib/config/env', () => ({ getServerEnv: () => baseEnv }));
    vi.doMock('@/lib/payments', () => ({ getPaymentProvider: () => ({ name: 'peach' }) }));
    vi.doMock('@/lib/config/release-metadata.generated', () => ({
      RELEASE_SHA: 'abc123def4567890abc123def4567890abc123d',
      RELEASE_RUN_ID: '123456789',
    }));
    const { GET } = await import('../../app/api/v1/health/route');
    const res = await GET(new Request('http://localhost/api/v1/health'));
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      data: { releaseSha: string; releaseRunId: string; environment: string; paymentMode: string };
    };
    expect(j.data.releaseSha).toBe('abc123def4567890abc123def4567890abc123d');
    expect(j.data.releaseRunId).toBe('123456789');
    expect(j.data.environment).toBe('production');
    expect(j.data.paymentMode).toBe('test');
  }, 20_000);

  it('defaults to null on a non-release build (the committed placeholder)', async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/config/release-metadata.generated');
    vi.doMock('@/lib/config/env', () => ({
      getServerEnv: () => ({
        NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
        PEACH_ENVIRONMENT: 'test',
        ACCEPT_LEGACY_HS256: false,
      }),
    }));
    vi.doMock('@/lib/payments', () => ({ getPaymentProvider: () => ({ name: 'stub' }) }));
    const { GET } = await import('../../app/api/v1/health/route');
    const res = await GET(new Request('http://localhost/api/v1/health'));
    const j = (await res.json()) as { data: { releaseSha: null; releaseRunId: null } };
    expect(j.data.releaseSha).toBeNull();
    expect(j.data.releaseRunId).toBeNull();
  }, 20_000);
});
