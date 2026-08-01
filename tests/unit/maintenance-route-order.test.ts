import { describe, expect, it, vi, beforeEach } from 'vitest';

// Record the order the maintenance steps run in. The money-safety property is that reconcile
// (confirm-paid) runs BEFORE the booking-expiry sweep, and that each step is isolated.
const { calls, reconcile, expire, materialize, reviewInvites, fxRefresh, purgeErrors } = vi.hoisted(
  () => {
    const calls: string[] = [];
    return {
      calls,
      purgeErrors: vi.fn(async () => {
        calls.push('purgeErrors');
        return { deleted: 0, aged: 0, overflow: 0 };
      }),
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
      fxRefresh: vi.fn(async () => {
        calls.push('fx');
        return { refreshed: true, rate: 53.98, ageHours: 0 };
      }),
    };
  },
);

vi.mock('@/lib/services/maintenance', () => ({
  reconcilePaymentsPending: reconcile,
  runBookingMaintenance: expire,
  materializeAvailability: materialize,
  enqueueReviewInvites: reviewInvites,
  refreshFxRate: fxRefresh,
  purgeErrorLogs: purgeErrors,
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
  fxRefresh.mockClear();
  purgeErrors.mockClear();
  fxRefresh.mockImplementation(async () => {
    calls.push('fx');
    return { refreshed: true, rate: 53.98, ageHours: 0 };
  });
});

describe('maintenance route ordering (money-safety)', () => {
  it('runs reconcile (confirm-paid) BEFORE the booking-expiry sweep', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(calls.indexOf('reconcile')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('reconcile')).toBeLessThan(calls.indexOf('expire'));
  });

  // ASSERTION DELIBERATELY REVERSED (2026-08-01). This used to assert the opposite — that a failing
  // reconcile "does not block the expiry sweep" — on a general principle of step isolation. Isolation
  // is the right default and still holds for every other step, but it cannot hold for THIS pair:
  //
  // run_booking_maintenance reads its money guard off the PAYMENTS rows (a settled status,
  // paid_minor > 0, settlement_review_at). A booking that paid at ~minute 29 whose webhook never
  // arrived has NONE of those yet — the reconcile step is what would have given it one. So running
  // expiry after a wholesale reconcile failure expires a booking that has paid, releasing the seat
  // with the money taken.
  //
  // The trade is lopsided: skipping expiry costs one 5-minute tick of stale holds hanging around;
  // running it costs a customer their money and their seat. The route's own step-1 comment already
  // claimed this ordering ("FIRST, so the next step can't expire them") — it just wasn't enforced.
  it('does NOT run the expiry sweep when the reconcile step failed wholesale', async () => {
    reconcile.mockImplementationOnce(async () => {
      throw new Error('provider unreachable');
    });
    const res = await POST(req());

    // The money-unsafe step is skipped…
    expect(calls).not.toContain('expire');
    // …while isolation is preserved for everything that cannot lose money by running.
    expect(calls).toContain('materialize');
    expect(calls).toContain('fx');

    // The failure is not buried inside a 200 (review item 7): the cron Worker treats any 2xx as
    // success, so a persistently broken sweep looked healthy on the dashboard forever. A 503 makes
    // the Worker retry → throw → the invocation shows as failed where someone can see it. The skipped
    // sweep is reported too, rather than passing silently as if it had nothing to do.
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; details?: { erroredJobs?: string[] } };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('maintenance_partial_failure');
    expect(body.error.details?.erroredJobs).toEqual(['payments', 'bookingMaintenance']);
  });

  it('still runs the expiry sweep on the normal path', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(calls).toContain('expire');
  });

  // A per-candidate failure is caught INSIDE reconcilePaymentsPending and only bumps its numeric
  // count — the batch itself succeeded, so expiry is still safe to run and must not be starved.
  it('still runs the expiry sweep when reconcile merely reports a per-candidate error count', async () => {
    reconcile.mockImplementationOnce(async () => {
      calls.push('reconcile');
      return { queried: 3, confirmed: 2, pending: 0, failed: 0, errored: 1 };
    });
    const res = await POST(req());
    expect(calls).toContain('expire');
    expect(res.status).toBe(503); // still unhealthy — but for the payments count, not the sweep
    const body = (await res.json()) as { error: { details?: { erroredJobs?: string[] } } };
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

  it('prunes error_logs, but a failed prune does NOT turn the cron red', async () => {
    purgeErrors.mockImplementationOnce(async () => {
      throw new Error('purge failed');
    });
    const res = await POST(req());
    // Housekeeping only. A red cron means customers are affected (money, emails, availability); an
    // unpruned diagnostics table is neither, and it reports itself INTO error_logs where it's visible.
    expect(res.status).toBe(200);
    expect(purgeErrors).toHaveBeenCalled();
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
