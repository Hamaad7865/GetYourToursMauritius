import { getBrowserSupabase } from '@/lib/supabase/browser';

/* Admin availability writes — staff RLS permits direct writes to session_occurrences.
 * (The old per-occurrence helpers — loadOccurrences/addOccurrences/deleteOccurrence — were dead code
 * with zero callers and inserted slots that bypassed the per-option effective-capacity rules; removed
 * when option-scoped capacity landed.) */

export interface OptionRow {
  id: string;
  name: string;
  /** Per-option daily capacity override (null = uses the activity's number). */
  dailyCapacity: number | null;
  /** True for a private option — its pool counts TRIPS per day, not guests. */
  isPrivate: boolean;
}

export async function loadActivityOptions(activityId: string): Promise<{
  operatorId: string;
  durationMinutes: number | null;
  title: string;
  pricingMode: string;
  options: OptionRow[];
}> {
  const sb = getBrowserSupabase();
  const { data: act, error } = await sb
    .from('activities')
    .select('operator_id, duration_minutes, title, pricing_mode')
    .eq('id', activityId)
    .maybeSingle();
  if (error) throw error;
  if (!act) throw new Error('Activity not found.');
  const { data: opts } = await sb
    .from('activity_options')
    .select('id, name, daily_capacity, private_base_minor')
    .eq('activity_id', activityId)
    .order('position');
  return {
    operatorId: act.operator_id,
    durationMinutes: act.duration_minutes,
    title: act.title,
    pricingMode: act.pricing_mode ?? 'per_person',
    options: (opts ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      dailyCapacity: o.daily_capacity,
      isPrivate: o.private_base_minor != null,
    })),
  };
}

/** Open-ended availability state: the activity's daily capacity (null = not bookable). */
export async function loadAvailabilityState(activityId: string): Promise<{ capacity: number | null }> {
  const { data, error } = await getBrowserSupabase()
    .from('activities')
    .select('daily_capacity')
    .eq('id', activityId)
    .maybeSingle();
  if (error) throw error;
  return { capacity: data?.daily_capacity ?? null };
}

/**
 * Make an activity bookable every day with a daily `capacity` (e.g. "10 per day"), open-ended:
 * the customer calendar materialises the day slots it needs on demand, so there's no annual
 * re-enable. A day is full once its bookings reach the capacity. Re-running just changes the
 * number — and propagates it to any upcoming days already materialised.
 *
 * With `optionId`, the capacity applies to THAT OPTION only (its own pool — e.g. a private
 * option's trips/day), leaving the other options on the activity's number. The activity-wide
 * form never overwrites an option that has its own pool.
 */
export async function setDailyCapacity(activityId: string, capacity: number, optionId?: string): Promise<void> {
  // One atomic RPC: update the activity/option, propagate the capacity to upcoming slots, and
  // materialize the window. Doing this in a single transaction avoids the partial state the old
  // three-call sequence could leave (capacity set but slots un-propagated, or no days materialized).
  const { error } = await getBrowserSupabase().rpc('set_daily_capacity_atomic', {
    p: optionId ? { activityId, capacity, optionId } : { activityId, capacity },
  });
  if (error) throw error;
}

/** Clear an option's capacity override — it falls back to the activity's daily number. */
export async function clearOptionCapacity(activityId: string, optionId: string): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('set_daily_capacity_atomic', {
    p: { activityId, optionId, inherit: true },
  });
  if (error) throw error;
}

/**
 * Stop availability: clear the daily capacity (so no new days materialise) and remove upcoming
 * slots — but only ones with NO booked items and NO active holds, so we never strand a
 * customer's confirmed booking (FK restrict) or cascade-delete a live hold.
 */
export async function stopAvailability(activityId: string): Promise<void> {
  // One atomic RPC: clear the capacity, CLOSE upcoming slots that have a booking or active hold
  // (keeping the row + booking intact), and DELETE the empty ones. Running it as a single
  // transaction means a mid-sequence failure can't leave slots still bookable after "stop".
  const { error } = await getBrowserSupabase().rpc('stop_availability_atomic', {
    p: { activityId },
  });
  if (error) throw error;
}
