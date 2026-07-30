/**
 * True when the signed-in viewer is a STAFF account looking at another guest's booking —
 * i.e. the DTO explicitly says `isOwn: false`. `api_get_booking` can only return a row the
 * caller is allowed to see (bookings RLS: owner or staff), so a non-own booking implies a
 * staff viewer; customers never get this far on someone else's ref.
 *
 * Strict `=== false` on purpose: an absent/null `isOwn` (a DTO minted before the field
 * existed, or a cached pre-deploy response) must fail QUIET — no banner for the owner.
 */
export function isStaffViewing(booking: { isOwn?: boolean | null }): boolean {
  return booking.isOwn === false;
}
