import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getBearerToken, timingSafeEqual } from '@/lib/http/auth';
import { serviceRoleServiceContext } from '@/lib/http/context';
import { getServerEnv } from '@/lib/config/env';
import {
  runBookingMaintenance,
  materializeAvailability,
  reconcilePaymentsPending,
  enqueueReviewInvites,
} from '@/lib/services/maintenance';

export const runtime = 'edge';

/**
 * POST /api/v1/internal/maintenance — worker endpoint that sweeps stale holds and expires
 * abandoned bookings. NOT public: requires INTERNAL_TASK_SECRET. Meant to run on a cron (e.g.
 * every 5 minutes).
 */
export const POST = apiHandler(async (req) => {
  const secret = getServerEnv().INTERNAL_TASK_SECRET;
  if (!secret) return jsonError(503, 'not_configured', 'Internal tasks are not configured');
  const provided = req.headers.get('x-internal-secret') ?? getBearerToken(req);
  if (!(await timingSafeEqual(provided, secret)))
    return jsonError(401, 'unauthorized', 'Invalid task secret');

  const ctx = serviceRoleServiceContext();

  // Order matters for money-safety: the payment reconcile (confirm-paid) runs BEFORE the booking-expiry
  // sweep, so a booking that paid at ~minute 29 but isn't yet webhook-confirmed is confirmed first and
  // then excluded from the expire predicate — it can never be wrongly auto-cancelled. Each step is
  // isolated in its own try/catch so one failure (e.g. the provider is briefly unreachable) never blocks
  // the others; the failed step simply re-runs on the next cron tick.
  const log = (step: string, err: unknown) =>
    console.error(
      `[maintenance] ${step} failed:`,
      err instanceof Error ? err.message : 'unknown error',
    );

  // 1) Webhook-less safety net: re-query the provider for stuck `payment_pending` bookings and confirm
  //    the ones that paid (idempotent via append_payment_event) — FIRST, so the next step can't expire them.
  let payments: Awaited<ReturnType<typeof reconcilePaymentsPending>> | { errored: true } = {
    errored: true,
  };
  try {
    payments = await reconcilePaymentsPending(ctx);
  } catch (err) {
    log('payment reconcile sweep', err);
  }

  // 2) Sweep stale holds + expire genuinely-abandoned bookings (now that any real payment is confirmed).
  let result: Awaited<ReturnType<typeof runBookingMaintenance>> | { errored: true } = {
    errored: true,
  };
  try {
    result = await runBookingMaintenance(ctx);
  } catch (err) {
    log('booking maintenance sweep', err);
  }

  // 3) Roll the open-ended availability window forward (now that the read path no longer fills it).
  let slotsCreated: Awaited<ReturnType<typeof materializeAvailability>> | { errored: true } = {
    errored: true,
  };
  try {
    slotsCreated = await materializeAvailability(ctx);
  } catch (err) {
    log('availability materialize', err);
  }

  // 4) Post-trip review requests — not money-critical, so position doesn't matter for correctness.
  let reviewInvitesCreated: number | { errored: true } = { errored: true };
  try {
    reviewInvitesCreated = await enqueueReviewInvites(ctx);
  } catch (err) {
    log('review invites sweep', err);
  }

  // HONEST STATUS (review item 7): every job above ran regardless (each isolated in its own
  // try/catch), but a failed one used to be reported inside a 200 — the cron Worker treats any 2xx
  // as success, so a persistently broken sweep looked healthy on the Cloudflare dashboard forever.
  // Any errored job now makes the whole response 503 (per-job results included), the Worker's ping()
  // sees non-ok → retries → throws → the cron invocation is marked failed where someone can see it.
  // NB: the payments SUCCESS shape also carries an `errored` key (a per-candidate COUNT), and
  // slotsCreated's success value is not an object at all — so the failure marker is specifically the
  // boolean `errored: true`, discriminated on the VALUE, never bare `in`.
  const failedJob = (x: unknown): boolean =>
    typeof x === 'object' && x !== null && (x as { errored?: unknown }).errored === true;
  // The payments sweep never throws per candidate — a failed or quarantined reconciliation increments a
  // numeric `errored` COUNT instead (reconcilePaymentsPending). Those are only ever surfaced through a
  // non-2xx response (the cron treats any 2xx as healthy), so a positive count must fail the run too,
  // not just the boolean whole-step marker — otherwise a payment stuck un-reconciled looks fine forever.
  const paymentsErroredCount =
    typeof payments === 'object' &&
    payments !== null &&
    typeof (payments as { errored?: unknown }).errored === 'number'
      ? (payments as { errored: number }).errored
      : 0;
  const erroredJobs = [
    ...(failedJob(payments) || paymentsErroredCount > 0 ? ['payments'] : []),
    ...(failedJob(result) ? ['bookingMaintenance'] : []),
    ...(failedJob(slotsCreated) ? ['availability'] : []),
    ...(failedJob(reviewInvitesCreated) ? ['reviewInvites'] : []),
  ];
  if (erroredJobs.length > 0) {
    return jsonError(
      503,
      'maintenance_partial_failure',
      `Maintenance job(s) failed: ${erroredJobs.join(', ')} — see server logs`,
      { ...result, slotsCreated, payments, reviewInvitesCreated, erroredJobs },
    );
  }
  return jsonOk({ ...result, slotsCreated, payments, reviewInvitesCreated });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
