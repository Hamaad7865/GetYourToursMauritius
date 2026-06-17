import { getBrowserSupabase } from '@/lib/supabase/browser';

/* Admin availability writes — staff RLS permits direct writes to session_occurrences. */

export interface OptionRow {
  id: string;
  name: string;
}
export interface OccurrenceRow {
  id: string;
  activityOptionId: string;
  optionName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: string;
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
    .select('id, name')
    .eq('activity_id', activityId)
    .order('position');
  return {
    operatorId: act.operator_id,
    durationMinutes: act.duration_minutes,
    title: act.title,
    pricingMode: act.pricing_mode ?? 'per_person',
    options: opts ?? [],
  };
}

export async function loadOccurrences(activityId: string): Promise<OccurrenceRow[]> {
  const sb = getBrowserSupabase();
  const { data: opts } = await sb.from('activity_options').select('id, name').eq('activity_id', activityId);
  const optionIds = (opts ?? []).map((o) => o.id);
  if (optionIds.length === 0) return [];
  const names = new Map((opts ?? []).map((o) => [o.id, o.name]));
  const { data, error } = await sb
    .from('session_occurrences')
    .select('id, activity_option_id, starts_at, ends_at, capacity, status')
    .in('activity_option_id', optionIds)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at');
  if (error) throw error;
  return (data ?? []).map((o) => ({
    id: o.id,
    activityOptionId: o.activity_option_id,
    optionName: names.get(o.activity_option_id) ?? '',
    startsAt: o.starts_at,
    endsAt: o.ends_at,
    capacity: o.capacity,
    status: o.status,
  }));
}

/** Add one or more daily slots for an option, starting on `date` at `time` (local). */
export async function addOccurrences(input: {
  activityOptionId: string;
  operatorId: string;
  date: string;
  time: string;
  capacity: number;
  durationMinutes: number;
  repeatDays: number;
}): Promise<number> {
  const sb = getBrowserSupabase();
  const targets: Date[] = [];
  for (let i = 0; i < Math.max(1, input.repeatDays); i += 1) {
    const start = new Date(`${input.date}T${input.time}:00`);
    start.setDate(start.getDate() + i);
    targets.push(start);
  }
  // Skip slots that already exist for this option (app-level idempotency — no reliance on a
  // unique constraint / ON CONFLICT target the database might be missing).
  const minIso = new Date(Math.min(...targets.map((d) => d.getTime()))).toISOString();
  const { data: existing } = await sb
    .from('session_occurrences')
    .select('starts_at')
    .eq('activity_option_id', input.activityOptionId)
    .gte('starts_at', minIso);
  const have = new Set((existing ?? []).map((o) => new Date(o.starts_at).getTime()));
  const rows = targets
    .filter((start) => !have.has(start.getTime()))
    .map((start) => ({
      activity_option_id: input.activityOptionId,
      operator_id: input.operatorId,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + input.durationMinutes * 60_000).toISOString(),
      capacity: input.capacity,
    }));
  if (rows.length === 0) return 0;
  const { error } = await sb.from('session_occurrences').insert(rows);
  if (error) throw error;
  return rows.length;
}

export async function deleteOccurrence(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('session_occurrences').delete().eq('id', id);
  if (error) throw error;
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
 */
export async function setDailyCapacity(activityId: string, capacity: number): Promise<void> {
  // One atomic RPC: update the activity, propagate the capacity to upcoming slots, and materialize
  // the window. Doing this in a single transaction avoids the partial state the old three-call
  // sequence could leave (capacity set but slots un-propagated, or no days materialized).
  const { error } = await getBrowserSupabase().rpc('set_daily_capacity_atomic', {
    p: { activityId, capacity },
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
