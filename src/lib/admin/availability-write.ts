import { getBrowserSupabase } from '@/lib/supabase/browser';
import { readAll } from './read-all';
import {
  addDayKeys,
  daysBetween,
  groupIntoRanges,
  isoWeekday,
  mauritiusDay,
  mauritiusDayStartUtc,
  normaliseClosedRange,
  slotStartUtc,
  type DayRange,
} from './closed-dates';

/* Admin availability writes — staff RLS permits direct writes to session_occurrences.
 * (The old per-occurrence helpers — loadOccurrences/addOccurrences/deleteOccurrence — were dead code
 * with zero callers and inserted slots that bypassed the per-option effective-capacity rules; removed
 * when option-scoped capacity landed.) */

export interface OptionRow {
  id: string;
  name: string;
  /** Per-option daily capacity override (null = uses the activity's number). */
  dailyCapacity: number | null;
  /** Per-option "guests per trip" override for SHARED options (null = uses the activity's). */
  guestsPerTrip: number | null;
  /** True for a private option — its pool counts TRIPS per day, not guests. */
  isPrivate: boolean;
  /** A private option's own guests-per-trip figure (private_max_guests) + the floor it may not go
   *  under (the guests its base price covers). Null for shared options. */
  privateMaxGuests: number | null;
  privateIncluded: number | null;
  /** ISO weekdays (Mon=1 … Sun=7) this option does NOT run; empty = every day (the "Runs on" control). */
  closedWeekdays: number[];
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
    .select(
      'id, name, daily_capacity, guests_per_trip, private_base_minor, private_included, private_max_guests, closed_weekdays',
    )
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
      guestsPerTrip: o.guests_per_trip,
      isPrivate: o.private_base_minor != null,
      privateMaxGuests: o.private_max_guests,
      privateIncluded: o.private_included,
      closedWeekdays: o.closed_weekdays ?? [],
    })),
  };
}

/** Open-ended availability state: the activity's daily capacity — the whole day's POOL, null = not
 *  bookable — plus its "guests per trip" default (how many guests one booking may hold on a shared
 *  option; null = uncapped). */
export async function loadAvailabilityState(
  activityId: string,
): Promise<{ capacity: number | null; guestsPerTrip: number | null }> {
  const { data, error } = await getBrowserSupabase()
    .from('activities')
    .select('daily_capacity, guests_per_trip')
    .eq('id', activityId)
    .maybeSingle();
  if (error) throw error;
  return {
    capacity: data?.daily_capacity ?? null,
    guestsPerTrip: data?.guests_per_trip ?? null,
  };
}

/**
 * Make an activity bookable every day with a daily `capacity` (the whole day's POOL — e.g.
 * "36 guests per day" for a shared option, "20 trips" for a private one), open-ended: the customer
 * calendar materialises the day slots it needs on demand, so there's no annual re-enable. A day is
 * full once its bookings reach the capacity. Re-running just changes the number — and propagates it
 * to any upcoming days already materialised.
 *
 * `guestsPerTrip` (when the key is passed) sets the "guests per trip" figure alongside: how many
 * guests ONE booking may hold. On the activity path it writes activities.guests_per_trip; on the
 * option path it writes the option's own override — or, for a PRIVATE option, private_max_guests
 * (the server validates it against the guests the base price covers). Pass null to clear (shared
 * only). The admin UI derives the pool as trips × guestsPerTrip before calling.
 *
 * With `optionId`, the numbers apply to THAT OPTION only (its own pool — e.g. a private option's
 * trips/day), leaving the other options on the activity's numbers. `capacity: null` with a
 * `guestsPerTrip` is a guests-only update (option path only).
 */
export async function setDailyCapacity(
  activityId: string,
  capacity: number | null,
  opts: { optionId?: string; guestsPerTrip?: number | null } = {},
): Promise<void> {
  // One atomic RPC: update the activity/option, propagate the capacity to upcoming slots, and
  // materialize the window. Doing this in a single transaction avoids the partial state the old
  // three-call sequence could leave (capacity set but slots un-propagated, or no days materialized).
  const p: Record<string, string | number | null> = { activityId };
  if (capacity != null) p.capacity = capacity;
  if (opts.optionId) p.optionId = opts.optionId;
  if ('guestsPerTrip' in opts) p.guestsPerTrip = opts.guestsPerTrip ?? null;
  // The RPC rewrites every upcoming slot's capacity, closed days included — keep those closed.
  await keepingClosedDates(activityId, async () => {
    const { error } = await getBrowserSupabase().rpc('set_daily_capacity_atomic', { p });
    if (error) throw error;
  });
}

