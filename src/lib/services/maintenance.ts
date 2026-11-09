import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { reconcilePaymentEvent } from '@/lib/payments/reconcile';
import { enqueueReviewInvites as enqueueReviewInvitesRpc } from './reviews';

const maintenanceResultSchema = z.object({
  holdsExpired: z.number().int(),
  bookingsExpired: z.number().int(),
});
export type MaintenanceResult = z.infer<typeof maintenanceResultSchema>;

/** One stuck-pending candidate the sweep should re-query: the latest payment + its Peach checkout id. */
const pendingCheckoutSchema = z.object({
  ref: z.string(),
  paymentId: z.string(),
  checkoutId: z.string(),
});
const pendingCheckoutsSchema = z.array(pendingCheckoutSchema);

export interface ReconcileSweepResult {
  /** Candidates enumerated (stuck `payment_pending` bookings with a stored checkout id, within grace). */
  queried: number;
  /** Re-queried as a full successful payment and confirmed (or already confirmed and re-appended as a no-op). */
  confirmed: number;
  /** Still pending at the provider — left `payment_pending` to re-query next run. */
  pending: number;
  /** Reported failed/refunded/unknown by the provider — recorded but not a confirmation. */
  failed: number;
  /** A provider query or ledger write threw; logged (no PII) and skipped so one bad checkout can't abort the batch. */
  errored: number;
}

export interface ReconcilePaymentsPendingOptions {
  /** Only re-query bookings created within this window (default 240 = 4h). Older ones are expired by maintenance. */
  graceMinutes?: number;
  /** Cap candidates per run to bound the Peach API call volume (default 100). */
  limit?: number;
}

/**
 * Sweep stale holds and expire abandoned (never-paid, past-grace) bookings. Idempotent and safe
 * to run on a schedule; a late payment on an expired booking is handled as a refund, not a confirm.
 */
export async function runBookingMaintenance(
  ctx: ServiceContext,
  graceMinutes = 30,
): Promise<MaintenanceResult> {
  const data = await callRpc(ctx, 'run_booking_maintenance', { graceMinutes });
  return maintenanceResultSchema.parse(data);
}

/**
 * Fill open-ended day-slots forward (all activities, or one). Run by the maintenance cron so the
 * availability read stays pure, and immediately by the admin when an activity is made bookable.
 * Returns the number of slots created.
 */
export async function materializeAvailability(
  ctx: ServiceContext,
  activityId?: string,
): Promise<number> {
  const data = await callRpc(ctx, 'materialize_availability', activityId ? { activityId } : {});
  return z.number().int().parse(data);
}

/** Re-exported under the maintenance module's naming convention (the internal route imports every
 *  step from here). Not money-critical, so — unlike the payment/expiry steps — its position in the
 *  maintenance sequence doesn't matter for correctness. */
export async function enqueueReviewInvites(ctx: ServiceContext): Promise<number> {
  return enqueueReviewInvitesRpc(ctx);
}

/**
 * Queue the one checkout-recovery email (20261017000100) for shoppers whose web checkout expired
 * unpaid 2–24 hours ago. Every eligibility rule — switched-off flag, no money moved, one per person,
 * opt-outs, staff excluded — lives in the SQL. Returns how many were queued.
 */
export async function enqueueCheckoutRecovery(ctx: ServiceContext): Promise<number> {
  const data = await callRpc(ctx, 'api_enqueue_checkout_recovery', {});
  return z.coerce.number().int().parse(data);
}

/**
 * Chase the bookings taken as "pickup to be arranged" that still have no address: the guest at 48h
 * and again at 24h before departure, the owner at 24h. Idempotency keys carry the threshold, so each
 * booking is chased at most once per window and never once a pickup exists.
 *
 * Like the review sweep, not money-critical — its position in the maintenance sequence doesn't matter
 * for correctness. Returns the number of candidates seen this run (a booking inside 24h that was
 * already chased at 48h counts, even though only the 24h row is new).
 */
export async function enqueuePickupReminders(ctx: ServiceContext): Promise<number> {
  const data = await callRpc(ctx, 'api_enqueue_pickup_reminders', {});
  return z.coerce.number().int().parse(data);
}

/**
 * Chase the guest before each dated installment on a per-date scheduled booking, and alert the owner
 * when one goes overdue. The SQL (api_enqueue_installment_reminders) re-checks every gate — booking
 * confirmed, installment uncovered, within the lead window — and dedupes per installment, so this is
 * safe to run unconditionally each tick. Returns how many rows it enqueued.
 */
export async function enqueueInstallmentReminders(ctx: ServiceContext): Promise<number> {
  const data = await callRpc(ctx, 'api_enqueue_installment_reminders', {});
  return z.coerce.number().int().parse(data);
}

