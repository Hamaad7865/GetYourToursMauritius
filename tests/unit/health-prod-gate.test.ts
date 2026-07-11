import { describe, it, expect, vi } from 'vitest';

/**
 * Readiness must key on the production-like runtime signal, NOT on PEACH_ENVIRONMENT === 'live'. A real
 * deploy that forgot to set PEACH_ENVIRONMENT (schema default 'test') or ran a soft launch in Peach test
 * mode previously skipped the Supabase / service-role / legacy-auth gates and returned a false 200. With
 * a configured service-role key it is production-like, so missing config must now surface as 503.
 */
vi.mock('@/lib/config/env', () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: '', // missing → supabaseConfigured false
    NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: 'svc', // present → isProductionLikeRuntime === true
    PEACH_ENVIRONMENT: 'test', // NOT live — the whole point of the fix
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    ACCEPT_LEGACY_HS256: false,
  }),
}));
vi.mock('@/lib/payments', () => ({ getPaymentProvider: () => ({ name: 'stub' }) }));

const { GET } = await import('../../app/api/v1/health/route');

describe('GET /health — gate keys on production-like runtime, not Peach live', () => {
  it('production-like (service-role key set) + Peach test + missing config → 503', async () => {
    const res = await GET(new Request('http://localhost/api/v1/health'));
    expect(res.status).toBe(503);
    const j = (await res.json()) as {
      error: { details: { productionLike: boolean; checks: Record<string, boolean> } };
    };
    expect(j.error.details.productionLike).toBe(true);
    expect(j.error.details.checks.supabaseConfigured).toBe(false);
    // The stub payment provider must never pass on a production-like deploy.
    expect(j.error.details.checks.paymentsSafe).toBe(false);
  });
});
