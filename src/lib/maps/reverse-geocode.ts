'use client';

import type { GeocodedPlace } from '@/lib/geo/pickup-name';
import { osmReverseName } from '@/lib/maps/osm-reverse';

/**
 * Coordinates → candidate place names, via the Maps JS Geocoder already loaded app-wide by
 * `useGoogleMaps()`. Same class and same billed Geocoding API as the forward lookup in `geocode.ts`
 * and the pin-drop in `PickupMap.tsx` — no new API, no new key.
 *
 * Returns the raw candidate list; the CHOICE of name is a pure, unit-tested decision in
 * `src/lib/geo/pickup-name.ts`. Never throws: an unavailable Geocoder is just "no candidates".
 *
 * Results come back in English because the Maps script pins `language: 'en'` (see useGoogleMaps) —
 * required, because this name is printed on a Latin-1-encoded voucher.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodedPlace[]> {
  const google_ = await googleReverse(lat, lng);
  if (google_.length) return google_;
  // Google refused or found nothing (an unpaid bill blocked it in Nov 2026): OpenStreetMap's name,
  // typed as an establishment so pickPickupName takes it as-is.
  const name = await osmReverseName(lat, lng);
  return name ? [{ formatted_address: name, types: ['establishment'] }] : [];
}

async function googleReverse(lat: number, lng: number): Promise<GeocodedPlace[]> {
  try {
    if (typeof google === 'undefined' || !google.maps?.Geocoder) return [];
    const geocoder = new google.maps.Geocoder();
    const { results } = await geocoder.geocode({
      location: { lat, lng },
      // A ccTLD biasing hint — it does NOT set the language (that is script-load-time only).
      region: 'MU',
    });
    return (results ?? []).map((r) => ({
      formatted_address: r.formatted_address,
      types: r.types,
    }));
  } catch {
    return [];
  }
}
