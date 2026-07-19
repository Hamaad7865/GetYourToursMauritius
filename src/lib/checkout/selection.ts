/** Booking-stash selection scoping.
 *
 *  The duplicate-booking fix persists `{ idemKey, bookingRef }` so a Back/reload remount reuses the
 *  same booking instead of minting a payable duplicate. That stash was keyed by occurrence ONLY — but
 *  the occurrence id is party/config-INDEPENDENT (date + option). So a customer who creates a
 *  payment_pending booking for date D party=2, abandons, then re-books the SAME date D party=4 would
 *  rehydrate the party-2 ref → pay() skips creation AND the price-reconciliation gate → the party-2
 *  total is charged while the order summary shows the party-4 total. Wrong-amount charge (a P0).
 *
 *  The fix: scope the persisted identity to the FULL price-relevant selection, not just the occurrence.
 *  Store `selectionHash(selection)` alongside the stash, and only rehydrate the ref/idem when the
 *  CURRENT selection hashes to the same value. A changed selection → no rehydrate → a fresh idem key →
 *  pay() creates a new booking at the new price (and runs the reconciliation gate).
 */

/** Every PRICE-RELEVANT field of the checkout selection. A change to ANY of these can change the
 *  amount the customer is charged (or the booking the server creates), so each must affect the hash. */
export type SelectionInput = {
  /** The price-tier label, e.g. "Adult" / "Per group". */
  priceLabel: string;
  /** Party / quantity (total headcount). */
  qty: number;
  /** Age-band distribution (band label → count, e.g. Adult:2, Child:1). The SAME total headcount can
   *  hide a DIFFERENT band mix — a different manifest and, with age-band pricing, a different price — so
   *  it must scope the identity, not just `qty`. Order-independent (normalized below). */
  party?: Record<string, number> | null;
  /** Sightseeing SUV upgrade flag. */
  suv: boolean;
  /** Number of child seats chosen (first free, the rest charged). */
  childSeats: number;
  /** Pickup address text (empty when no pickup / TBD). */
  pickupText: string;
  /** Resolved pickup latitude — drives the region transport fare (null when none/TBD). */
  pickupLat: number | null;
  /** Resolved pickup longitude (null when none/TBD). */
  pickupLng: number | null;
  /** "I don't know yet" — a pickup is wanted but no address/coords → no transport fee. */
  pickupTbd: boolean;
  /** Distinct drop-off text (empty when same-as-pickup or no pickup). */
  dropoffText: string;
  /** The chosen custom route stops (null when none). Order matters (drive distance → fee). */
  itinerary: Array<{ title: string; area?: string | null; lat?: number; lng?: number }> | null;
  /** The displayed total (the amount shown in the order summary), as a string hint. */
  total: string;
};

/** A route (itinerary) normalized to only its position-bearing fields (title/area/lat/lng), keeping
 *  stop ORDER — reordering stops is a different drive. Shared by `selectionHash` and `routeHash` so
 *  the two can never disagree about what counts as "the same route". */
function normalizeRoute(
  itinerary: Array<{ title: string; area?: string | null; lat?: number; lng?: number }> | null,
): Array<{ title: string; area: string | null; lat: number | null; lng: number | null }> | null {
  return Array.isArray(itinerary)
    ? itinerary.map((s) => ({
        title: s?.title ?? '',
        area: s?.area ?? null,
        lat: typeof s?.lat === 'number' ? s.lat : null,
        lng: typeof s?.lng === 'number' ? s.lng : null,
      }))
    : null;
}

/** A stable, order-independent string fingerprint of the price-relevant selection.
 *
 *  Pure + deterministic: a normalized object run through `JSON.stringify` with an explicit, fixed key
 *  order so the result never depends on the order the input object's keys happen to be in. The
 *  itinerary is normalized to only its position-bearing fields (title/area/lat/lng) so unrelated
 *  metadata can't perturb the hash, while reordering or changing the stops still does. */
