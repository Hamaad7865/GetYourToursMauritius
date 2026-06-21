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
      return booking;
    }),
  };
  if (exportedAt) out.exportedAt = exportedAt;
  return out;
}
