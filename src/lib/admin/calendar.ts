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
  /** The round-trip TRANSPORT add-on attached to this party's line on this departure — its own pickup/
   *  drop-off, read off the booking_item. Null when the line carries no transfer. Shown on the day-sheet
   *  card so the transfer travels WITH the activity instead of being a separate line. */
  transportPickup: string | null;
  transportDropoff: string | null;
  pickupPending: boolean;
  /** The guest's hotel room / cabin, for the driver's gate pass. Booking-level (`bookings.room_or_cabin`),
   *  surfaced here independent of the airport-transfer block — a plain activity pickup carries a room too. */
  roomOrCabin: string | null;
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
  /** Discriminates the day-sheet union: this is a real session_occurrence with seats and a headcount. */
  kind: 'occurrence';
  occurrenceId: string;
  activityOptionId: string;
  startsAt: string;
  status: string;
  capacity: number;
  /** Effective guests-per-trip for a SHARED option (option override ?? activity default) when one is
   *  set — the day pool is trips × this, so the sheet can read the owner's model ("N of M trips")
   *  instead of the raw seat pool. null for a legacy shared option (no cap yet), and for private and
   *  vehicle options, whose pool already counts trips / vehicles — those keep the historic ratio. */
  guestsPerTrip: number | null;
  activityTitle: string;
  optionName: string;
  /** Guests on confirmed/completed parties (Σ `pax ?? quantity`) — the HEADCOUNT. For a private or
   *  vehicle party this EXCEEDS `units` (one charter/van carries several guests); for a seat tour it
   *  equals `units`. Can exceed `capacity`, which counts units, not people. */
  pax: number;
  /** Booking UNITS on confirmed/completed parties (Σ `quantity`) — the unit `capacity` is denominated
   *  against: guests for a seat tour, trips for a private option, vehicles for vehicle mode (the same
   *  count `used_capacity` gates on). "X of capacity" on the day sheet reads against THIS, not `pax`. */
  units: number;
  /** Heads on unpaid, still-live bookings. Deliberately outside `pax`: they hold no seat yet, and
   *  folding them in would make this card disagree with the month grid and with used_capacity. */
  pendingPax: number;
  bookings: DayBooking[];
}

/**
 * A booking line that lives on NO session_occurrence — a bespoke custom line or a car/scooter rental
 * carried over from a converted quote (`booking_custom_items`). Such a booking can have zero
 * `booking_items`, so before this it showed on the operations calendar nowhere. It has no occurrence,
 * no capacity and no seat count: a rental's `quantity` is VEHICLES, a custom line's is whatever the
 * operator itemised, so it never enters a headcount and can never be "called off". It appears on the
 * day its `starts_at` falls on; a line with a null `starts_at` (date still to be agreed) appears on no
 * day. A multi-day rental shows on its START day only for v1, with `endsAt` on the card.
 */
export interface DayCustomLine {
  /** Discriminates the day-sheet union: a dated line with no occurrence, capacity or headcount. */
  kind: 'custom';
  /** The `booking_custom_items` row id — the card's stable key. */
  id: string;
  /** The underlying line kind: a bespoke line or a vehicle rental. NOT the union discriminant. */
  lineKind: 'custom' | 'rental';
  description: string;
  /** Non-null by construction — a null-dated line is dropped before it reaches here. */
  startsAt: string;
  /** The return day of a multi-day rental, shown on the card since v1 lists the line on its start day. */
  endsAt: string | null;
  rentalVehicleSlug: string | null;
  /** VEHICLES for a rental, an item count for a custom line — never summed into a headcount. */
  quantity: number;
  /** How many people are on this bespoke tour — the run-sheet headcount the operator typed on the quote
   *  line (`booking_custom_items.guests`). Null when none was stated, and never on a rental (`quantity`
   *  is the vehicle count there). Distinct from `quantity`: a flat-priced private tour is quantity 1. */
  guests: number | null;
  /** Where to collect this line from — the guest's hotel (`booking_custom_items.pickup_label`), set on
   *  the quote independent of the paid transport add-on (a private tour includes its transport). */
  pickupLabel: string | null;
  /** The guest's room / cabin for the driver's gate pass — booking-level (`bookings.room_or_cabin`). */
  roomOrCabin: string | null;
  /** The round-trip TRANSPORT add-on attached to this custom line — its own pickup/drop-off. Null when
   *  the line carries no transfer. Shown on the day-sheet card so the transfer travels with the line. */
  transportPickup: string | null;
  transportDropoff: string | null;
  /** Confirmed/completed owning booking — kept for styling parity with a counted departure party. */
  counted: boolean;
  subtotalEur: number;
  bookingId: string;
  ref: string;
  status: BookingStatus;
  paymentState: PaymentState;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  source: string;
  bookedAt: string;
  staffNote: string | null;
}

