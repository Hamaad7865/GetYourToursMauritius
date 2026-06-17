import { afterEach, describe, expect, it } from 'vitest';
import { getPaymentProvider } from '@/lib/payments';
import { resetServerEnvCache } from '@/lib/config/env';

const PEACH_KEYS = ['PEACH_ENTITY_ID', 'PEACH_ACCESS_TOKEN', 'PEACH_WEBHOOK_SECRET'] as const;

function clearPeachKeys(): void {
  for (const key of PEACH_KEYS) delete process.env[key];
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

  it('uses the real provider when fully configured (even in live)', () => {
    process.env.PEACH_ENTITY_ID = 'entity';
    process.env.PEACH_ACCESS_TOKEN = 'token';
    process.env.PEACH_WEBHOOK_SECRET = 'secret';
    process.env.PEACH_ENVIRONMENT = 'live';
    resetServerEnvCache();
    expect(getPaymentProvider().name).toBe('peach');
  });
});
