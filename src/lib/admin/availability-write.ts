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
  const { error } = await getBrowserSupabase().rpc('set_daily_capacity_atomic', { p });
  if (error) throw error;
}

/** Clear an option's capacity AND guests-per-trip overrides — it falls back to the activity's
 *  numbers. (A private option's private_max_guests is pricing config and is left alone.) */
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