/** Clear an option's capacity AND guests-per-trip overrides — it falls back to the activity's
 *  numbers. (A private option's private_max_guests is pricing config and is left alone.) */
export async function clearOptionCapacity(activityId: string, optionId: string): Promise<void> {
  await keepingClosedDates(activityId, async () => {
    const { error } = await getBrowserSupabase().rpc('set_daily_capacity_atomic', {
      p: { activityId, optionId, inherit: true },
    });
    if (error) throw error;
  });
}

/**
 * Stop availability: clear the daily capacity (so no new days materialise) and remove upcoming
 * slots — but only ones with NO booked items and NO active holds, so we never strand a
 * customer's confirmed booking (FK restrict) or cascade-delete a live hold. This also clears every
 * closed date: those days come back open if the tour is made bookable again.
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

/**
 * Set which weekdays ONE option runs. `closedWeekdays` is the ISO days it does NOT run (Mon=1 …
 * Sun=7); an empty array means every day. One atomic RPC writes the setting and reconciles the ~6
 * months already materialised — closing the future slots a booking/hold/quote references, deleting
 * the empty ones, then re-materialising to refill any weekday switched back on. Derive the array from
 * the seven "Runs on" checkboxes with availableToClosedWeekdays().
 */
export async function setOptionWeekdays(optionId: string, closedWeekdays: number[]): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('set_option_weekdays_atomic', {
    p: { optionId, closedWeekdays },
  });
  if (error) throw error;
}

// ── Closed dates ────────────────────────────────────────────────────────────────────────────────
// The rules are documented in closed-dates.ts: a closed day = that day's slot at capacity 0.

/** The options a closure applies to: live (not archived) and bookable (an effective pool above 0). */
interface ClosureScope {
  operatorId: string;
  durationMinutes: number;
  options: Array<{ id: string; capacity: number; closedWeekdays: number[] }>;
}

interface SlotRow {
  id: string;
  activity_option_id: string;
  starts_at: string;
  capacity: number;
}

/** Ids per `.in()` request — keeps the PostgREST URL well under its length limit. */
const ID_CHUNK = 150;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadClosureScope(activityId: string): Promise<ClosureScope> {
  const sb = getBrowserSupabase();
  const { data: act, error } = await sb
    .from('activities')
    .select('operator_id, duration_minutes, daily_capacity')
    .eq('id', activityId)
    .maybeSingle();
  if (error) throw error;
  if (!act) throw new Error('Activity not found.');
  const { data: opts, error: optErr } = await sb
    .from('activity_options')
    .select('id, daily_capacity, status, closed_weekdays')
    .eq('activity_id', activityId);
  if (optErr) throw optErr;
  return {
    operatorId: act.operator_id,
    durationMinutes: act.duration_minutes ?? 240,
    options: (opts ?? [])
      .filter((o) => o.status !== 'archived')
      .map((o) => ({
        id: o.id,
        capacity: o.daily_capacity ?? act.daily_capacity ?? 0,
        closedWeekdays: o.closed_weekdays ?? [],
      }))
      .filter((o) => o.capacity > 0),
  };
}

/** Slots of `optionIds` from Mauritius day `from` (inclusive) to `to` (inclusive, or open-ended). */
async function loadSlots(
  optionIds: string[],
  from: string,
  to: string | null,
  onlyClosed = false,
): Promise<SlotRow[]> {
  if (optionIds.length === 0) return [];
  const sb = getBrowserSupabase();
  return readAll<SlotRow>((start, end) => {
    let q = sb
      .from('session_occurrences')
      .select('id, activity_option_id, starts_at, capacity')
      .in('activity_option_id', optionIds)
      .gte('starts_at', mauritiusDayStartUtc(from));
    if (to) q = q.lt('starts_at', mauritiusDayStartUtc(addDayKeys(to, 1)));
    if (onlyClosed) q = q.eq('capacity', 0);
    return q.order('starts_at').order('id').range(start, end);
  });
}

/**
 * Close each (option, day) pair: zero the day's slot, or — for a day not materialised yet (past the
 * cron's window, or deleted by an earlier weekday change) — insert it already at 0, exactly where
 * materialize_availability would have put it, so the cron finds the day taken and never opens it.
 * A weekday the option doesn't run is skipped: it has no slot to sell.
 */
