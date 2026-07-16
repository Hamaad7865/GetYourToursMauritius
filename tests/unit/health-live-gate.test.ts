import { describe, it, expect, vi } from 'vitest';

/**
 * Go-live readiness gate (review item 11). PEACH_EXPECT_LIVE=true ARMS the requirement that
 * payments actually run in Peach live mode: a fully-configured production deploy still on sandbox
 * credentials must report 503, not green — otherwise it quietly takes real bookings nobody can pay
 * for. Unarmed, the gate always passes (the sandbox phase — covered by health-prod-gate.test.ts,
 * whose env has no PEACH_EXPECT_LIVE and still gates on everything else).
 */
vi.mock('@/lib/config/env', () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'svc', // production-like runtime
    PEACH_ENVIRONMENT: 'test', // sandbox — the misconfiguration the armed gate exists to catch
    PEACH_EXPECT_LIVE: 'true', // armed at go-live
    NEXT_PUBLIC_SITE_URL: 'https://bellemaretours.com',
    ACCEPT_LEGACY_HS256: false,
    RESEND_API_KEY: 're_x',
    RESEND_FROM: 'Belle Mare Tours <bookings@example.com>',
    INTERNAL_TASK_SECRET: 's3cret',
  }),
}));
vi.mock('@/lib/payments', () => ({ getPaymentProvider: () => ({ name: 'peach' }) }));

const { GET } = await import('../../app/api/v1/health/route');

describe('GET /health — PEACH_EXPECT_LIVE arms the live-mode readiness gate', () => {
  it('armed + sandbox credentials → 503 with paymentsLive=false (everything else green)', async () => {
    const res = await GET(new Request('http://localhost/api/v1/health'));
    expect(res.status).toBe(503);
    const j = (await res.json()) as {
      error: { details: { live: boolean; checks: Record<string, boolean> } };
    };
    expect(j.error.details.live).toBe(false);
    expect(j.error.details.checks.paymentsLive).toBe(false);
    // The gate fired for live-mode specifically — the rest of the config is genuinely healthy.
    expect(j.error.details.checks.supabaseConfigured).toBe(true);
    expect(j.error.details.checks.internalTasksConfigured).toBe(true);
    expect(j.error.details.checks.paymentsSafe).toBe(true);
  });
});
