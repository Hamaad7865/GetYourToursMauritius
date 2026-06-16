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
    resetServerEnvCache();
  });

  it('falls back to the stub in a non-live environment when Peach keys are absent', () => {
    clearPeachKeys();
    process.env.PEACH_ENVIRONMENT = 'test';
    resetServerEnvCache();
    expect(getPaymentProvider().name).toBe('stub');
  });

  it('REFUSES the stub when PEACH_ENVIRONMENT=live and keys are missing', () => {
    clearPeachKeys();
    process.env.PEACH_ENVIRONMENT = 'live';
    resetServerEnvCache();
    expect(() => getPaymentProvider()).toThrow(/PEACH_ENVIRONMENT=live/);
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
