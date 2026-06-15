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
  const rows = [];
  for (let i = 0; i < Math.max(1, input.repeatDays); i += 1) {
    const start = new Date(`${input.date}T${input.time}:00`);
    start.setDate(start.getDate() + i);
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    rows.push({
      activity_option_id: input.activityOptionId,
      operator_id: input.operatorId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      capacity: input.capacity,
    });
  }
  const { error, count } = await sb
    .from('session_occurrences')
    .upsert(rows, { onConflict: 'activity_option_id,starts_at', ignoreDuplicates: true, count: 'exact' });
  if (error) throw error;
  return count ?? rows.length;
}

export async function deleteOccurrence(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('session_occurrences').delete().eq('id', id);
  if (error) throw error;
}
