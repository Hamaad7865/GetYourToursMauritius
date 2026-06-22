/**
 * Pure serializer for the self-serve "Download my data" (GDPR right of access / portability).
 *
 * Shapes the signed-in user's OWN data — fetched by the client under RLS, which already scopes
 * everything to the owner — into a clean, portable JSON object. It deliberately excludes internal
 * or foreign identifiers (row ids, user ids, occurrence ids, payment ids) and never carries another
 * person's data: the inputs are the caller's profile row and the caller's bookings, nothing else.
 *
 * Kept PURE (no `new Date()`, no I/O) so it is trivially unit-testable; `exportedAt` is injected by
 * the caller.
 */

export interface ExportProfileInput {
  full_name: string | null;
  phone: string | null;
}

export interface ExportBookingItemInput {
  price_label: string;
  quantity: number;
  /** Earliest occurrence start for the item, ISO string, when known. */
  starts_at?: string | null;
  title?: string | null;
}

export interface ExportBookingInput {
  ref: string;
  status: string;
  total_minor: number;
  currency: string;
  created_at: string;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  // Airport-transfer + traveller PII captured on the booking (Art. 15/20 export must be complete).
  traveller_gender?: string | null;
  traveller_company?: string | null;
  traveller_country?: string | null;
  special_notes?: string | null;
  room_or_cabin?: string | null;
  luggage_details?: string | null;
  child_seat_age?: number | null;
  flight_number?: string | null;
  arrival_time?: string | null;
  return_date?: string | null;
  return_time?: string | null;
  departure_flight_number?: string | null;
  items: ExportBookingItemInput[];
}

export interface AccountExportItem {
  label: string;
  qty: number;
}

export interface AccountExportBooking {
  ref: string;
  status: string;
  /** Earliest known trip date (ISO) across the booking's items, else the booking date. */
  date: string;
  total: number;
  currency: string;
  items: AccountExportItem[];
  pickup?: string;
  dropoff?: string;
  // Traveller / airport-transfer PII (only emitted when present, to keep the export tidy).
  gender?: string;
  company?: string;
  country?: string;
  specialNotes?: string;
  roomOrCabin?: string;
  luggageDetails?: string;
  childSeatAge?: number;
  flightNumber?: string;
  arrivalTime?: string;
  returnDate?: string;
  returnTime?: string;
  departureFlightNumber?: string;
}

export interface AccountExport {
  exportedAt?: string;
  profile: {
    fullName: string | null;
    phone: string | null;
    email: string | null;
  };
  bookings: AccountExportBooking[];
}

/** Earliest trip date across a booking's items (ISO), or the booking's created_at as a fallback. */
function tripDate(b: ExportBookingInput): string {
  const times = b.items
    .map((i) => i.starts_at)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => new Date(s).getTime())
    .filter((n) => Number.isFinite(n));
  if (times.length === 0) return b.created_at;
  return new Date(Math.min(...times)).toISOString();
}

/**
 * Builds the portable export object. `exportedAt` is optional so the function stays pure — pass a
 * timestamp from the caller (e.g. `new Date().toISOString()`); omit it in tests for a stable shape.
 */
export function buildAccountExport(
  profile: ExportProfileInput | null,
  email: string | null,
  bookings: ExportBookingInput[],
  exportedAt?: string,
): AccountExport {
  const out: AccountExport = {
    profile: {
      fullName: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      email: email ?? null,
    },
    bookings: bookings.map((b) => {
      const booking: AccountExportBooking = {
        ref: b.ref,
        status: b.status,
        date: tripDate(b),
        total: b.total_minor / 100,
        currency: b.currency,
        items: b.items.map((i) => ({ label: i.title ?? i.price_label, qty: i.quantity })),
      };
      if (b.pickup_location) booking.pickup = b.pickup_location;
      if (b.dropoff_location) booking.dropoff = b.dropoff_location;
      if (b.traveller_gender) booking.gender = b.traveller_gender;
      if (b.traveller_company) booking.company = b.traveller_company;
      if (b.traveller_country) booking.country = b.traveller_country;
      if (b.special_notes) booking.specialNotes = b.special_notes;
      if (b.room_or_cabin) booking.roomOrCabin = b.room_or_cabin;
      if (b.luggage_details) booking.luggageDetails = b.luggage_details;
      if (b.child_seat_age != null) booking.childSeatAge = b.child_seat_age;
      if (b.flight_number) booking.flightNumber = b.flight_number;
      if (b.arrival_time) booking.arrivalTime = b.arrival_time;
      if (b.return_date) booking.returnDate = b.return_date;
      if (b.return_time) booking.returnTime = b.return_time;
      if (b.departure_flight_number) booking.departureFlightNumber = b.departure_flight_number;
      return booking;
    }),
  };
  if (exportedAt) out.exportedAt = exportedAt;
  return out;
}
