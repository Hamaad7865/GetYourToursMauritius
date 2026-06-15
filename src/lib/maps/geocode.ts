'use client';

/* Turns a place name (e.g. "Port Louis") into coordinates via the Maps JS Geocoder. Results
 * are cached in-memory and in sessionStorage so a place is geocoded at most once per session —
 * keeping Geocoding API usage (and cost) minimal. Returns null when geocoding is unavailable
 * or finds nothing, so callers can fall back to a keyless map link. */

const memCache = new Map<string, google.maps.LatLngLiteral | null>();

function normalise(query: string): string {
  return /mauritius/i.test(query) ? query : `${query}, Mauritius`;
}

function readSession(key: string): google.maps.LatLngLiteral | null | undefined {
  try {
    const raw = sessionStorage.getItem(`gytm:geo:${key}`);
    return raw ? (JSON.parse(raw) as google.maps.LatLngLiteral | null) : undefined;
  } catch {
    return undefined;
  }
}

function writeSession(key: string, value: google.maps.LatLngLiteral | null): void {
  try {
    sessionStorage.setItem(`gytm:geo:${key}`, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — fine, we still have the in-memory cache */
  }
}

export async function geocode(query: string): Promise<google.maps.LatLngLiteral | null> {
  const q = normalise(query).toLowerCase();
  if (memCache.has(q)) return memCache.get(q) ?? null;

  const cached = readSession(q);
  if (cached !== undefined) {
    memCache.set(q, cached);
    return cached;
  }

  try {
    const geocoder = new google.maps.Geocoder();
    const { results } = await geocoder.geocode({
      address: normalise(query),
      componentRestrictions: { country: 'MU' },
    });
    const loc = results[0]?.geometry.location;
    const value = loc ? { lat: loc.lat(), lng: loc.lng() } : null;
    memCache.set(q, value);
    writeSession(q, value);
    return value;
  } catch {
    memCache.set(q, null);
    return null;
  }
}
