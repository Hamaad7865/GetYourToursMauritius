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
  /** Party / quantity. */
  qty: number;
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
    suv: Boolean(input.suv),
    childSeats: Number.isFinite(input.childSeats) ? input.childSeats : 0,
    pickupText: input.pickupText ?? '',
    pickupLat: input.pickupLat ?? null,
    pickupLng: input.pickupLng ?? null,
    pickupTbd: Boolean(input.pickupTbd),
    dropoffText: input.dropoffText ?? '',
    itinerary: Array.isArray(input.itinerary)
      ? input.itinerary.map((s) => ({
          title: s?.title ?? '',
          area: s?.area ?? null,
          lat: typeof s?.lat === 'number' ? s.lat : null,
          lng: typeof s?.lng === 'number' ? s.lng : null,
        }))
      : null,
    total: input.total ?? '',
  };
  return JSON.stringify(normalized);
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
