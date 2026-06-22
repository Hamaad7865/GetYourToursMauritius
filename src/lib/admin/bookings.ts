import { getBrowserSupabase } from '@/lib/supabase/browser';

/* Admin booking reads + lifecycle writes. Staff/admin RLS (`*_staff` policies) grants full
 * read on bookings/booking_items/payments and full write on bookings, so the authenticated
 * admin does these directly through the browser client — no RPC. Payment confirmation is NOT
 * done here (that only ever comes from the verified webhook → ledger); the admin can only set
 * operational statuses (complete / cancel) and edit notes. */

export type BookingStatus =
  | 'draft'
  | 'held'
  | 'payment_pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'refund_pending'
  | 'refunded'
  | 'failed';

export type PaymentState = 'pending' | 'paid' | 'partially_refunded' | 'refunded' | 'failed';

export interface BookingItemRow {
  priceLabel: string;
  quantity: number;
  /** People on board for a vehicle line (null otherwise); use `pax ?? quantity` for headcount. */
  pax: number | null;
  unitAmountEur: number;
  subtotalEur: number;
  activityTitle: string;
  optionName: string;
  startsAt: string | null;
}

export interface BookingRow {
  id: string;
  ref: string;
  status: BookingStatus;
  paymentState: PaymentState;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  source: string;
  currency: string;
  totalEur: number;
  notes: string | null;
  createdAt: string;
  items: BookingItemRow[];
  /** Derived headline fields for the list row. */
  activityTitle: string;
  startsAt: string | null;
  guests: number;
  /** Net cash retained = Σ(paid − refunded) across this booking's payments, in EUR. */
  netPaidEur: number;
  /** The customer's chosen route (sightseeing tours), or null for the standard route. */
  customItinerary: Array<{ title: string; area?: string | null }> | null;
  /** The customer's pickup location entered at checkout, or null if none. */
  pickupLocation: string | null;
  /** The customer's drop-off location, or null (its own field — never merged into pickup). */
  dropoffLocation: string | null;
  /** "Pickup to be arranged" (TBD) — distinct from "no pickup at all" (false + no pickupLocation). */
  pickupPending: boolean;
  /** Child seats on the booking (first free, €6 each extra; the charge is in the total). */
  childSeats: number;
  /** Airport-transfer details (null for non-transfer bookings) — shown in the admin drawer + voucher. */
  transfer: AdminTransferDetails | null;
}

/** Airport-transfer fields surfaced to staff/driver in the admin booking drawer. */
export interface AdminTransferDetails {
  direction: string | null; // 'arrival' | 'departure' | 'return'
  roomOrCabin: string | null;
  flightNumber: string | null;
  arrivalTime: string | null;
  returnDate: string | null;
  returnTime: string | null;
  departureFlightNumber: string | null;
  luggageDetails: string | null;
  childSeatAge: number | null;
  travellerCountry: string | null;
  travellerCompany: string | null;
  travellerGender: string | null;
  specialNotes: string | null;
}

export interface PaymentEventRow {
  type: string;
  amountEur: number;
  occurredAt: string;
}

export interface PaymentRow {
  id: string;
  provider: string;
  status: PaymentState;
  amountEur: number;
  paidEur: number;
  refundedEur: number;
  createdAt: string;
  events: PaymentEventRow[];
}

export interface BookingDetail extends BookingRow {
  payments: PaymentRow[];
}

