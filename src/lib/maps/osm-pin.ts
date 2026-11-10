import { lookupPlaceCoords, normalisePlaceName } from '@/lib/maps/place-coords';

/**
 * Find a map pin for an itinerary stop name, WITHOUT Google: the stored table first, then
 * OpenStreetMap Nominatim. Runs on the server (the staff-only /api/v1/admin/place-pins route) when an
 * admin saves a tour, so a new stop is pinned once, at save time, and every visitor after that reads
 * the stored pin — no per-visitor Geocoding bill, and nobody has to re-run a script.
 *
 * Why OSM and not Google: Google's geocodes may not be stored long-term; OSM data (ODbL) may, with
 * the attribution the itinerary map already shows. Pure fetch, no framework imports.
 */

export type Pin = { lat: number; lng: number };

/** Mauritius main island plus the northern islets (Flat Island ≈ -19.88). Same box as the
 *  build-place-coords script — a hit outside it is a wrong match (OSM once put "Grand Bay Beach"
 *  on Rodrigues), never stored. */
export const MAURITIUS_BOUNDS = { minLat: -20.6, maxLat: -19.75, minLng: 57.25, maxLng: 57.85 };

export function onMauritius(p: Pin): boolean {
  const b = MAURITIUS_BOUNDS;
  return p.lat > b.minLat && p.lat < b.maxLat && p.lng > b.minLng && p.lng < b.maxLng;
}

/** Nominatim's usage policy: an identifying User-Agent and at most one request per second. */
export const NOMINATIM_UA = 'belle-mare-tours-admin/1.0 (itinerary pins)';
export const NOMINATIM_GAP_MS = 1100;

/** One Nominatim lookup. null = no on-island match. Throws on a transport/HTTP failure, so the caller
 *  can tell "OSM doesn't know it" (cacheable) from "OSM was unreachable" (retry next save). */
export async function nominatimPin(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Pin | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('countrycodes', 'mu');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', `${name}, Mauritius`);
  const res = await fetchImpl(url.toString(), {
    headers: { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = (await res.json()) as Array<{ lat?: string; lon?: string }>;
  const top = rows[0];
  if (!top?.lat || !top?.lon) return null;
  const pin = { lat: Number(Number(top.lat).toFixed(5)), lng: Number(Number(top.lon).toFixed(5)) };
  return Number.isFinite(pin.lat) && Number.isFinite(pin.lng) && onMauritius(pin) ? pin : null;
}

/**
 * Pins for a batch of names, keyed by the name as given. A name the table marks unplaceable (a
 * generic phrase) or that OSM has no on-island match for comes back null; a name whose lookup
 * failed in transit is left OUT, so the editor can say "try again" rather than "not found".
 * Lookups are spaced NOMINATIM_GAP_MS apart and the same normalised name is asked once.
 */
export async function findPins(
  names: string[],
  deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Record<string, Pin | null>> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out: Record<string, Pin | null> = {};
  const asked = new Map<string, Pin | null>();
  let calls = 0;
  for (const name of names) {
    const stored = lookupPlaceCoords(name);
    if (stored !== undefined) {
      out[name] = stored;
      continue;
    }
    const key = normalisePlaceName(name);
    if (!key) continue;
    if (asked.has(key)) {
      out[name] = asked.get(key) ?? null;
      continue;
    }
    if (calls++ > 0) await sleep(NOMINATIM_GAP_MS);
    try {
      const pin = await nominatimPin(name, deps.fetchImpl);
      asked.set(key, pin);
      out[name] = pin;
    } catch {
      // Unreachable / rate-limited: leave it out — the next save asks again.
    }
  }
  return out;
}