/**
 * Settle a late-pickup supplement we already hold but could not apply at settlement time — the guest
 * paid, then the departure was called off, and they have since been rescheduled onto a live date.
 *
 * The SQL re-checks every gate itself, so this is safe to run unconditionally on a schedule; it is
 * also what stops that money from sitting stranded behind a "Complete payment" button the guest has
 * already pressed once. Returns how many pickups actually landed this run.
 */
export async function applyFundedPickups(ctx: ServiceContext): Promise<number> {
  const data = await callRpc(ctx, 'api_apply_funded_pickups', {});
  return z.coerce.number().int().parse(data);
}

const purgeResultSchema = z.object({
  deleted: z.coerce.number().int(),
  aged: z.coerce.number().int(),
  overflow: z.coerce.number().int(),
});
export type PurgeErrorLogsResult = z.infer<typeof purgeResultSchema>;

/** Errors older than this are dropped. A month covers "it broke sometime last week" without letting
 *  the table grow into something nobody wants to open. */
const ERROR_LOG_RETENTION_DAYS = 30;

/**
 * Prune `error_logs` (see 20260831000000): rows past the retention window, plus anything beyond the
 * row cap the SQL enforces as a crash-loop backstop. Pure housekeeping — it touches no booking, no
 * payment and no customer-visible state.
 */
export async function purgeErrorLogs(ctx: ServiceContext): Promise<PurgeErrorLogsResult> {
  const data = await callRpc(ctx, 'api_purge_error_logs', { days: ERROR_LOG_RETENTION_DAYS });
  return purgeResultSchema.parse(data);
}

/** Pay-page funnel rows (20261017000000) are kept long enough to compare a whole high season against
 *  the autumn baseline. */
const CHECKOUT_FUNNEL_RETENTION_DAYS = 120;

/** Prune `checkout_funnel_events` — same two bounds as {@link purgeErrorLogs}. Pure housekeeping. */
export async function purgeCheckoutFunnelEvents(
  ctx: ServiceContext,
): Promise<PurgeErrorLogsResult> {
  const data = await callRpc(ctx, 'api_purge_checkout_funnel_events', {
    days: CHECKOUT_FUNNEL_RETENTION_DAYS,
  });
  return purgeResultSchema.parse(data);
}

/**
 * Webhook-less safety net: re-query the payment provider for recent `payment_pending` bookings (those
 * carrying a stored checkout id, within the grace window) and confirm the ones that actually paid. Reuses
 * the SAME idempotent settlement path as the client sync + (future) webhook — getCheckoutStatus →
 * reconcilePaymentEvent → append_payment_event — so confirmation behaves identically however the signal
 * arrives, and a checkout already settled by the client sync drops out of enumeration (or re-appends as a
 * ledger no-op). Service-role only: the enumeration RPC is granted to service_role, and reconcilePaymentEvent
 * appends across users via `ctx.admin`. Each candidate is independently guarded so one bad checkout (a
 * provider error, an unknown id) logs a non-PII line and continues — it never aborts the batch.
 */
