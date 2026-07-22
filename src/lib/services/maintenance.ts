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
