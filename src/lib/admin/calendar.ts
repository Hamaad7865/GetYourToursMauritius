import { getBrowserSupabase } from '@/lib/supabase/browser';

/* Admin operations calendar. Staff RLS (occurrences_staff / bookings_staff / booking_items_staff)
 * grants full read on the departure sheet, so the month aggregate is the only thing that needs an
 * RPC — a month across the catalogue is ~1,800 occurrences and aggregating that in the browser is
 * waste. The day drawer reads through PostgREST like the rest of admin. The two mutations go through
 * SECURITY DEFINER RPCs because they must move seats / fan out atomically. */

/** Why a departure was called off. Mirrors the reasons api_weather_cancel_occurrence accepts. */
export type CallOffReason = 'weather' | 'sea_conditions' | 'safety' | 'min_group';

export const CALL_OFF_REASONS: Array<{ value: CallOffReason; label: string }> = [
  { value: 'weather', label: 'Weather' },
  { value: 'sea_conditions', label: 'Sea conditions' },
  { value: 'safety', label: 'Safety call' },
  { value: 'min_group', label: 'Too few travellers' },
];

export interface CalendarDay {
  day: string;
  departures: number;
  cancelled: number;
  pax: number;
  seatsLeft: number;
}

export interface DayBooking {
  ref: string;
  status: string;
  customerName: string;
  customerPhone: string | null;
  pax: number;
}

export interface DayDeparture {
  occurrenceId: string;
  activityOptionId: string;
  startsAt: string;
  status: string;
  capacity: number;
  activityTitle: string;
  optionName: string;
  pax: number;
  bookings: DayBooking[];
}

export interface MoveTarget {
  occurrenceId: string;
  startsAt: string;
  seatsLeft: number;
}

/** PostgREST embeds a to-one relation as an object|array|null; normalise to a single row. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * The UTC instants bounding a Mauritius-local calendar day. Mauritius is UTC+4 with no DST, so the
 * offset is a constant — but it must be applied, or a query near midnight silently reads the wrong
 * day (the bug 20260718120000 was written to fix).
 */