export async function reconcilePaymentsPending(
  ctx: ServiceContext,
  opts: ReconcilePaymentsPendingOptions = {},
): Promise<ReconcileSweepResult> {
  const admin = ctx.admin;
  if (!admin) {
    // Reached only if a non-service-role context calls this — it would otherwise NPE on the append client.
    throw new Error(
      'reconcilePaymentsPending requires a service-role context (ctx.admin is missing)',
    );
  }

  const params: Record<string, number> = {};
  if (opts.graceMinutes !== undefined) params.graceMinutes = opts.graceMinutes;
  if (opts.limit !== undefined) params.limit = opts.limit;
  const data = await callRpc(ctx, 'api_pending_payment_checkouts', params);
  const candidates = pendingCheckoutsSchema.parse(data);

  const result: ReconcileSweepResult = {
    queried: candidates.length,
    confirmed: 0,
    pending: 0,
    failed: 0,
    errored: 0,
  };

  for (const candidate of candidates) {
    try {
      const event = await ctx.payments.getCheckoutStatus(candidate.checkoutId);
      const reconciled = await reconcilePaymentEvent(admin, event);
      if (reconciled.confirmed) result.confirmed += 1;
      else if (reconciled.outcome.startsWith('quarantined:')) {
        // A settled signal Peach reported incompletely (missing amount/currency/reference) — nothing
        // was written; the next sweep re-queries. Counted as errored so a persistent one is visible
        // in the summary, not silently filed under "payment failed".
        result.errored += 1;
        console.error('payment reconcile sweep: settled event quarantined', {
          ref: candidate.ref,
          outcome: reconciled.outcome,
        });
      } else if (event.outcome === 'pending') result.pending += 1;
      else result.failed += 1;
    } catch (error) {
      // No PII / secrets — only the booking ref (already in logs/URLs) + a short message.
      result.errored += 1;
      console.error('payment reconcile sweep: candidate failed', {
        ref: candidate.ref,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  return result;
}

export interface LateCaptureSweepResult {
  /** Payment rows whose sessions were re-queried this run. */
  queried: number;
  /** Rows where the provider reported a capture that is now on the ledger. */
  recorded: number;
  /** A provider query or ledger write threw, or the capture was quarantined. Retried next run. */
  errored: number;
}

export interface ReconcileLateCapturesOptions {
  /** Only look at rows touched within this window (default 180 = 3h). */
  windowMinutes?: number;
  /** Cap rows per run to bound Peach status calls (default 50). */
  limit?: number;
}

/** A booking in these states is still waiting for its money; reconcilePaymentsPending owns it. */
const STILL_WAITING = new Set(['draft', 'held', 'payment_pending']);

/**
 * Catch money that arrives where no other sweep looks.
 *
 * reconcilePaymentsPending only enumerates bookings still `payment_pending`, plus pickup and balance
 * rows. Two kinds of payment row fall outside it:
 *  - a `booking` row whose booking stopped waiting (expired, cancelled, failed) while a Peach session
 *    on it was still open. Production 2026-10-30, BMT41EDB8E4EA1D4: the cron expired the booking and the
 *    guest paid on the open session 90 seconds later. Nothing recorded it.
 *  - a `change_addon` row (the difference for a staff-proposed tour change), which no sweep covered.
 *
 * Only a `paid` answer is recorded. Anything else writes nothing, so a row nobody paid adds no ledger
 * noise and stops being looked at once the window passes. append_payment_event then does what it
 * always does with a capture: a booking that is no longer live goes to refund_pending (the owner and
 * guest are told), a confirmed booking's tour-change payment applies the change.
 *
 * The window reads `updated_at`, not `checkout_created_at`: retiring a session nulls
 * checkout_created_at, yet the retired session stays payable at Peach for about 30 minutes. Every mint
 * and every retire stamps updated_at, so it is never earlier than the last moment a session on the
 * row could still capture.
 */
export async function reconcileLateCaptures(
  ctx: ServiceContext,
  opts: ReconcileLateCapturesOptions = {},
): Promise<LateCaptureSweepResult> {
  const admin = ctx.admin;
  if (!admin) {
    throw new Error('reconcileLateCaptures requires a service-role context (ctx.admin is missing)');
  }
  const windowMinutes = opts.windowMinutes ?? 180;
  const since = new Date(ctx.now().getTime() - windowMinutes * 60_000).toISOString();

  const { data: rows, error } = await admin
    .from('payments')
    .select('id, booking_id, purpose, provider_checkout_id, prev_provider_checkout_id')
    .gte('updated_at', since)
    .eq('paid_minor', 0)
    .in('purpose', ['booking', 'change_addon'])
    .order('updated_at', { ascending: false })
    // Wider than the call cap: rows still waiting are dropped below, and must not crowd out late ones.
    .limit(500);
  if (error) throw new Error(error.message);

  const withSessions = (rows ?? []).filter(
    (row) => row.provider_checkout_id || row.prev_provider_checkout_id,
  );
  const bookingIds = [
    ...new Set(withSessions.filter((r) => r.purpose === 'booking').map((r) => r.booking_id)),
  ];
  const waiting = new Set<string>();
  if (bookingIds.length > 0) {
    const { data: bookings, error: bookingsErr } = await admin
      .from('bookings')
      .select('id, status')
      .in('id', bookingIds);
    if (bookingsErr) throw new Error(bookingsErr.message);
    for (const b of bookings ?? []) if (STILL_WAITING.has(b.status)) waiting.add(b.id);
  }
  const candidates = withSessions
    .filter((row) => row.purpose !== 'booking' || !waiting.has(row.booking_id))
    .slice(0, opts.limit ?? 50);

  const result: LateCaptureSweepResult = { queried: candidates.length, recorded: 0, errored: 0 };
  for (const row of candidates) {
    try {
      const sessions = [row.provider_checkout_id, row.prev_provider_checkout_id].filter(
        (id, i, all): id is string => Boolean(id) && all.indexOf(id) === i,
      );
      for (const checkoutId of sessions) {
        const event = await ctx.payments.getCheckoutStatus(checkoutId);
        if (event.outcome !== 'paid') continue;
        const reconciled = await reconcilePaymentEvent(admin, event);
        if (reconciled.outcome.startsWith('quarantined:') || !reconciled.found) {
          result.errored += 1;
          console.error('late capture sweep: capture not recorded', {
            paymentId: row.id,
            outcome: reconciled.found ? reconciled.outcome : 'payment_not_found',
          });
        } else {
          result.recorded += 1;
          console.warn('late capture sweep: recorded a capture no other path caught', {
            paymentId: row.id,
            purpose: row.purpose,
          });
        }
        break;
      }
    } catch (err) {
      result.errored += 1;
      console.error('late capture sweep: candidate failed', {
        paymentId: row.id,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }
  return result;
}
