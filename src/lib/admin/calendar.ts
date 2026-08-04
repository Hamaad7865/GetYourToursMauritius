import { getBrowserSupabase } from '@/lib/supabase/browser';
import {
  mapTransfer,
  TRANSFER_SELECT,
  type AdminTransferDetails,
  type BookingStatus,
  type PaymentState,
  type RawTransferFields,
} from '@/lib/admin/bookings';

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

/** One priced line of a booking on this departure — the age band or seat type actually sold, so the
 *  guide knows they are meeting 2 adults and a child rather than "3 pax". */
export interface DayBookingLine {
  label: string;
  quantity: number;
  pax: number;
}

/**
 * Everything staff need about one party on a departure, without leaving the calendar.
 *
 * The calendar is the operations screen: the person reading it is deciding who to collect, from
 * where, in what vehicle, with which seats fitted. Sending them to /admin/bookings for the child
 * seat and back again for the pickup is how a seat gets forgotten, so the day sheet carries the
 * whole picture.
 */
export interface DayBooking {
  id: string;
  ref: string;
  status: BookingStatus;
  paymentState: PaymentState;
  /** Confirmed/completed — this party holds seats and counts in the departure's headcount. */
  counted: boolean;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  source: string;
  bookedAt: string;
  totalEur: number;
  /** Headcount for this party on THIS departure (`pax ?? quantity`, summed over its lines). */
  pax: number;
  lines: DayBookingLine[];
  pickupLocation: string | null;
  dropoffLocation: string | null;
  pickupPending: boolean;
  childSeats: number;
  /** The optional supplements this party bought (label + how many, one entry each) — the
   *  kitchen/skipper needs the head counts on the day sheet, so they ride alongside the child seats. */
  supplements: Array<{ name: string; qty: number }>;
  customItinerary: Array<{ title: string; area?: string | null }> | null;
  transfer: AdminTransferDetails | null;
  /** The private staff note from the Bookings screen — read-only here. */
  staffNote: string | null;
  /** We called a departure off on this guest and they have not yet chosen a new date or a refund. */
  awaitingChoice: boolean;
  /** Whether calling this departure off would actually email this guest — mirrors the fan-out
   *  filter inside api_weather_cancel_occurrence exactly. See `notifiableCount`. */
  notifiable: boolean;
  /** api_reschedule_booking's status gate: only a confirmed, paid booking owns a seat to move. It
   *  also enforces a 24h window, which this cannot know, so the RPC stays the authority — this only
   *  stops the UI offering a move that is guaranteed to come back as `not_reschedulable`. */
  reschedulable: boolean;
}

export interface DayDeparture {
  occurrenceId: string;
  activityOptionId: string;
  startsAt: string;
  status: string;
  capacity: number;
  activityTitle: string;
  optionName: string;
  /** Seats held by confirmed/completed parties — the number `capacity` is denominated against. */
  pax: number;
  /** Heads on unpaid, still-live bookings. Deliberately outside `pax`: they hold no seat yet, and
   *  folding them in would make this card disagree with the month grid and with used_capacity. */
  pendingPax: number;
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

interface RawDayBooking extends RawTransferFields {
  id: string;
  ref: string;
  status: BookingStatus;
  payment_state: PaymentState;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  source: string;
  total_minor: number;
  notes: string | null;
  created_at: string;
  custom_itinerary: Array<{ title: string; area?: string | null }> | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  pickup_pending: boolean | null;
  child_seats: number | null;
  booking_supplements: Array<{ name: string; qty: number; position: number }> | null;
  disruption: { resolvedAt?: string | null } | null;
}

export interface RawDayRow {
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
    price_label: string | null;
    bookings: RawDayBooking | RawDayBooking[] | null;
  }> | null;
}

/** Holds seats: the same set `used_capacity` and `api_admin_calendar_month` count. */
const COUNTED_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'completed']);
/** Live but unpaid — the customer is mid-checkout and may still turn up. Shown and flagged, never
 *  counted. Anything staler than this (draft carts, expired holds, cancellations) stays hidden:
 *  `held` and `payment_pending` are precisely the states the system still considers in flight. */
const PENDING_STATUSES: ReadonlySet<string> = new Set(['held', 'payment_pending']);

/** "We called this off and the guest still owes us an answer" — the TS twin of the SQL
 *  `booking_awaiting_choice(jsonb)`. Kept identical on purpose. */
function awaitingChoice(disruption: { resolvedAt?: string | null } | null): boolean {
  return disruption != null && disruption.resolvedAt == null;
}

const BOOKING_FIELDS = `
  id, ref, status, payment_state, customer_name, customer_email, customer_phone,
  source, total_minor, notes, created_at, custom_itinerary,
  pickup_location, dropoff_location, pickup_pending, child_seats, disruption,
  booking_supplements ( name, qty, position ),
  ${TRANSFER_SELECT}
`;

