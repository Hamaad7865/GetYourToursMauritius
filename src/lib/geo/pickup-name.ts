/**
 * Turning a GPS fix into a pick-up NAME a driver can actually drive to.
 *
 * Why this is fussy: on the planner path the name is the ONLY locator that reaches the booking —
 * PlannerShell sends `pickup.name` and no coordinates — and it is printed verbatim on a one-line
 * voucher field. So "My location", a Plus Code, or a village name covering 5 km of coast road are all
 * operational failures, not cosmetic ones.
 *
 * Pure + structurally typed (no Google types), so the ranking is unit-testable without a browser.
 */

/** The slice of a Google reverse-geocode result we rank on. */
export interface GeocodedPlace {
  formatted_address?: string | null;
  types?: readonly string[];
}

/** Matches the truncation Checkout already applies to the pickup param, so what the customer sees is
 *  exactly what the driver gets. */
const MAX_NAME = 160;

/** Precise enough to name as-is: a building, a numbered address, or a named establishment. */
const EXACT_TYPES = [
  'premise',
  'subpremise',
  'street_address',
  'point_of_interest',
  'establishment',
  'lodging',
  'airport',
];
/** A road — good enough for a driver. */
const ROUTE_TYPES = ['route', 'intersection'];
/** A named part of a settlement — usable, still reasonably tight. */
const AREA_TYPES = ['neighborhood', 'sublocality', 'sublocality_level_1'];
/** A whole village/town — too coarse to present as an address, so it gets hedged. */
const COARSE_TYPES = ['locality', 'postal_town', 'administrative_area_level_1', 'country'];

/**
 * The voucher/invoice PDFs encode text as WinAnsi and DELETE anything outside printable Latin-1
 * (`toWinAnsi` in src/lib/invoice/pdf.ts). A name that survives here but not there would reach the
 * driver mangled or blank — worse than having no name at all, because nobody would notice.
 *
 * Mirrors toWinAnsi's normalisation, then rejects what it would strip. Kept as a local copy rather
 * than an import because that module pulls in pdf-lib (server-only); `tests/unit/pickup-name.test.ts`
 * cross-checks the two so they cannot drift.
 */
export function isVoucherSafe(value: string): boolean {
  const normalised = value
    .replace(/€/g, 'EUR')
    .replace(/[‘’‚‹›]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ');
  return normalised.trim().length > 0 && !/[^\x20-\xFF]/.test(normalised);
}

function clean(value: string | null | undefined): string | null {
  const s = (value ?? '').trim();
  if (!s) return null;
  // Reject non-Latin-1 names (a Cyrillic/Chinese/Arabic establishment name) — they cannot be printed
  // on the driver's voucher. Falling through to the next candidate, or to null, is the safe outcome.
  if (!isVoucherSafe(s)) return null;
  return s.slice(0, MAX_NAME);
}

function hasAny(types: readonly string[] | undefined, wanted: string[]): boolean {
  return Boolean(types?.some((t) => wanted.includes(t)));
}

/** A result carrying only a Plus Code ("4RQ4+F8 Belle Mare") — machine-navigable, but it reads as
 *  garbage on a printed voucher, so it is never used as a name. */
function isPlusCodeOnly(place: GeocodedPlace): boolean {
  const types = place.types ?? [];
  return types.length > 0 && types.every((t) => t === 'plus_code');
}

export interface PickupNameOptions {
  /** Allow the "Pinned location (lat, lng)" fallback. True only when the visitor explicitly asked to
   *  use their location — on the silent automatic path we would rather change nothing at all. */
  allowCoordFallback?: boolean;
}

/**
 * Choose the best pick-up name from reverse-geocode results (Google returns them most-specific-first,
 * but the JS API has no result-type filter, so we rank them ourselves).
 *
 * Returns `null` when nothing usable was found and no fallback is permitted — the caller must then
 * leave the pick-up exactly as it was rather than plant a vague string.
 */
export function pickPickupName(
  results: readonly GeocodedPlace[] | null | undefined,
  lat: number,
  lng: number,
  opts: PickupNameOptions = {},
): string | null {
  const usable = (results ?? []).filter((r) => !isPlusCodeOnly(r) && clean(r.formatted_address));

  for (const tier of [EXACT_TYPES, ROUTE_TYPES, AREA_TYPES]) {
    const hit = usable.find((r) => hasAny(r.types, tier));
    if (hit) return clean(hit.formatted_address);
  }
  // A whole town/village: usable only if hedged, so nobody reads it as a precise address.
  const coarse = usable.find((r) => hasAny(r.types, COARSE_TYPES));
  if (coarse) {
    const name = clean(coarse.formatted_address);
    if (name) return `Near ${name}`.slice(0, MAX_NAME);
  }
  // An untyped-but-addressed result is still better than nothing.
  const anyAddressed = usable[0];
  if (anyAddressed) return clean(anyAddressed.formatted_address);

  // Nothing nameable. Only the explicit path may fall back to coordinates — a driver can paste them
  // into Maps, which is far better than a silently wrong village.
  if (opts.allowCoordFallback && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  }
  return null;
}

/** Deterministic id for a detected point — never a fresh uuid (which would churn React keys and the
 *  optimize cache), and namespaced so it can't collide with a PICKUPS preset or a Google place id. */
export function geoPointId(lat: number, lng: number): string {
  return `geo:${lat.toFixed(5)},${lng.toFixed(5)}`;
}