export function mauritiusDayBounds(day: string): { startUtc: string; endUtc: string } {
  const start = new Date(`${day}T00:00:00+04:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/** Per-day load for a month, for the grid. Staff-only RPC. */
export async function loadCalendarMonth(from: string, to: string): Promise<CalendarDay[]> {
  const { data, error } = await getBrowserSupabase().rpc('api_admin_calendar_month', {
    p: { from, to },
  });
  if (error) throw error;
  return (data ?? []) as unknown as CalendarDay[];
}

interface RawDayRow {
  id: string;
  activity_option_id: string;
  starts_at: string;
  status: string;
  capacity: number;
  activity_options:
    | { name: string; activities: { title: string } | { title: string }[] | null }
    | Array<{ name: string; activities: { title: string } | { title: string }[] | null }>
    | null;
  booking_items: Array<{
    quantity: number;
    pax: number | null;
    bookings:
      | { ref: string; status: string; customer_name: string; customer_phone: string | null }
      | Array<{ ref: string; status: string; customer_name: string; customer_phone: string | null }>
      | null;
  }> | null;
}

/**
 * The BOOKED departures on one Mauritius day, with the guests on each.
 *
 * Availability is materialised for every activity every day, so a day has ~45 occurrences but only a
 * handful carry guests. The operator cares about the booked ones — the people to plan for and the
 * departures worth calling off — so a departure with no confirmed/completed booking is dropped here
 * rather than cluttering the drawer.
 *
 * Only `confirmed` / `completed` bookings count — the same set `used_capacity` counts. Headcount is
 * `pax ?? quantity`: for a vehicle line `quantity` is the number of VEHICLES, so summing it would
 * undercount the people.
 */
export async function loadDaySchedule(day: string): Promise<DayDeparture[]> {
  const { startUtc, endUtc } = mauritiusDayBounds(day);
  const { data, error } = await getBrowserSupabase()
    .from('session_occurrences')
    .select(
      `id, activity_option_id, starts_at, status, capacity,
       activity_options ( name, activities ( title ) ),
       booking_items ( quantity, pax, bookings ( ref, status, customer_name, customer_phone ) )`,
    )
    .gte('starts_at', startUtc)
    .lt('starts_at', endUtc)
    .order('starts_at', { ascending: true })
    .returns<RawDayRow[]>();
  if (error) throw error;

  const out: DayDeparture[] = [];
  for (const raw of data ?? []) {
    const opt = one(raw.activity_options);
    const bookings: DayBooking[] = [];
    for (const item of raw.booking_items ?? []) {
      const b = one(item.bookings);
      if (!b || (b.status !== 'confirmed' && b.status !== 'completed')) continue;
      const pax = item.pax ?? item.quantity;
      const existing = bookings.find((x) => x.ref === b.ref);
      // A booking with several lines on one departure is one party, not several.
      if (existing) existing.pax += pax;
      else
        bookings.push({
          ref: b.ref,
          status: b.status,
          customerName: b.customer_name,
          customerPhone: b.customer_phone,
          pax,
        });
    }
    // Only surface departures that actually have guests on them.
    if (bookings.length === 0) continue;
    out.push({
      occurrenceId: raw.id,
      activityOptionId: raw.activity_option_id,
      startsAt: raw.starts_at,
      status: raw.status,
      capacity: raw.capacity,
      activityTitle: one(opt?.activities)?.title ?? 'Untitled',
      optionName: opt?.name ?? '',
      pax: bookings.reduce((s, b) => s + b.pax, 0),
      bookings,
    });
  }
  return out;
}

interface RawTargetRow {
  id: string;
  starts_at: string;
  capacity: number;
  booking_items: Array<{
    quantity: number;
    bookings: { status: string } | Array<{ status: string }> | null;
  }> | null;
}

/**
 * Future open departures of the same option a booking could be moved to, with free units.
 *
 * Seats are counted in booking UNITS (sum of `quantity`) because that is what occurrence.capacity is
 * denominated in — the same reason api_reschedule_booking gates on units and not on the headcount.
 * Only confirmed/completed bookings consume, mirroring used_capacity; live holds are not counted here,
 * so a target can still be rejected by the RPC's authoritative re-check. That is the right way round:
 * the list is a convenience, the RPC is the truth.
 */
export async function loadMoveTargets(
  activityOptionId: string,
  excludeOccurrenceId: string,
  unitsNeeded = 1,
  limit = 60,
): Promise<MoveTarget[]> {
  const { data, error } = await getBrowserSupabase()
    .from('session_occurrences')
    .select('id, starts_at, capacity, booking_items ( quantity, bookings ( status ) )')
    .eq('activity_option_id', activityOptionId)
    .eq('status', 'open')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit)
    .returns<RawTargetRow[]>();
  if (error) throw error;

  const out: MoveTarget[] = [];
  for (const raw of data ?? []) {
    if (raw.id === excludeOccurrenceId) continue;
    let used = 0;
    for (const item of raw.booking_items ?? []) {
      const b = one(item.bookings);
      if (b && (b.status === 'confirmed' || b.status === 'completed')) used += item.quantity;
    }
    const seatsLeft = Math.max(raw.capacity - used, 0);
    if (seatsLeft < unitsNeeded) continue;
    out.push({ occurrenceId: raw.id, startsAt: raw.starts_at, seatsLeft });
  }
  return out;
}

/** Call a departure off. Cancels it and stamps + mails every guest on it. Not reversible from the UI. */
export async function callOffDeparture(
  occurrenceId: string,
  reason: CallOffReason,
): Promise<{ affected: number }> {
  const { data, error } = await getBrowserSupabase().rpc('api_weather_cancel_occurrence', {
    p: { occurrenceId, reason },
  });
  if (error) throw error;
  return (data ?? { affected: 0 }) as { affected: number };
}

/** Move one booking to another departure of the SAME option (staff acting on a guest's behalf). */
export async function rescheduleBookingAsStaff(
  ref: string,
  occurrenceId: string,
): Promise<{ occurrenceId: string }> {
  const { data, error } = await getBrowserSupabase().rpc('api_reschedule_booking', {
    p: { ref, occurrenceId },
  });
  if (error) throw error;
  return (data ?? { occurrenceId }) as unknown as { occurrenceId: string };
}
