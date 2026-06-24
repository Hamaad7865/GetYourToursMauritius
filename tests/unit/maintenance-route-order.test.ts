import { describe, expect, it, vi, beforeEach } from 'vitest';

// Record the order the maintenance steps run in. The money-safety property is that reconcile
// (confirm-paid) runs BEFORE the booking-expiry sweep, and that each step is isolated.
const { calls, reconcile, expire, materialize } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    reconcile: vi.fn(async () => {
      calls.push('reconcile');
      return { reconciled: 0 };
    }),
    expire: vi.fn(async () => {
      calls.push('expire');
      return { holdsExpired: 0, bookingsExpired: 0 };
    }),
    materialize: vi.fn(async () => {
      calls.push('materialize');
      return 0;
    }),
  };
});

vi.mock('@/lib/services/maintenance', () => ({
  reconcilePaymentsPending: reconcile,
  runBookingMaintenance: expire,
  materializeAvailability: materialize,
}));
vi.mock('@/lib/http/context', () => ({ serviceRoleServiceContext: () => ({}) }));
vi.mock('@/lib/config/env', () => ({ getServerEnv: () => ({ INTERNAL_TASK_SECRET: 'secret' }) }));

const { POST } = await import('../../app/api/v1/internal/maintenance/route');

const req = () =>
  new Request('http://localhost/api/v1/internal/maintenance', {
    method: 'POST',
    headers: { 'x-internal-secret': 'secret' },
  });

beforeEach(() => {
  calls.length = 0;
  reconcile.mockClear();
  expire.mockClear();
  materialize.mockClear();
});

describe('maintenance route ordering (money-safety)', () => {
  it('runs reconcile (confirm-paid) BEFORE the booking-expiry sweep', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(calls.indexOf('reconcile')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('reconcile')).toBeLessThan(calls.indexOf('expire'));
  });

  it('isolates each step — a failing reconcile does not block the expiry sweep', async () => {
    reconcile.mockImplementationOnce(async () => {
      throw new Error('provider unreachable');
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(calls).toContain('expire'); // expire + materialize still ran despite reconcile throwing
    expect(calls).toContain('materialize');
  });
});