async function closeDays(
  scope: ClosureScope,
  pairs: Array<{ optionId: string; day: string }>,
): Promise<void> {
  if (pairs.length === 0) return;
  const sb = getBrowserSupabase();
  const byId = new Map(scope.options.map((o) => [o.id, o]));
  const days = pairs.map((p) => p.day).sort();
  const slots = await loadSlots([...byId.keys()], days[0]!, days[days.length - 1]!);
  const slotsByKey = new Map<string, SlotRow[]>();
  for (const s of slots) {
    const key = `${s.activity_option_id}|${mauritiusDay(s.starts_at)}`;
    slotsByKey.set(key, [...(slotsByKey.get(key) ?? []), s]);
  }

  const now = Date.now();
  const toZero: string[] = [];
  const toInsert: Array<{
    activity_option_id: string;
    operator_id: string;
    starts_at: string;
    ends_at: string;
    capacity: number;
  }> = [];
  for (const { optionId, day } of pairs) {
    const option = byId.get(optionId);
    if (!option) continue;
    const existing = slotsByKey.get(`${optionId}|${day}`);
    if (existing) {
      for (const s of existing) if (s.capacity !== 0) toZero.push(s.id);
      continue;
    }
    const startsAt = slotStartUtc(day);
    if (option.closedWeekdays.includes(isoWeekday(day)) || Date.parse(startsAt) <= now) continue;
    toInsert.push({
      activity_option_id: optionId,
      operator_id: scope.operatorId,
      starts_at: startsAt,
      ends_at: new Date(Date.parse(startsAt) + scope.durationMinutes * 60_000).toISOString(),
      capacity: 0,
    });
  }

  for (const ids of chunks(toZero, ID_CHUNK)) {
    const { error } = await sb.from('session_occurrences').update({ capacity: 0 }).in('id', ids);
    if (error) throw error;
  }
  for (const rows of chunks(toInsert, ID_CHUNK)) {
    const { error } = await sb.from('session_occurrences').insert(rows);
    if (error) throw error;
  }
}

/** The (option, day) pairs closed from today on. */
async function closedPairs(scope: ClosureScope): Promise<Array<{ optionId: string; day: string }>> {
  const today = mauritiusDay(new Date());
  const slots = await loadSlots(
    scope.options.map((o) => o.id),
    today,
    null,
    true,
  );
  return slots.map((s) => ({ optionId: s.activity_option_id, day: mauritiusDay(s.starts_at) }));
}

/**
 * Run a write that rewrites upcoming slot capacities (the capacity editors), then put the closed days
 * back. Without this, changing "guests per trip" would silently reopen every closed date.
 */
async function keepingClosedDates(activityId: string, write: () => Promise<void>): Promise<void> {
  const before = await closedPairs(await loadClosureScope(activityId));
  await write();
  if (before.length === 0) return;
  // Re-read the scope: the write may have changed an option's pool (a pool of 0 has nothing to close).
  await closeDays(await loadClosureScope(activityId), before);
}

/** Upcoming closed dates of a tour, as runs of consecutive days. */
export async function loadClosedDates(activityId: string): Promise<DayRange[]> {
  const pairs = await closedPairs(await loadClosureScope(activityId));
  return groupIntoRanges(pairs.map((p) => p.day));
}

/**
 * Close `from`…`to` (Mauritius days, inclusive) to new bookings on every option of the tour. Guests
 * already booked on those days keep their booking. Returns the days actually closed (a start in the
 * past is moved up to today).
 */
export async function closeDates(
  activityId: string,
  from: string,
  to: string,
): Promise<{ from: string; to: string; days: number }> {
  const range = normaliseClosedRange(from, to, mauritiusDay(new Date()));
  const scope = await loadClosureScope(activityId);
  if (scope.options.length === 0) {
    throw new Error('This tour is not bookable right now, so there is nothing to close.');
  }
  const days = daysBetween(range.from, range.to);
  await closeDays(
    scope,
    scope.options.flatMap((o) => days.map((day) => ({ optionId: o.id, day }))),
  );
  return { ...range, days: days.length };
}

/** Reopen `from`…`to`: every closed slot in the range gets its option's normal daily pool back. */
export async function reopenDates(activityId: string, from: string, to: string): Promise<void> {
  const range = normaliseClosedRange(from, to, mauritiusDay(new Date()));
  const scope = await loadClosureScope(activityId);
  const sb = getBrowserSupabase();
  for (const option of scope.options) {
    const slots = await loadSlots([option.id], range.from, range.to, true);
    for (const ids of chunks(
      slots.map((s) => s.id),
      ID_CHUNK,
    )) {
      const { error } = await sb
        .from('session_occurrences')
        .update({ capacity: option.capacity })
        .in('id', ids);
      if (error) throw error;
    }
  }
}
