/**
 * What /bookings/REF shows around a delivered photography gallery.
 *
 * The page is the booking-confirmation card (receipt, pickup, invoice, cancel) followed by the guest's
 * private gallery. Every link that exists to open the gallery — the delivery email, Account → Galleries,
 * Account → Bookings — ends in `#gallery`, and a guest who comes for their PHOTOS should land on the
 * photos, not on a receipt they already have. So once the gallery is really open and the guest arrived
 * by that link, the card steps aside; it stays one click away on the gallery header's "Your booking"
 * crumb, and a page opened WITHOUT the link (Account → View booking, the return from a payment) is
 * unchanged.
 *
 * Why this is state in React and not a CSS `:target` rule: the gallery section is mounted by a client
 * fetch AFTER the page has loaded, and the browser only designates the `:target` element at navigation
 * time, so a `#gallery:target` selector never matches an element inserted later.
 */

/** The fragment the gallery's own links carry. */
export const GALLERY_HASH = '#gallery';
/** The booking-confirmation card's wrapper — the "Your booking" crumb links to it. */
export const BOOKING_DETAILS_ID = 'booking-details';

/** Where the gallery section has got to. Decided by the gallery API's answer, never by the URL. */
export type GalleryPhase = 'pending' | 'open' | 'other';

/**
 * `pending` until we know; `open` only for an unlocked gallery that has something in it; `other` for
 * everything else (locked, no gallery, signed out, a failed request) — in all of those the card must show.
 */
export function galleryPhase(input: {
  /** True until the initial session check resolves (AuthProvider's `loading`). */
  authLoading: boolean;
  hasSession: boolean;
  /** The gallery request has been answered (even with an empty gallery or an error fallback). */
  hasData: boolean;
  /** The answer is an unlocked gallery with photos in it. */
  open: boolean;
}): GalleryPhase {
  // "No session yet" is not "no session": until the check resolves, a signed-in guest has none either.
  if (!input.authLoading && !input.hasSession) return 'other';
  if (!input.hasData) return 'pending';
  return input.open ? 'open' : 'other';
}

/**
 * Whether the booking-confirmation card is hidden. Only for a gallery opened by its own link; while
 * that gallery is still loading the card is held back (so it does not flash and vanish), but only until
 * the grace period is over — a hung request must never hide the balance box, invoice and cancel
 * controls for good.
 */
export function bookingCardHidden(input: {
  hash: string;
  phase: GalleryPhase;
  graceOver: boolean;
}): boolean {
  if (input.hash !== GALLERY_HASH) return false;
  if (input.phase === 'open') return true;
  return input.phase === 'pending' && !input.graceOver;
}
