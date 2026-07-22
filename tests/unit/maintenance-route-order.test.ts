import { describe, expect, it, vi, beforeEach } from 'vitest';

// Record the order the maintenance steps run in. The money-safety property is that reconcile
// (confirm-paid) runs BEFORE the booking-expiry sweep, and that each step is isolated.
const { calls, reconcile, expire, materialize, reviewInvites } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    reconcile: vi.fn(async () => {
      calls.push('reconcile');
      return { queried: 0, confirmed: 0, pending: 0, failed: 0, errored: 0 };
    }),
    expire: vi.fn(async () => {
      calls.push('expire');
      return { holdsExpired: 0, bookingsExpired: 0 };
    }),
    materialize: vi.fn(async () => {
      calls.push('materialize');
      return 0;
    }),
    reviewInvites: vi.fn(async () => {
      calls.push('reviewInvites');
      return 0;
    }),
  };
});

vi.mock('@/lib/services/maintenance', () => ({
  reconcilePaymentsPending: reconcile,
  runBookingMaintenance: expire,
  materializeAvailability: materialize,
  enqueueReviewInvites: reviewInvites,
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
  reviewInvites.mockClear();
});

describe('maintenance route ordering (money-safety)', () => {
  it('runs reconcile (confirm-paid) BEFORE the booking-expiry sweep', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(calls.indexOf('reconcile')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('reconcile')).toBeLessThan(calls.indexOf('expire'));
  });

  it('isolates each step — a failing reconcile does not block the expiry sweep — but the response is 503', async () => {
    reconcile.mockImplementationOnce(async () => {
      throw new Error('provider unreachable');
    });
    const res = await POST(req());
    // Isolation is unchanged: every job still runs despite the reconcile throwing…
    expect(calls).toContain('expire');
    expect(calls).toContain('materialize');
    // …but the failure is no longer buried inside a 200 (review item 7): the cron Worker treats any
    // 2xx as success, so a persistently broken sweep looked healthy on the dashboard forever. A 503
    // makes the Worker retry → throw → the invocation shows as failed where someone can see it.
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; details?: { erroredJobs?: string[] } };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('maintenance_partial_failure');
    expect(body.error.details?.erroredJobs).toEqual(['payments']);
  });

  it('returns 503 when the payments sweep completes but a candidate errored/quarantined (errored count > 0)', async () => {
    // The sweep did not throw — it reconciled some and left others un-reconciled (a numeric count),
    // which used to slip through as a 200 because only the boolean `errored: true` was checked.
    reconcile.mockImplementationOnce(async () => {
      calls.push('reconcile');
      return { queried: 3, confirmed: 2, pending: 0, failed: 0, errored: 1 };
    });
    const res = await POST(req());
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: { code: string; details?: { erroredJobs?: string[] } };
    };
    expect(body.error.code).toBe('maintenance_partial_failure');
    expect(body.error.details?.erroredJobs).toEqual(['payments']);
  });

  it('stays 200 when the payments sweep reconciles everything cleanly (errored count 0)', async () => {
    reconcile.mockImplementationOnce(async () => {
      calls.push('reconcile');
      return { queried: 2, confirmed: 2, pending: 0, failed: 0, errored: 0 };
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
  });
});