/** PostgREST embeds a to-one relation as an object, but the generated client types it loosely;
 *  normalise object|array|null down to a single row. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

interface RawItem {
  price_label: string;
  quantity: number;
  pax: number | null;
  unit_amount_minor: number;
  subtotal_minor: number;
  session_occurrences: { starts_at: string } | { starts_at: string }[] | null;
  activity_options:
    | { name: string; activities: { title: string } | { title: string }[] | null }
    | { name: string; activities: { title: string } | { title: string }[] | null }[]
    | null;
}

interface RawPaymentLite {
  paid_minor: number;
  refunded_minor: number;
}

interface RawBooking {
  id: string;
  ref: string;
  status: BookingStatus;
  payment_state: PaymentState;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  source: string;
  currency: string;
  total_minor: number;
  notes: string | null;
  custom_itinerary: Array<{ title: string; area?: string | null }> | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  pickup_pending: boolean | null;
  child_seats: number | null;
  trip_direction: string | null;
  room_or_cabin: string | null;
  flight_number: string | null;
  arrival_time: string | null;
  return_date: string | null;
  return_time: string | null;
  departure_flight_number: string | null;
  luggage_details: string | null;
  child_seat_age: number | null;
  traveller_country: string | null;
  traveller_company: string | null;
  traveller_gender: string | null;
  special_notes: string | null;
  created_at: string;
  booking_items: RawItem[] | null;
  payments: RawPaymentLite[] | null;
}

const BOOKING_SELECT = `
  id, ref, status, payment_state, customer_name, customer_email, customer_phone,
  source, currency, total_minor, notes, custom_itinerary, pickup_location, dropoff_location, pickup_pending, child_seats,
  trip_direction, room_or_cabin, flight_number, arrival_time, return_date, return_time, departure_flight_number,
  luggage_details, child_seat_age, traveller_country, traveller_company, traveller_gender, special_notes, created_at,
  booking_items (
    price_label, quantity, pax, unit_amount_minor, subtotal_minor,
    session_occurrences ( starts_at ),
    activity_options ( name, activities ( title ) )
  )
`;

function mapItem(raw: RawItem): BookingItemRow {
  const occ = one(raw.session_occurrences);
  const option = one(raw.activity_options);
  const activity = option ? one(option.activities) : null;
  return {
    priceLabel: raw.price_label,
    quantity: raw.quantity, // line quantity (vehicle count = 1 for vehicle bookings)
    pax: raw.pax, // people on board (null for per-person/per-group lines)
    unitAmountEur: raw.unit_amount_minor / 100,
    subtotalEur: raw.subtotal_minor / 100,
    activityTitle: activity?.title ?? 'Activity',
    optionName: option?.name ?? '',
    startsAt: occ?.starts_at ?? null,
  };
}

function mapBooking(raw: RawBooking): BookingRow {
  const items = (raw.booking_items ?? []).map(mapItem);
  // Headcount: people-on-board for a vehicle line (where quantity is the vehicle count), else the quantity.
  const guests = items.reduce((sum, it) => sum + (it.pax ?? it.quantity), 0);
  const netPaidMinor = (raw.payments ?? []).reduce(
    (sum, p) => sum + (p.paid_minor - p.refunded_minor),
    0,
  );
  return {
    id: raw.id,
    ref: raw.ref,
    status: raw.status,
    paymentState: raw.payment_state,
    customerName: raw.customer_name,
    customerEmail: raw.customer_email,
    customerPhone: raw.customer_phone,
    source: raw.source,
    currency: raw.currency,
    totalEur: raw.total_minor / 100,
    notes: raw.notes,
    createdAt: raw.created_at,
    items,
    activityTitle: items[0]?.activityTitle ?? '—',
    startsAt: items[0]?.startsAt ?? null,
    guests,
    netPaidEur: netPaidMinor / 100,
    customItinerary: raw.custom_itinerary,
    pickupLocation: raw.pickup_location,
    dropoffLocation: raw.dropoff_location ?? null,
    pickupPending: raw.pickup_pending ?? false,
    childSeats: raw.child_seats ?? 0,
    // Only build a transfer block when there's a direction (i.e. it's an airport transfer).
    transfer: raw.trip_direction
      ? {
          direction: raw.trip_direction,
          roomOrCabin: raw.room_or_cabin ?? null,
          flightNumber: raw.flight_number ?? null,
          arrivalTime: raw.arrival_time ?? null,
          returnDate: raw.return_date ?? null,
          returnTime: raw.return_time ?? null,
          departureFlightNumber: raw.departure_flight_number ?? null,
          luggageDetails: raw.luggage_details ?? null,
          childSeatAge: raw.child_seat_age ?? null,
          travellerCountry: raw.traveller_country ?? null,
          travellerCompany: raw.traveller_company ?? null,
          travellerGender: raw.traveller_gender ?? null,
          specialNotes: raw.special_notes ?? null,
        }
      : null,
  };
}

/** All bookings, newest first. Staff RLS returns every row. */
export async function loadBookings(limit = 300): Promise<BookingRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from('bookings')
    .select(`${BOOKING_SELECT}, payments ( paid_minor, refunded_minor )`)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<RawBooking[]>();
  if (error) throw error;
  return (data ?? []).map(mapBooking);
}

