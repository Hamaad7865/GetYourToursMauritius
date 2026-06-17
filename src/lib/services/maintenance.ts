import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';

const maintenanceResultSchema = z.object({
  holdsExpired: z.number().int(),
  bookingsExpired: z.number().int(),
});
export type MaintenanceResult = z.infer<typeof maintenanceResultSchema>;

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
