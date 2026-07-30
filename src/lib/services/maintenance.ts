import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { reconcilePaymentEvent } from '@/lib/payments/reconcile';
import { enqueueReviewInvites as enqueueReviewInvitesRpc } from './reviews';
import { fetchEurMurRate } from '@/lib/money/fx';

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

const fxStatusSchema = z.object({
  rate: z.coerce.number().nullish(),
  ageHours: z.coerce.number().nullish(),
});

export interface FxRefreshResult {
  /** True when a fresh upstream rate was fetched and stored this run. */
  refreshed: boolean;
  /** The rate now in force (stored value when the fetch failed), null only before any row exists. */
  rate: number | null;
  /** Hours since the in-force rate was quoted upstream. */
  ageHours: number | null;
}

/** A stored EUR→MUR rate older than this is an incident: checkout keeps charging (the pin falls back
 *  to the in-SQL floor rather than failing the customer), but the maintenance run must go loud so the
 *  cron dashboard shows red instead of a silently drifting charge rate. */
const FX_STALE_ALARM_HOURS = 48;

/**
 * Keep the server-controlled EUR→MUR rate fresh (the charge pin in api_create_payment reads it —
 * see 20260830000000). Runs on the maintenance cron, NEVER on a checkout request. Fetch failures are
 * tolerated silently while the stored rate is recent (last-known-good keeps charging); only a rate
 * stale beyond FX_STALE_ALARM_HOURS throws, which fails the maintenance run and surfaces on the cron
 * dashboard. Never fails the checkout path either way.
 */
export async function refreshFxRate(ctx: ServiceContext): Promise<FxRefreshResult> {
  const fresh = await fetchEurMurRate();
  if (fresh) {
    await callRpc(ctx, 'api_upsert_fx_rate', {
      rate: fresh.rate,
      source: fresh.source,
      fetchedAt: fresh.fetchedAt,
    });
    return { refreshed: true, rate: fresh.rate, ageHours: 0 };
  }

  const status = fxStatusSchema.parse(await callRpc(ctx, 'api_fx_rate_status', {}));
  const ageHours = status.ageHours ?? null;
  if (ageHours === null || ageHours > FX_STALE_ALARM_HOURS) {
    throw new Error(
      `EUR->MUR rate is stale (age ${ageHours === null ? 'unknown' : `${Math.round(ageHours)}h`}) ` +
        'and the upstream fetch keeps failing — charges are running on an old rate',
    );
  }
  return { refreshed: false, rate: status.rate ?? null, ageHours };
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
