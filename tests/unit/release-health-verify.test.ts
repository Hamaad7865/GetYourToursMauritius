import { describe, expect, it } from 'vitest';
import { assertHealthy } from '../../scripts/release/verify-health.mjs';

const SHA = 'a'.repeat(40);
const HEALTHY_BODY = {
  data: {
    status: 'ok',
    releaseSha: SHA,
    checks: {
      database: true,
      internalTasksConfigured: true,
      supabaseConfigured: true,
      serviceRoleConfigured: true,
      paymentsSafe: true,
      legacyAuthDisabled: true,
      siteUrlConfigured: true,
    },
  },
};

describe('release/verify-health assertHealthy', () => {
  it('returns no errors for a fully healthy body matching the expected SHA', () => {
    expect(assertHealthy(HEALTHY_BODY, SHA)).toEqual([]);
  });

  it('flags a releaseSha mismatch', () => {
    const errors = assertHealthy(HEALTHY_BODY, 'b'.repeat(40));
    expect(errors.some((e) => e.includes('releaseSha'))).toBe(true);
  });

  it('flags status !== ok', () => {
    const body = { ...HEALTHY_BODY, data: { ...HEALTHY_BODY.data, status: 'degraded' } };
    expect(assertHealthy(body, SHA).some((e) => e.includes('status'))).toBe(true);
  });

  it('flags database not reachable', () => {
    const body = {
      ...HEALTHY_BODY,
      data: { ...HEALTHY_BODY.data, checks: { ...HEALTHY_BODY.data.checks, database: false } },
    };
    expect(assertHealthy(body, SHA).some((e) => e.includes('database'))).toBe(true);
  });

  it('flags internal tasks not configured', () => {
    const body = {
      ...HEALTHY_BODY,
      data: {
        ...HEALTHY_BODY.data,
        checks: { ...HEALTHY_BODY.data.checks, internalTasksConfigured: false },
      },
    };
    expect(assertHealthy(body, SHA).some((e) => e.includes('internalTasksConfigured'))).toBe(true);
  });

  it('handles a completely malformed body without throwing', () => {
    const errors = assertHealthy(null, SHA);
    expect(errors.length).toBeGreaterThan(0);
  });
});