/**
 * Shape the raw occurrence rows into the day sheet. Pure, so the merging and counting rules below
 * are testable without a database.
 *
 * Availability is materialised for every activity every day, so a day has ~45 occurrences but only a
 * handful carry guests. The operator cares about the booked ones — the people to plan for and the
 * departures worth calling off — so a departure with nobody on it is dropped here rather than
 * cluttering the drawer.
 *
 * Headcount is `pax ?? quantity`: for a vehicle line `quantity` is the number of VEHICLES, so
 * summing it would undercount the people.
 */
export function mapDaySchedule(rows: RawDayRow[]): DayDeparture[] {
  const out: DayDeparture[] = [];
  for (const raw of rows) {
    const opt = one(raw.activity_options);
    const bookings: DayBooking[] = [];

    for (const item of raw.booking_items ?? []) {
      const b = one(item.bookings);
      if (!b) continue;
      const counted = COUNTED_STATUSES.has(b.status);
      if (!counted && !PENDING_STATUSES.has(b.status)) continue;

      const pax = item.pax ?? item.quantity;
      const label = item.price_label ?? opt?.name ?? 'Traveller';
      // A booking with several lines on one departure is one party, not several — but each line is a
      // different band (2 × Adult, 1 × Child), which is exactly what the guide needs to see.
      const existing = bookings.find((x) => x.id === b.id);
      if (existing) {
        existing.pax += pax;
        const line = existing.lines.find((l) => l.label === label);
        if (line) {
          line.quantity += item.quantity;
          line.pax += pax;
        } else existing.lines.push({ label, quantity: item.quantity, pax });
        continue;
      }

      bookings.push({
        id: b.id,
        ref: b.ref,
        status: b.status,
        paymentState: b.payment_state,
        counted,
        customerName: b.customer_name,
        customerEmail: b.customer_email,
        customerPhone: b.customer_phone,
        source: b.source,
        bookedAt: b.created_at,
        totalEur: b.total_minor / 100,
        pax,
        lines: [{ label, quantity: item.quantity, pax }],
        pickupLocation: b.pickup_location,
        dropoffLocation: b.dropoff_location ?? null,
        pickupPending: b.pickup_pending ?? false,
        childSeats: b.child_seats ?? 0,
        supplements: (b.booking_supplements ?? [])
          .filter((s) => s.qty > 0 && s.name)
          .sort((a, b2) => a.position - b2.position || (a.name < b2.name ? -1 : 1))
          .map((s) => ({ name: s.name, qty: s.qty })),
        customItinerary: b.custom_itinerary,
        transfer: mapTransfer(b),
        staffNote: b.notes,
        awaitingChoice: awaitingChoice(b.disruption),
        // Mirrors api_weather_cancel_occurrence's fan-out: confirmed + paid + not already mid-choice.
        notifiable:
          b.status === 'confirmed' && b.payment_state === 'paid' && !awaitingChoice(b.disruption),
        reschedulable: b.status === 'confirmed' && b.payment_state === 'paid',
      });
    }

    // Only surface departures that actually have someone on them.
    if (bookings.length === 0) continue;
    // Paying guests first; the "might still turn up" tail sits underneath.
    bookings.sort((a, b) => Number(b.counted) - Number(a.counted));

    out.push({
      occurrenceId: raw.id,
      activityOptionId: raw.activity_option_id,
      startsAt: raw.starts_at,
      status: raw.status,
      capacity: raw.capacity,
      activityTitle: one(opt?.activities)?.title ?? 'Untitled',
      optionName: opt?.name ?? '',
      pax: bookings.reduce((s, b) => s + (b.counted ? b.pax : 0), 0),
      pendingPax: bookings.reduce((s, b) => s + (b.counted ? 0 : b.pax), 0),
      bookings,
    });
  }
  return out;
}

/** How many guests calling this departure off would actually email — the fan-out inside
 *  api_weather_cancel_occurrence skips completed, unpaid and already-disrupted bookings, so the
 *  confirmation must not promise mail to a party that will never receive one. */
export function notifiableCount(departure: DayDeparture): number {
  return departure.bookings.filter((b) => b.notifiable).length;
}

/** The booked departures on one Mauritius day, with the full detail of every party on each. */
export async function loadDaySchedule(day: string): Promise<DayDeparture[]> {
  const { startUtc, endUtc } = mauritiusDayBounds(day);
  const { data, error } = await getBrowserSupabase()
    .from('session_occurrences')
    .select(
      `id, activity_option_id, starts_at, status, capacity,
       activity_options ( name, activities ( title ) ),
       booking_items ( quantity, pax, price_label, bookings ( ${BOOKING_FIELDS} ) )`,
    )
    .gte('starts_at', startUtc)
    .lt('starts_at', endUtc)
    .order('starts_at', { ascending: true })
    .returns<RawDayRow[]>();
  if (error) throw error;
  return mapDaySchedule(data ?? []);
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