/**
 * The DEPARTURE leg of a RETURN airport transfer, shown on its own date.
 *
 * A return transfer is ONE booking with a single `session_occurrence` on the ARRIVAL date; the
 * departure lives only in `bookings.return_date` / `return_time` / `departure_flight_number`, with no
 * occurrence of its own. The whole calendar is built from occurrences, so before this the departure
 * appeared nowhere — the driver reading the return-date sheet never saw the pickup. This entry
 * surfaces it: the arrival's pickup/drop-off are SWAPPED (collect FROM the hotel, drop AT the airport),
 * timed by `return_time`. It holds no occurrence, no capacity and no seat, and can never be called off
 * (that acts on the arrival occurrence) — the same shape as a {@link DayCustomLine}.
 */
export interface DayReturnLeg {
  kind: 'return-leg';
  bookingId: string;
  ref: string;
  /** return_date + return_time as a Mauritius ISO instant — orders the leg among the day's departures. */
  startsAt: string;
  status: BookingStatus;
  paymentState: PaymentState;
  counted: boolean;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  source: string;
  bookedAt: string;
  /** Headcount from the transfer's booking line (`pax ?? quantity`, summed). */
  pax: number;
  /** The vehicle sold, from the transfer line's price label (e.g. "Sedan"). */
  vehicleLabel: string | null;
  /** Collect FROM here — the hotel (the arrival leg's drop-off). */
  pickup: string | null;
  /** Drop AT here — the airport (the arrival leg's pickup). */
  dropoff: string | null;
  /** The departure time typed on the booking (`return_time`), e.g. "18:30". */
  departureTime: string | null;
  /** The outbound flight (`departure_flight_number`), e.g. "MK248". */
  flightNumber: string | null;
  roomOrCabin: string | null;
  staffNote: string | null;
}

/** One row of the day sheet: a real departure, a dated custom/rental line, or a return transfer's
 *  departure leg. Discriminated by `kind`. */
export type DayEntry = DayDeparture | DayCustomLine | DayReturnLeg;

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

/**
 * The Mauritius-local calendar day ('YYYY-MM-DD') a UTC instant falls on — the same '+04:00, no DST'
 * constant `mauritiusDayBounds` applies, read from the other side. The grid keys its cells by this
 * exact string (`nominalDayKey` of a nominal date), so grouping custom lines by it lands them on the
 * cell whose drawer would open them. Reading the UTC day directly would shift a late-evening line onto
 * the wrong cell.
 */