interface RawPaymentEvent {
  type: string;
  amount_minor: number;
  occurred_at: string;
}
interface RawPayment {
  id: string;
  provider: string;
  status: PaymentState;
  amount_minor: number;
  paid_minor: number;
  refunded_minor: number;
  created_at: string;
  payment_events: RawPaymentEvent[] | null;
}
interface RawBookingDetail extends RawBooking {
  payments: RawPayment[] | null;
}

/** A single booking with its payment ledger, for the detail drawer. */
export async function loadBookingDetail(id: string): Promise<BookingDetail | null> {
  const { data, error } = await getBrowserSupabase()
    .from('bookings')
    .select(
      `${BOOKING_SELECT},
       payments (
         id, provider, status, amount_minor, paid_minor, refunded_minor, created_at,
         payment_events ( type, amount_minor, occurred_at )
       )`,
    )
    .eq('id', id)
    .maybeSingle()
    .returns<RawBookingDetail>();
  if (error) throw error;
  if (!data) return null;

  const payments: PaymentRow[] = (data.payments ?? []).map((p) => ({
    id: p.id,
    provider: p.provider,
    status: p.status,
    amountEur: p.amount_minor / 100,
    paidEur: p.paid_minor / 100,
    refundedEur: p.refunded_minor / 100,
    createdAt: p.created_at,
    events: (p.payment_events ?? [])
      .map((e) => ({ type: e.type, amountEur: e.amount_minor / 100, occurredAt: e.occurred_at }))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  }));

  return { ...mapBooking(data), payments };
}

/** Set an operational status (complete / cancel). The type is narrowed to the only
 *  transitions staff may make; the DB trigger `enforce_booking_admin_update` is the real
 *  enforcement (a hand-crafted PATCH cannot forge payment_state or other statuses). */
export async function setBookingStatus(id: string, status: 'completed' | 'cancelled'): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('bookings')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Record that a manual (Peach-dashboard) refund happened on a refund_pending (or paid) booking.
 *  Calls the staff-only `api_mark_refunded` RPC, which records the refund through the same ledger
 *  path the webhook uses — transitioning the booking to `refunded`, setting refunded_minor, and
 *  firing the `booking_refunded` customer email. Idempotent: a second call is a no-op. */
export async function markBookingRefunded(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_mark_refunded', { p: { bookingId: id } });
  if (error) throw error;
}

/** The counts returned by `api_erase_user` — how much PII was removed/anonymized. */
export interface EraseResult {
  deletedBookings: number;
  anonymizedBookings: number;
  deletedLeads: number;
}

/** Fulfil a verified GUEST / written erasure request by the customer's email (GDPR right to erasure).
 *  Calls the staff-only `api_erase_user` RPC the same way `markBookingRefunded` calls its RPC — through
 *  the authenticated browser client, so the RPC's `is_staff()` guard runs against the operator's JWT.
 *  Anonymize-with-retention: unpaid bookings are hard-deleted, paid/terminal ones keep their financial
 *  row but have PII stripped. Idempotent: a second call anonymizes 0 further rows. */
export async function eraseCustomerData(email: string): Promise<EraseResult> {
  const { data, error } = await getBrowserSupabase().rpc('api_erase_user', { p: { email } });
  if (error) throw error;
  const summary = (data ?? {}) as Partial<EraseResult>;
  return {
    deletedBookings: summary.deletedBookings ?? 0,
    anonymizedBookings: summary.anonymizedBookings ?? 0,
    deletedLeads: summary.deletedLeads ?? 0,
  };
}

/** Save the internal staff note on a booking. */
export async function saveBookingNotes(id: string, notes: string): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('bookings')
    .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
