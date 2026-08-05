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
  enqueuePickupReminders,
  applyFundedPickups,
  refreshFxRate,
  purgeErrorLogs,
} from '@/lib/services/maintenance';
import { recordError, describeThrown } from '@/lib/error-log';

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

  // A failed step is logged AND recorded durably: the cron runs unattended every few minutes, so
  // "which sweep has been failing since Tuesday?" is exactly the question error_logs exists to answer.
  const log = async (step: string, err: unknown): Promise<void> => {
    const { errorName, message, stack } = describeThrown(err);
    console.error(`[maintenance] ${step} failed:`, message);
    await recordError({
      source: 'cron',
      event: 'cron_step_failed',
      message,
      errorName,
      stack,
      route: '/api/v1/internal/maintenance',
      method: 'POST',
      context: { step },
    });
  };

  // 0) Refresh the server-controlled EUR→MUR charge rate (api_create_payment pins charges from it).
  //    Off the checkout critical path by design; tolerant of upstream failures while the stored rate
  //    is recent, loud (fails the run) once it goes stale beyond the alarm window.
  let fx: Awaited<ReturnType<typeof refreshFxRate>> | { errored: true } = { errored: true };
  try {
    fx = await refreshFxRate(ctx);
  } catch (err) {
    await log('fx rate refresh', err);
  }

  // 1) Webhook-less safety net: re-query the provider for stuck `payment_pending` bookings and confirm
  //    the ones that paid (idempotent via append_payment_event) — FIRST, so the next step can't expire them.
  let payments: Awaited<ReturnType<typeof reconcilePaymentsPending>> | { errored: true } = {
    errored: true,
  };
  // Whether step 1 failed WHOLESALE — the enumeration RPC erroring, or a transport failure taking the
  // batch. A per-candidate failure never lands here: reconcilePaymentsPending catches those inside and
  // only increments its numeric `errored` count.
  let reconcileFailed = false;
  try {
    payments = await reconcilePaymentsPending(ctx);
  } catch (err) {
    reconcileFailed = true;
    await log('payment reconcile sweep', err);
  }

  // 2) Sweep stale holds + expire genuinely-abandoned bookings (now that any real payment is confirmed).
  //
  // The ordering above is load-bearing, so ENFORCE it rather than only documenting it. A booking that
  // paid at ~minute 29 whose webhook never arrived has no ledger event yet, and run_booking_maintenance
  // reads its money guard off the PAYMENTS rows (a settled status, paid_minor > 0, or
  // settlement_review_at) — an unreconciled payment shows none of those. So the sweep would expire it,
  // release the seat and leave the money taken. That is the exact case step 1 exists to catch: if step
  // 1 could not run, step 2 must not run either. The next tick (5 minutes) retries both, in order.
  let result: Awaited<ReturnType<typeof runBookingMaintenance>> | { errored: true } = {
    errored: true,
  };
  if (reconcileFailed) {
    // Left as `{ errored: true }` on purpose: the run is genuinely not healthy, so it must still 503
    // and show up as a failed cron invocation rather than a quiet skip.
    await log(
      'booking maintenance sweep',
      new Error(
        'skipped: the payment reconcile step failed this run, so expiring now could release a booking that has paid',
      ),
    );
  } else {
    try {
      result = await runBookingMaintenance(ctx);
    } catch (err) {
      await log('booking maintenance sweep', err);
    }
  }

  // 3) Roll the open-ended availability window forward (now that the read path no longer fills it).
  let slotsCreated: Awaited<ReturnType<typeof materializeAvailability>> | { errored: true } = {
    errored: true,
  };
  try {
    slotsCreated = await materializeAvailability(ctx);
  } catch (err) {
    await log('availability materialize', err);
  }

  // 4) Post-trip review requests — not money-critical, so position doesn't matter for correctness.
  let reviewInvitesCreated: number | { errored: true } = { errored: true };
  try {
    reviewInvitesCreated = await enqueueReviewInvites(ctx);
  } catch (err) {
    await log('review invites sweep', err);
  }

  // 5) Chase a still-missing pickup at 48h / 24h before departure. Not money-critical either, so
  //    position doesn't matter — but it IS customer-affecting (a guest nobody can collect), so a
  //    failure counts towards the red verdict below alongside the other sweeps.
  let pickupRemindersEnqueued: number | { errored: true } = { errored: true };
  try {
    pickupRemindersEnqueued = await enqueuePickupReminders(ctx);
  } catch (err) {
    await log('pickup reminder sweep', err);
  }

  // 6) Settle any late-pickup supplement we hold but could not apply (the departure was called off
  //    and the guest has since been rescheduled). Money already taken, so a failure here counts.
  let fundedPickupsApplied: number | { errored: true } = { errored: true };
  try {
    fundedPickupsApplied = await applyFundedPickups(ctx);
  } catch (err) {
    await log('funded pickup apply sweep', err);
  }

  // 7) Prune error_logs (retention + the crash-loop row cap). Housekeeping, and deliberately NOT part
  //    of the pass/fail verdict below: a red cron on this dashboard means customers are affected
  //    (money, emails, availability). A purge that failed is recorded in error_logs itself — where
  //    anyone reading the table will see it — and retried on the next tick.
  let errorLogsPurged: Awaited<ReturnType<typeof purgeErrorLogs>> | { errored: true } = {
    errored: true,
  };
  try {
    errorLogsPurged = await purgeErrorLogs(ctx);
  } catch (err) {
    await log('error log purge', err);
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
    ...(failedJob(fx) ? ['fxRate'] : []),
    ...(failedJob(payments) || paymentsErroredCount > 0 ? ['payments'] : []),
    ...(failedJob(result) ? ['bookingMaintenance'] : []),
    ...(failedJob(slotsCreated) ? ['availability'] : []),
    ...(failedJob(reviewInvitesCreated) ? ['reviewInvites'] : []),
    ...(failedJob(pickupRemindersEnqueued) ? ['pickupReminders'] : []),
    ...(failedJob(fundedPickupsApplied) ? ['fundedPickups'] : []),
  ];
  if (erroredJobs.length > 0) {
    return jsonError(
      503,
      'maintenance_partial_failure',
      `Maintenance job(s) failed: ${erroredJobs.join(', ')} — see server logs`,
      {
        ...result,
        slotsCreated,
        payments,
        reviewInvitesCreated,
        pickupRemindersEnqueued,
        fundedPickupsApplied,
        fx,
        errorLogsPurged,
        erroredJobs,
      },
    );
  }
  return jsonOk({
    ...result,
    slotsCreated,
    payments,
    reviewInvitesCreated,
    pickupRemindersEnqueued,
    fundedPickupsApplied,
    fx,
    errorLogsPurged,
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
