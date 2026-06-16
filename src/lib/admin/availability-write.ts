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

export async function loadActivityOptions(
  activityId: string,
): Promise<{ operatorId: string; durationMinutes: number | null; title: string; options: OptionRow[] }> {
  const sb = getBrowserSupabase();
  const { data: act, error } = await sb
    .from('activities')
    .select('operator_id, duration_minutes, title')
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
  const sb = getBrowserSupabase();
  const { error } = await sb.from('activities').update({ daily_capacity: capacity }).eq('id', activityId);
  if (error) throw error;

  const { data: opts } = await sb.from('activity_options').select('id').eq('activity_id', activityId);
  const optionIds = (opts ?? []).map((o) => o.id);
  if (optionIds.length > 0) {
    const { error: upErr } = await sb
      .from('session_occurrences')
      .update({ capacity })
      .in('activity_option_id', optionIds)
      .gte('starts_at', new Date().toISOString());
    if (upErr) throw upErr;
  }

  // The availability read no longer materializes day-slots; fill the window now so dates appear
  // immediately (the maintenance cron rolls it forward thereafter).
  const { error: matErr } = await sb.rpc('materialize_availability', { p: { activityId } });
  if (matErr) throw matErr;
}

/**
 * Stop availability: clear the daily capacity (so no new days materialise) and remove upcoming
 * slots — but only ones with NO booked items and NO active holds, so we never strand a
 * customer's confirmed booking (FK restrict) or cascade-delete a live hold.
 */
export async function stopAvailability(activityId: string): Promise<void> {
  const sb = getBrowserSupabase();
  const { error: capErr } = await sb
    .from('activities')
    .update({ daily_capacity: null })
    .eq('id', activityId);
  if (capErr) throw capErr;

  const { data: opts } = await sb.from('activity_options').select('id').eq('activity_id', activityId);
  const optionIds = (opts ?? []).map((o) => o.id);
  if (optionIds.length === 0) return;

  const { data: occ } = await sb
    .from('session_occurrences')
    .select('id')
    .in('activity_option_id', optionIds)
    .gte('starts_at', new Date().toISOString());
  const occIds = (occ ?? []).map((o) => o.id);
  if (occIds.length === 0) return;

  const { data: items } = await sb
    .from('booking_items')
    .select('session_occurrence_id')
    .in('session_occurrence_id', occIds);
  const { data: holds } = await sb
    .from('booking_holds')
    .select('session_occurrence_id')
    .in('session_occurrence_id', occIds)
    .eq('status', 'active');
  const busy = new Set<string>([
    ...(items ?? []).map((i) => i.session_occurrence_id),
    ...(holds ?? []).map((h) => h.session_occurrence_id),
  ]);
  const busyIds = occIds.filter((id) => busy.has(id));
  const deletable = occIds.filter((id) => !busy.has(id));

  // Booked/held days: close them so no one else can book — but keep the row (and its existing
  // booking/hold) intact. create_hold + availability both require status='open'.
  if (busyIds.length > 0) {
    const { error } = await sb
      .from('session_occurrences')
      .update({ status: 'closed' })
      .in('id', busyIds);
    if (error) throw error;
  }
  // Empty future days: remove entirely.
  if (deletable.length > 0) {
    const { error } = await sb.from('session_occurrences').delete().in('id', deletable);
    if (error) throw error;
  }
}