export function mauritiusDayKey(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 4 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

/** The activity an option belongs to, as embedded on the occurrence read. `guests_per_trip` is the
 *  activity-level default cap and `pricing_mode` tells vehicle mode apart — both optional so the
 *  test factories (and any caller that doesn't select them) stay valid; absent reads as legacy. */
interface RawDayActivity {
  title: string;
  guests_per_trip?: number | null;
  pricing_mode?: string | null;
}

/** The booking option embedded on the occurrence read. `guests_per_trip` is the option's own cap
 *  override (null → uses the activity default); `private_base_minor` non-null marks a PRIVATE option
 *  (its pool counts trips, not guests, so the trip re-read must skip it). */
interface RawDayOption {
  name: string;
  guests_per_trip?: number | null;
  private_base_minor?: number | null;
  activities: RawDayActivity | RawDayActivity[] | null;
}

export interface RawDayRow {
  id: string;
  activity_option_id: string;
  starts_at: string;
  status: string;
  capacity: number;
  activity_options: RawDayOption | RawDayOption[] | null;
  booking_items: Array<{
    quantity: number;
    pax: number | null;
    price_label: string | null;
    transport_pickup_label?: string | null;
    transport_dropoff_label?: string | null;
    bookings: RawDayBooking | RawDayBooking[] | null;
  }> | null;
}

/** A `booking_custom_items` row with its owning booking embedded (the same `BOOKING_FIELDS` the
 *  occurrence query pulls, reused so a custom line carries the guest detail without a second lookup). */
export interface RawDayCustomItem {
  id: string;
  kind: 'custom' | 'rental';
  description: string;
  starts_at: string | null;
  ends_at: string | null;
  rental_vehicle_slug: string | null;
  quantity: number;
  unit_amount_minor: number;
  subtotal_minor: number;
  guests?: number | null;
  pickup_label?: string | null;
  transport_pickup_label?: string | null;
  transport_dropoff_label?: string | null;
  bookings: RawDayBooking | RawDayBooking[] | null;
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

/** The columns the return-leg read pulls straight off `bookings`: its departure leg has NO occurrence,
 *  so it is queried by `return_date`, not through `booking_items`. The transfer fields carry the leg
 *  (return_time, departure_flight_number, …); the one booking line carries the vehicle + headcount. */
const RETURN_LEG_SELECT = `
  id, ref, status, payment_state, customer_name, customer_email, customer_phone,
  source, created_at, notes, pickup_location, dropoff_location, ${TRANSFER_SELECT},
  booking_items ( quantity, pax, price_label )
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
    const act = one(opt?.activities);
    // The day pool is trips × guests only for a SHARED option. A private option's pool counts trips
    // and a vehicle option's counts vehicles — both already read in the owner's unit — and a shared
    // option with no cap yet is one trip taking the whole pool. Surface guests/trip only in the first
    // case, so the day sheet can re-read those pools as "N of M trips".
    const isPrivate = opt?.private_base_minor != null;
    // Both `vehicle` and `vehicle_custom` (the planner road-trip) pool VEHICLES, with guests fixed by
    // the vehicle brackets — neither carries a meaningful guests-per-trip, so match the prefix.
    const isVehicle = (act?.pricing_mode ?? '').startsWith('vehicle');
    const rawGpt = opt?.guests_per_trip ?? act?.guests_per_trip ?? null;
    const guestsPerTrip = !isPrivate && !isVehicle && rawGpt != null && rawGpt > 0 ? rawGpt : null;
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
        // A party's transfer is attached to one of its lines (the tour line); keep the first one seen so a
        // later band line with no transfer does not blank it.
        if (!existing.transportPickup && item.transport_pickup_label) {
          existing.transportPickup = item.transport_pickup_label;
          existing.transportDropoff = item.transport_dropoff_label ?? null;
        }
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
        transportPickup: item.transport_pickup_label ?? null,
        transportDropoff: item.transport_dropoff_label ?? null,
        pickupPending: b.pickup_pending ?? false,
        roomOrCabin: b.room_or_cabin ?? null,
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
      kind: 'occurrence',
      occurrenceId: raw.id,
      activityOptionId: raw.activity_option_id,
      startsAt: raw.starts_at,
      status: raw.status,
      capacity: raw.capacity,
      guestsPerTrip,
      activityTitle: act?.title ?? 'Untitled',
      optionName: opt?.name ?? '',
      pax: bookings.reduce((s, b) => s + (b.counted ? b.pax : 0), 0),
      // Σ `quantity` of counted parties — a private charter or a van is ONE unit however many guests
      // ride it, so this (not pax) is what `capacity` denominates against. Seat tours have pax===units.
      units: bookings.reduce(
        (s, b) => s + (b.counted ? b.lines.reduce((t, l) => t + l.quantity, 0) : 0),
        0,
      ),
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

/**
 * Shape the raw `booking_custom_items` rows into dated day-sheet lines. Pure, so the date and
 * visibility rules are testable without a database — a sibling of `mapDaySchedule`.
 *
 * A line with no `starts_at` belongs to no day and is dropped (a quote can leave the date open until
 * it is agreed). A line whose owning booking is not live — draft, expired, cancelled, refunded — is
 * hidden, mirroring which parties `mapDaySchedule` shows. Crucially there is NO pax here: a rental's
 * `quantity` counts VEHICLES and a custom line's counts items, so neither is ever a headcount, and
 * with no occurrence a custom line can never be called off.
 */
export function mapDayCustomLines(rows: RawDayCustomItem[]): DayCustomLine[] {
  const out: DayCustomLine[] = [];
  for (const raw of rows) {
    // No date → no day. (The DB query already filters these out; the pure function must too.)
    if (!raw.starts_at) continue;
    const b = one(raw.bookings);
    if (!b) continue;
    const counted = COUNTED_STATUSES.has(b.status);
    if (!counted && !PENDING_STATUSES.has(b.status)) continue;

    out.push({
      kind: 'custom',
      id: raw.id,
      lineKind: raw.kind,
      description: raw.description,
      startsAt: raw.starts_at,
      endsAt: raw.ends_at,
      rentalVehicleSlug: raw.rental_vehicle_slug,
      quantity: raw.quantity,
      // A rental's quantity is VEHICLES, so a headcount on one would be meaningless — drop it there.
      guests: raw.kind === 'rental' ? null : (raw.guests ?? null),
      pickupLabel: raw.pickup_label ?? null,
      roomOrCabin: b.room_or_cabin ?? null,
      transportPickup: raw.transport_pickup_label ?? null,
      transportDropoff: raw.transport_dropoff_label ?? null,
      counted,
      subtotalEur: raw.subtotal_minor / 100,
      bookingId: b.id,
      ref: b.ref,
      status: b.status,
      paymentState: b.payment_state,
      customerName: b.customer_name,
      customerEmail: b.customer_email,
      customerPhone: b.customer_phone,
      source: b.source,
      bookedAt: b.created_at,
      staffNote: b.notes,
    });
  }
  return out;
}

/**
 * The set of Mauritius days a month's custom/rental lines fall on. Pure, so the grouping is testable
 * without a database.
 *
 * The month grid gets its per-day headcount from `api_admin_calendar_month`, which aggregates
 * session_occurrences + booking_items ONLY — it never sees `booking_custom_items`. So a day whose only
 * booking is a converted quote (custom/rental lines, zero booking_items) comes back with pax 0, and
 * the grid's `pax > 0 || cancelled > 0` clickability gate leaves it a dead cell the day drawer can
 * never open. This companion read fills that gap: the grid unions these days into its clickable set.
 *
 * It defers entirely to `mapDayCustomLines` for what counts as a line worth showing, so the SAME
 * visibility filter applies — an undated line, or one whose owning booking is not live (draft,
 * expired, cancelled, refunded…), marks no day, exactly as it would show no card in the drawer.
 */
export function customLineDays(rows: RawDayCustomItem[]): Set<string> {
  return new Set(customLinesByDay(rows).keys());
}

/**
 * The same visible lines, kept per Mauritius day rather than reduced to a bare set of dates.
 *
 * The month grid used to render the word "custom line" on such a day and nothing else, so an
 * operator scanning September could not tell a South Tour from a catamaran from a car rental
 * without opening every day in turn — the whole point of a month view is not having to. The rows
 * this is built from ALREADY carry `description` (loadCustomLineDays selects it and threw it away),
 * so naming the line on the cell costs no extra query and no migration.
 *
 * Ordered by start time within each day, so the cell names the first thing that happens.
 */
export function customLinesByDay(rows: RawDayCustomItem[]): Map<string, DayCustomLine[]> {
  const byDay = new Map<string, DayCustomLine[]>();
  for (const line of mapDayCustomLines(rows)) {
    const key = mauritiusDayKey(line.startsAt);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(line);
    else byDay.set(key, [line]);
  }
  for (const lines of byDay.values()) lines.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return byDay;
}

/**
 * A month-cell-sized label for a quote line, from a description written for a full-width card.
 *
 * The descriptions our own quote drafting produces are compound, and everything after the first
 * separator repeats what the calendar already tells you — the date, the option, the band:
 *
 *   "Private South Tour Mauritius"                                    → unchanged
 *   "Nissan March · 09 Sept 2026 – 10 Sept 2026 · 1-day rental"       → "Nissan March"
 *   "Catamaran Cruise – Ile Aux Cerfs — Standard · 06 Sept, 12:00…"   → "Catamaran Cruise – Ile Aux Cerfs"
 *   "Round-trip transfer · Catamaran Cruise… · from MU, Coastal Rd…"  → "Round-trip transfer"
 *
 * Split on the em-dash-with-spaces and the middot ONLY. A bare hyphen is part of a real tour name
 * ("Catamaran Cruise – Ile Aux Cerfs"), so splitting on that would truncate the very thing this is
 * meant to show. Falls back to the whole description when it carries no separator.
 */
export function customLineLabel(description: string): string {
  const cut = description.search(/\s(?:—|·)\s/);
  const head = (cut === -1 ? description : description.slice(0, cut)).trim();
  return head || description.trim();
}

/** A `bookings` row read directly for a return transfer's departure leg (it has no occurrence). */
export interface RawReturnLeg extends RawTransferFields {
  id: string;
  ref: string;
  status: BookingStatus;
  payment_state: PaymentState;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  source: string;
  created_at: string;
  notes: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  booking_items: Array<{ quantity: number; pax: number | null; price_label: string | null }> | null;
}

/** The Mauritius ISO instant of a return leg's departure, from its date + time. A missing/odd time
 *  falls back to 00:00 so the leg still lands on its day; return_time is stored "HH:MM" ("18:30"). */
function returnLegStartsAt(returnDate: string, returnTime: string | null): string {
  const m = (returnTime ?? '').match(/^(\d{1,2}):(\d{2})/);
  const time = m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : '00:00';
  return `${returnDate}T${time}:00+04:00`;
}

/**
 * Shape the raw return-transfer bookings into departure-leg day-sheet entries. Pure, so the swap and
 * visibility rules are testable without a database — a sibling of `mapDaySchedule` / `mapDayCustomLines`.
 *
 * Only a RETURN transfer has a second leg, and only a DATED one (`return_date`) belongs to a day. The
 * same live/counted filter the other two mappers apply is applied here, so an unpaid-and-abandoned or
 * cancelled transfer shows no leg. The arrival's pickup/drop-off are SWAPPED: the departure collects
 * FROM the hotel (the arrival's drop-off) and drops AT the airport (the arrival's pickup).
 */
export function mapReturnLegs(rows: RawReturnLeg[]): DayReturnLeg[] {
  const out: DayReturnLeg[] = [];
  for (const raw of rows) {
    if (raw.trip_direction !== 'return' || !raw.return_date) continue;
    const counted = COUNTED_STATUSES.has(raw.status);
    if (!counted && !PENDING_STATUSES.has(raw.status)) continue;

    let pax = 0;
    let vehicleLabel: string | null = null;
    for (const item of raw.booking_items ?? []) {
      pax += item.pax ?? item.quantity;
      if (!vehicleLabel && item.price_label) vehicleLabel = item.price_label;
    }

    out.push({
      kind: 'return-leg',
      bookingId: raw.id,
      ref: raw.ref,
      startsAt: returnLegStartsAt(raw.return_date, raw.return_time),
      status: raw.status,
      paymentState: raw.payment_state,
      counted,
      customerName: raw.customer_name,
      customerEmail: raw.customer_email,
      customerPhone: raw.customer_phone,
      source: raw.source,
      bookedAt: raw.created_at,
      pax,
      vehicleLabel,
      pickup: raw.dropoff_location, // collect FROM the hotel (arrival drop-off)
      dropoff: raw.pickup_location, // drop AT the airport (arrival pickup)
      departureTime: raw.return_time,
      flightNumber: raw.departure_flight_number,
      roomOrCabin: raw.room_or_cabin,
      staffNote: raw.notes,
    });
  }
  return out;
}

/** The visible return-transfer departure legs kept per Mauritius day — the by-day companion the month
 *  grid unions in so a day whose ONLY entry is a return leg is clickable and named, exactly as
 *  `customLinesByDay` does for converted-quote lines (the month RPC counts neither). */
export function returnLegsByDay(rows: RawReturnLeg[]): Map<string, DayReturnLeg[]> {
  const byDay = new Map<string, DayReturnLeg[]>();
  for (const leg of mapReturnLegs(rows)) {
    const key = mauritiusDayKey(leg.startsAt);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(leg);
    else byDay.set(key, [leg]);
  }
  for (const legs of byDay.values()) legs.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return byDay;
}

/* The typed browser client does not know `booking_custom_items`: it landed in 20260909000000 and the
 * generated src/lib/supabase/types.ts has not been regenerated (that needs a live database and would
 * sweep in every other pending schema change). Same narrow structural cast as src/lib/admin/quotes.ts,
 * naming exactly the one by-day read this file makes, so a typo is still a compile error. */
interface CustomItemsQuery {
  select(columns: string): CustomItemsQuery;
  gte(column: string, value: string): CustomItemsQuery;
  lt(column: string, value: string): CustomItemsQuery;
  order(column: string, opts: { ascending: boolean }): CustomItemsQuery;
  returns<T>(): PromiseLike<{ data: T | null; error: unknown }>;
}

/**
 * Everything booked on one Mauritius day: the real departures AND the dated custom/rental lines that
 * live on no occurrence (a converted quote can be made entirely of `booking_custom_items`, so those
 * lines are the only place it shows on the calendar). Two reads — the occurrence sheet and the custom
 * lines (the partial `booking_custom_items_starts_idx` was built for exactly this by-day query) —
 * merged into one time-ordered list. Both branches read through staff RLS, like the rest of admin.
 */
export async function loadDaySchedule(day: string): Promise<DayEntry[]> {
  const { startUtc, endUtc } = mauritiusDayBounds(day);
  const supabase = getBrowserSupabase();
  const customItems = (supabase as unknown as { from(t: 'booking_custom_items'): CustomItemsQuery })
    .from('booking_custom_items')
    .select(
      `id, kind, description, starts_at, ends_at, rental_vehicle_slug,
       quantity, unit_amount_minor, subtotal_minor, guests, pickup_label,
       transport_pickup_label, transport_dropoff_label,
       bookings ( ${BOOKING_FIELDS} )`,
    )
    .gte('starts_at', startUtc)
    .lt('starts_at', endUtc)
    .order('starts_at', { ascending: true })
    .returns<RawDayCustomItem[]>();

  // A RETURN transfer's departure leg lives only on `bookings.return_date` — it has NO occurrence, so
  // it is read straight off bookings by that date and folded in beside the occurrence departures.
  const returnLegs = supabase
    .from('bookings')
    .select(RETURN_LEG_SELECT)
    .eq('trip_direction', 'return')
    .eq('return_date', day)
    .returns<RawReturnLeg[]>();

  const [occurrences, custom, legs] = await Promise.all([
    supabase
      .from('session_occurrences')
      .select(
        `id, activity_option_id, starts_at, status, capacity,
         activity_options ( name, guests_per_trip, private_base_minor,
                            activities ( title, guests_per_trip, pricing_mode ) ),
         booking_items ( quantity, pax, price_label, transport_pickup_label, transport_dropoff_label,
                         bookings ( ${BOOKING_FIELDS} ) )`,
      )
      .gte('starts_at', startUtc)
      .lt('starts_at', endUtc)
      .order('starts_at', { ascending: true })
      .returns<RawDayRow[]>(),
    customItems,
    returnLegs,
  ]);
  if (occurrences.error) throw occurrences.error;
  if (custom.error) throw custom.error;
  if (legs.error) throw legs.error;

  const entries: DayEntry[] = [
    ...mapDaySchedule(occurrences.data ?? []),
    ...mapDayCustomLines(custom.data ?? []),
    ...mapReturnLegs(legs.data ?? []),
  ];
  // Read the day in time order — a rental sitting between two departures reads where it belongs.
  entries.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return entries;
}

/**
 * The visible custom/rental lines across a month, keyed by Mauritius day — the month-wide companion
 * to `loadCalendarMonth`. It makes a converted-quote-only day clickable (see `customLineDays` for why
 * the month RPC alone can't) AND gives the grid the line names to print on the cell.
 *
 * `from`..`to` are the grid's inclusive first and last day keys; the query spans the same window in
 * UTC (`from`'s day start to the day AFTER `to`), one cheap read served by the partial
 * `booking_custom_items_starts_idx`. Reads through staff RLS like the rest of admin. The selected
 * columns are unchanged — `description` was always fetched, and only ever discarded.
 */
export async function loadCustomLinesByDay(
  from: string,
  to: string,
): Promise<Map<string, DayCustomLine[]>> {
  const { startUtc } = mauritiusDayBounds(from);
  const { endUtc } = mauritiusDayBounds(to);
  const supabase = getBrowserSupabase();
  const { data, error } = await (
    supabase as unknown as { from(t: 'booking_custom_items'): CustomItemsQuery }
  )
    .from('booking_custom_items')
    .select(
      `id, kind, description, starts_at, ends_at, rental_vehicle_slug,
       quantity, unit_amount_minor, subtotal_minor, guests, pickup_label,
       transport_pickup_label, transport_dropoff_label,
       bookings ( ${BOOKING_FIELDS} )`,
    )
    .gte('starts_at', startUtc)
    .lt('starts_at', endUtc)
    .order('starts_at', { ascending: true })
    .returns<RawDayCustomItem[]>();
  if (error) throw error;
  return customLinesByDay(data ?? []);
}

/**
 * The visible return-transfer departure legs across a month, keyed by Mauritius day — the month-wide
 * companion to `loadCalendarMonth`, exactly like `loadCustomLinesByDay`. The month RPC counts only
 * session_occurrences, so a return leg (whose departure date has none) would leave that day a dead
 * cell; unioning these keys into the grid's clickable set makes it openable and names it.
 */
export async function loadReturnLegsByDay(
  from: string,
  to: string,
): Promise<Map<string, DayReturnLeg[]>> {
  const { data, error } = await getBrowserSupabase()
    .from('bookings')
    .select(RETURN_LEG_SELECT)
    .eq('trip_direction', 'return')
    .gte('return_date', from)
    .lte('return_date', to)
    .returns<RawReturnLeg[]>();
  if (error) throw error;
  return returnLegsByDay(data ?? []);
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