export function selectionHash(input: SelectionInput): string {
  const normalized = {
    priceLabel: input.priceLabel ?? '',
    qty: Number.isFinite(input.qty) ? input.qty : 0,
    // Sorted band entries (positive counts only) → a stable, order-independent fingerprint of the mix.
    party: input.party
      ? Object.fromEntries(
          Object.entries(input.party)
            .filter(([, n]) => Number.isFinite(n) && n > 0)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : null,
    suv: Boolean(input.suv),
    childSeats: Number.isFinite(input.childSeats) ? input.childSeats : 0,
    pickupText: input.pickupText ?? '',
    pickupLat: input.pickupLat ?? null,
    pickupLng: input.pickupLng ?? null,
    pickupTbd: Boolean(input.pickupTbd),
    dropoffText: input.dropoffText ?? '',
    itinerary: normalizeRoute(input.itinerary),
    total: input.total ?? '',
  };
  return JSON.stringify(normalized);
}

/** Fingerprint of the route pay() is about to put on the booking (audit item 3's second gate input).
 *
 *  Why the route is NOT simply another key inside `detailsHash`: adding a key to that hash changes
 *  its shape, which would make every `det` already stashed in live browsers mismatch on the first
 *  post-deploy Pay — a 100% false-drift wave through the (payability-gated but still wasteful)
 *  abandon remedy. The route instead rides as its own `rt` field next to `det` in the booking stash;
 *  a stash without `rt` (written by older code) simply skips the route check. Hash the SAME value the
 *  api_book payload sends — never a fresh re-read of the gytm:itinerary stash, which pay() deletes on
 *  a successful create. */
export function routeHash(
  itinerary: Array<{ title: string; area?: string | null; lat?: number; lng?: number }> | null,
): string {
  return JSON.stringify(normalizeRoute(itinerary));
}

/** Whether the CURRENT route diverges from the one the rehydrated booking was created with — i.e.
 *  the customer re-customised the tour (swapped/reordered stops) after booking, in a way that may
 *  not move the price (`sel` matches) yet changes where they'd be driven. Paying the old booking
 *  would silently drive them the OLD route, so this joins the details drift as a reason to abandon
 *  the ref (payability-checked first, as always).
 *
 *  Fails SAFE in every ambiguous case — it reports drift ONLY when all three hold:
 *   - the stash carries `rt` (else it predates the route fingerprint: skip, never false-drift a
 *     legacy stash during the deploy window);
 *   - an ambient route is PRESENT at this pay() run (`currentRouteAbsent` false). An ABSENT route
 *     stash is ambiguous — pay() deletes it on a successful create, and a mere tour-page revisit
 *     resets the builder (which removes it) — so absence must read as "unchanged", never as "reverted
 *     to default". The genuine revert-to-default case is therefore NOT caught here (a known,
 *     deliberate gap: distinguishing it needs an explicit default marker from the builder);
 *   - the two route hashes actually differ. */
export function routeDrift(args: {
  storedRt: string | undefined;
  currentRt: string;
  currentRouteAbsent: boolean;
}): boolean {
  if (args.storedRt === undefined) return false;
  if (args.currentRouteAbsent) return false;
  return args.storedRt !== args.currentRt;
}

/** Every OPERATIONAL (non-price) field pay() sends onto the booking — the run-sheet/voucher facts:
 *  who travels, where they're picked up, which flight, which room. `selectionHash` scopes the stash
 *  to the PRICE config; this covers everything else the customer types in steps ①/②.
 *
 *  Why it exists (review item 3): the persisted booking identity survives a reload ON PURPOSE (it is
 *  the double-charge guard), but the form state does not. A customer who reloads, re-enters DIFFERENT
 *  details (new flight number, new hotel, new phone) and pays would silently pay the OLD booking —
 *  the operator drives to the wrong hotel for the wrong flight. Hashing the details at create time
 *  and comparing at pay time turns that into a fresh booking carrying what the customer actually
 *  typed. Keys are fixed-order; undefined and null both normalize to null so a product's absent
 *  fields (airport vs sightseeing) hash identically across mounts. */
export type DetailsInput = {
  customerName: string;
  customerPhone: string | null;
  customerCountry: string | null;
  gender?: string | null;
  company?: string | null;
  specialNotes?: string | null;
  pickupLocation?: string | null;
  dropoffLocation?: string | null;
  pickupPending?: boolean;
  dropoffSlug?: string | null;
  dropoffArea?: string | null;
  pickupSlug?: string | null;
  pickupArea?: string | null;
  tripType?: string | null;
  tripDirection?: string | null;
  flightNumber?: string | null;
  arrivalTime?: string | null;
  returnDate?: string | null;
  returnTime?: string | null;
  departureFlightNumber?: string | null;
  roomOrCabin?: string | null;
  luggageDetails?: string | null;
  childSeatAge?: number | null;
};

export function detailsHash(input: DetailsInput): string {
  const s = (v: string | null | undefined): string | null => (v == null || v === '' ? null : v);
  const normalized = {
    customerName: s(input.customerName) ?? '',
    customerPhone: s(input.customerPhone),
    customerCountry: s(input.customerCountry),
    gender: s(input.gender),
    company: s(input.company),
    specialNotes: s(input.specialNotes),
    pickupLocation: s(input.pickupLocation),
    dropoffLocation: s(input.dropoffLocation),
    pickupPending: Boolean(input.pickupPending),
    dropoffSlug: s(input.dropoffSlug),
    dropoffArea: s(input.dropoffArea),
    pickupSlug: s(input.pickupSlug),
    pickupArea: s(input.pickupArea),
    tripType: s(input.tripType),
    tripDirection: s(input.tripDirection),
    flightNumber: s(input.flightNumber),
    arrivalTime: s(input.arrivalTime),
    returnDate: s(input.returnDate),
    returnTime: s(input.returnTime),
    departureFlightNumber: s(input.departureFlightNumber),
    roomOrCabin: s(input.roomOrCabin),
    luggageDetails: s(input.luggageDetails),
    childSeatAge: typeof input.childSeatAge === 'number' ? input.childSeatAge : null,
  };
  return JSON.stringify(normalized);
}

/** Client-side mirror of `api_create_payment`'s payability guard, for the details-drift gate.
 *
 *  The drift gate's remedy — abandon the rehydrated ref and mint a FRESH payable booking — is only
 *  safe when the abandoned booking could still have been paid through. Abandoning an already-PAID
 *  booking routes around the server's `booking_not_payable` refusal and walks the customer into a
 *  second live payment form for the same trip (the double charge). So before abandoning, pay()
 *  fetches the booking and asks this predicate.
 *
 *  ALLOW-list, not a block-list: the server refuses payment for status in (confirmed, completed,
 *  cancelled, expired, refund_pending, refunded, failed) OR payment_state in (paid,
 *  partially_refunded, refunded). This inverts that as "payable only when status is a known
 *  pre-payment state AND payment_state is a known unpaid state", so an unrecognised/missing value —
 *  a future status, a malformed response — fails SAFE (treated as not payable → no fresh payable
 *  booking is minted; the customer is told to start a new booking instead). */
const PAYABLE_STATUSES = new Set(['draft', 'held', 'payment_pending']);
const UNPAID_PAYMENT_STATES = new Set(['pending', 'failed']);

export function isBookingPayable(booking: {
  status?: string | null;
  paymentState?: string | null;
}): boolean {
  return (
    typeof booking.status === 'string' &&
    PAYABLE_STATUSES.has(booking.status) &&
    typeof booking.paymentState === 'string' &&
    UNPAID_PAYMENT_STATES.has(booking.paymentState)
  );
}

/** Whether the persisted booking identity (idemKey + bookingRef) may be rehydrated for this mount.
 *
 *  Rehydrate ONLY when:
 *   - a hash was stored (something was persisted), AND
 *   - the stored hash equals the current selection's hash (same party/config → the legit
 *     duplicate-prevention case), AND
 *   - the entry point is the widget/planner Continue or a cart proceed (`from` = widget|cart) — a
 *     cold/cross-entry load must not inherit a stale ref, mirroring how the hold stash is gated.
 *
 *  Any other case (different selection, or a no-from load) returns false → the caller mints a fresh
 *  idem key and lets pay() create a new booking at the new price. */
export function shouldRehydrateBooking(args: {
  storedSel: string | null | undefined;
  currentSel: string;
  from: string;
}): boolean {
  const fromOk = args.from === 'widget' || args.from === 'cart';
  if (!fromOk) return false;
  if (!args.storedSel) return false;
  return args.storedSel === args.currentSel;
}
