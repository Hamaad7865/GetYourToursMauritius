import { TRANSFERS_RAW } from './_transfers.gen';

/**
 * Per-hotel airport-transfer landing pages. Raw content (intro/FAQ/etc.) is generated
 * into `_transfers.gen.ts`; this module types it and layers a representative "from" price
 * by region (SSR airport sits in the south-east, so the south/east coasts are nearest).
 */

export type TransferRegion = 'North' | 'South' | 'East' | 'West' | 'Central';

export interface TransferContent {
  slug: string;
  hotelName: string;
  area: string;
  region: TransferRegion;
  distanceKmFromAirport: number;
  durationMinFromAirport: number;
  /** Hotel coordinates (geocoded once into _transfers.gen.ts). Used to pin the hotel + draw the
   *  airport→hotel route on the maps. Optional: a missing coord falls back to geocoding by name. */
  lat?: number;
  lng?: number;
  intro: string;
  included: string[];
  nearbyAttractions: string[];
  faq: { q: string; a: string }[];
}

export interface Transfer extends TransferContent {
  path: string;
  fromPriceEur: number;
}

/** Representative private-car "from" price by region. The exact quote comes at booking. */
const FROM_PRICE_BY_REGION: Record<TransferRegion, number> = {
  South: 25,
  East: 35,
  Central: 30,
  West: 40,
  North: 50,
};

export function transferPath(slug: string): string {
  return `/airport-transfers/${slug}`;
}

export const transfers: Transfer[] = TRANSFERS_RAW.map((t) => ({
  ...t,
  path: transferPath(t.slug),
  fromPriceEur: FROM_PRICE_BY_REGION[t.region] ?? 35,
})).sort((a, b) => a.hotelName.localeCompare(b.hotelName));

export function getTransfer(slug: string): Transfer | null {
  return transfers.find((t) => t.slug === slug) ?? null;
}

/**
 * The listed hotel geographically CLOSEST to a picked point (e.g. a Google Places selection that isn't
 * one of our 45 hotels). Airport transfers are priced by a coarse zone (near-airport vs the rest), so the
 * nearest listed hotel shares the picked place's zone — we snap to it for pricing + its bookable page.
 * Squared-degree distance is fine over an island this small. Falls back to the first hotel if none carry
 * coordinates yet.
 */
export function nearestTransfer(lat: number, lng: number): Transfer {
  let best: Transfer = transfers[0]!;
  let bestDist = Infinity;
  for (const t of transfers) {
    if (t.lat == null || t.lng == null) continue;
    const dist = (t.lat - lat) ** 2 + (t.lng - lng) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

export const TRANSFER_REGION_ORDER: TransferRegion[] = [
  'North',
  'East',
  'South',
  'West',
  'Central',
];

export function transferMetaTitle(t: Transfer): string {
  // Root template appends the site name — don't repeat the brand here.
  return `Airport Transfer to ${t.hotelName} — from €${t.fromPriceEur}`;
}

export function transferMetaDescription(t: Transfer): string {
  return `Private airport transfer from SSR Airport to ${t.hotelName}, ${t.area} (about ${t.durationMinFromAirport} min). Fixed price from €${t.fromPriceEur} per car, meet & greet, flight tracking and a free child seat. Book online with Belle Mare Tours.`.slice(
    0,
    320,
  );
}
