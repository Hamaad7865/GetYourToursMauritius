/* The customer's in-progress checkout answers, so a round-trip through sign-in doesn't throw them away.
 *
 * Signing in with email + password is an in-page modal, so that path never lost anything. But
 * "Continue with Google" and a sign-up that needs email confirmation both REDIRECT the browser away
 * (AuthDialog's authCallbackUrl), and `next` records only `pathname + search`. Everything the customer
 * typed at checkout lives in React state and none of it is in the URL — deliberately, because a pickup
 * address is personal data and has no business in a query string that leaks via Referer and history.
 * So the fresh mount after the redirect came back to step 1 with an empty form.
 *
 * sessionStorage, keyed by occurrence, mirrors what the hold and the cart line already do. Per-tab and
 * gone when the tab closes, which is the right lifetime for a half-filled form holding someone's home
 * address and flight number. Cleared the moment the booking succeeds.
 *
 * LIMITATION worth knowing: an email-confirmation link opened in a DIFFERENT tab or on another device
 * gets a fresh sessionStorage and restores nothing. The 30-minute hold has usually gone by then too, so
 * that journey has to start over regardless.
 */

export interface Coords {
  lat: number;
  lng: number;
}

export interface CheckoutDraft {
  /** Which step they had reached. Never restored past the sign-in/details step — see loadDraft. */
  step?: number;
  // Pickup / drop-off (step 1 for a tour).
  wantsPickup?: boolean;
  tbd?: boolean;
  pickupLoc?: string;
  pickupCoords?: Coords | null;
  dropoffSame?: boolean;
  dropoffText?: string;
  dropoffCoords?: Coords | null;
  // Airport transfer (step 1 becomes flight + hotel details).
  tripDirection?: 'arrival' | 'departure' | 'return';
  dropoffSlug?: string;
  dropoffName?: string;
  dropoffArea?: string;
  hotelNotListed?: boolean;
  hotelQuery?: string;
  flightNumber?: string;
  arrivalTime?: string;
  arrivalDate?: string;
  departureFlight?: string;
  departureDate?: string;
  returnTime?: string;
  roomOrCabin?: string;
  luggageDetails?: string;
  childSeatWanted?: boolean;
  childSeatAge?: string;
  // Lead traveller (step 2).
  name?: string;
  phone?: string;
  country?: string;
  gender?: string;
  company?: string;
  specialNotes?: string;
  /** ms epoch, stamped on write. */
  savedAt?: number;
}

export function draftKey(occurrenceId: string): string {
  return `gytm:checkout:${occurrenceId}`;
}

/**
 * How long a draft stays usable. Generous next to the 30-minute hold so a slow OAuth hop or a trip to
 * an email client still restores, but short enough that a tab left open overnight doesn't resurrect
 * yesterday's address into a new booking.
 */
export const DRAFT_TTL_MS = 90 * 60 * 1000;

function isCoords(v: unknown): v is Coords {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Coords).lat === 'number' &&
    typeof (v as Coords).lng === 'number' &&
    Number.isFinite((v as Coords).lat) &&
    Number.isFinite((v as Coords).lng)
  );
}

/**
 * Validate a stored draft. Pure, so the TTL and the shape rules are testable without a browser.
 *
 * Everything is optional and individually type-checked: this is same-origin data the customer's own
 * tab wrote, but it is still parsed input, and a half-written or hand-edited value must degrade to
 * "no draft" rather than push `undefined` into a form field or a fare calculation.
 */
export function parseDraft(raw: string | null, now: number): CheckoutDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const d = value as Record<string, unknown>;

  const savedAt = typeof d.savedAt === 'number' ? d.savedAt : null;
  // No stamp, from the future, or past the window → treat as absent.
  if (savedAt == null || savedAt > now || now - savedAt > DRAFT_TTL_MS) return null;

  const out: CheckoutDraft = { savedAt };
  const str = (k: keyof CheckoutDraft) => {
    const v = d[k];
    if (typeof v === 'string') (out[k] as string) = v;
  };
  const bool = (k: keyof CheckoutDraft) => {
    const v = d[k];
    if (typeof v === 'boolean') (out[k] as boolean) = v;
  };

  // Restored at most to the sign-in/details step: step 3 is Pay, which needs a live booking that the
  // separate gytm:booking:{occ} stash owns. Sending someone back there from a draft would show a pay
  // panel with nothing behind it.
  if (typeof d.step === 'number' && Number.isFinite(d.step)) {
    out.step = Math.min(Math.max(Math.trunc(d.step), 1), 2);
  }

  (
    [
      'pickupLoc',
      'dropoffText',
      'dropoffSlug',
      'dropoffName',
      'dropoffArea',
      'hotelQuery',
      'flightNumber',
      'arrivalTime',
      'arrivalDate',
      'departureFlight',
      'departureDate',
      'returnTime',
      'roomOrCabin',
      'luggageDetails',
      'childSeatAge',
      'name',
      'phone',
      'country',
      'gender',
      'company',
      'specialNotes',
    ] as const
  ).forEach(str);

  (['wantsPickup', 'tbd', 'dropoffSame', 'hotelNotListed', 'childSeatWanted'] as const).forEach(
    bool,
  );

  if (
    d.tripDirection === 'arrival' ||
    d.tripDirection === 'departure' ||
    d.tripDirection === 'return'
  ) {
    out.tripDirection = d.tripDirection;
  }
  if (isCoords(d.pickupCoords)) out.pickupCoords = d.pickupCoords;
  if (isCoords(d.dropoffCoords)) out.dropoffCoords = d.dropoffCoords;

  return out;
}

/** True when the customer has actually entered something worth keeping. */
export function draftHasContent(draft: CheckoutDraft): boolean {
  return Object.entries(draft).some(([key, value]) => {
    if (key === 'savedAt' || key === 'step') return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'boolean') return true;
    return value != null;
  });
}

export function loadDraft(occurrenceId: string, now = Date.now()): CheckoutDraft | null {
  if (typeof window === 'undefined' || !occurrenceId) return null;
  try {
    return parseDraft(window.sessionStorage.getItem(draftKey(occurrenceId)), now);
  } catch {
    return null; // sessionStorage unavailable (private mode) — the form just starts empty
  }
}

export function saveDraft(occurrenceId: string, draft: CheckoutDraft): void {
  if (typeof window === 'undefined' || !occurrenceId) return;
  try {
    if (!draftHasContent(draft)) return;
    window.sessionStorage.setItem(
      draftKey(occurrenceId),
      JSON.stringify({ ...draft, savedAt: Date.now() }),
    );
  } catch {
    /* sessionStorage unavailable — the draft simply isn't kept */
  }
}

/** Drop the draft. Called once the booking exists, so the customer's address stops being held here. */
export function clearDraft(occurrenceId: string): void {
  if (typeof window === 'undefined' || !occurrenceId) return;
  try {
    window.sessionStorage.removeItem(draftKey(occurrenceId));
  } catch {
    /* nothing to do */
  }
}
