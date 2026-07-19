/**
 * The single source of truth for "is this point on Mauritius". Used to restrict Google Places
 * searches to the island AND — the higher-stakes use — to decide whether a visitor's own GPS fix may
 * become their tour pick-up. That second use is authoritative: a VPN, a spoofed IP or a stale fix from
 * another country must never plant a foreign pick-up on a real booking, whatever the IP says.
 *
 * Deliberately mainland-only. Rodrigues (≈ -19.7, 63.4) is politically Mauritius but we do not operate
 * there, so a fix in Rodrigues is correctly treated as "not a pick-up we can serve".
 */

/** Mainland Mauritius bounding box (the island plus a small coastal margin). */
export const MAURITIUS_BOUNDS = {
  minLat: -20.55,
  maxLat: -19.95,
  minLng: 57.29,
  maxLng: 57.81,
} as const;

/** The Places API's rectangle shape, derived from the same numbers so the two can never drift. */
export const MAURITIUS_RECT = {
  low: { latitude: MAURITIUS_BOUNDS.minLat, longitude: MAURITIUS_BOUNDS.minLng },
  high: { latitude: MAURITIUS_BOUNDS.maxLat, longitude: MAURITIUS_BOUNDS.maxLng },
} as const;

/** ISO 3166-1 alpha-2 for Mauritius, as returned by Cloudflare's CF-IPCountry header. */
export const MAURITIUS_COUNTRY = 'MU';

/**
 * True when a coordinate falls inside {@link MAURITIUS_BOUNDS}. Rejects NaN/Infinity explicitly —
 * a non-finite coordinate must never pass a containment test that gates a booking field.
 */
export function isInMauritius(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= MAURITIUS_BOUNDS.minLat &&
    lat <= MAURITIUS_BOUNDS.maxLat &&
    lng >= MAURITIUS_BOUNDS.minLng &&
    lng <= MAURITIUS_BOUNDS.maxLng
  );
}
