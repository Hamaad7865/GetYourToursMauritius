import { isVoucherSafe } from '@/lib/geo/pickup-name';

/**
 * Coordinates → a pick-up name from OpenStreetMap, for when Google's Geocoder refuses (an unpaid
 * Google bill, a quota, an outage). November 2026: Google blocked the key for an unpaid balance and
 * every dropped pin reached the booking as "Pinned location (-20.08986, 57.51087)" — which OSM names
 * as "The Westin Turtle Bay Resort & Spa". The driver needs a name, so the fallback must not depend
 * on the very provider that just failed.
 *
 * Browser-side (the CSP allows nominatim.openstreetmap.org). Never throws: null = no name found.
 */

type NominatimReverse = {
  name?: string;
  address?: Record<string, string | undefined>;
};

const MAX_NAME = 160;

/** "Hotel name, road, village" — the parts a driver needs, de-duplicated and voucher-safe. Pure. */
export function osmPickupLabel(r: NominatimReverse | null | undefined): string | null {
  if (!r) return null;
  const a = r.address ?? {};
  const place =
    r.name ||
    a.tourism ||
    a.amenity ||
    a.building ||
    a.aeroway ||
    (a.house_number && a.road ? `${a.house_number} ${a.road}` : undefined);
  const area = a.village || a.town || a.hamlet || a.suburb || a.city;
  const parts: string[] = [];
  for (const p of [place, a.road, area]) {
    const s = (p ?? '').trim();
    if (!s || !isVoucherSafe(s)) continue;
    if (parts.some((q) => q.toLowerCase().includes(s.toLowerCase()))) continue;
    parts.push(s);
  }
  if (!parts.length) return null;
  // Only a village, no place or road: hedge it, like pickPickupName does for a town.
  if (!place && !a.road) return `Near ${parts[0]}`.slice(0, MAX_NAME);
  return parts.join(', ').slice(0, MAX_NAME);
}

export async function osmReverseName(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'en');
    const res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return osmPickupLabel((await res.json()) as NominatimReverse);
  } catch {
    return null;
  }
}
