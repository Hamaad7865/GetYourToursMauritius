import { cache } from 'react';
import { publicServiceContext } from '@/lib/http/context';
import { getActivity } from '@/lib/services/activities';
import {
  AIRPORT_FARE_DEFAULT,
  airportTransferFareMinor,
  airportZoneForSlug,
  centsToEur,
  type AirportFareByZone,
} from '@/lib/services/pricing';

const AIRPORT_SLUG = 'airport-transfer';

/**
 * The LIVE airport zone × vehicle fare matrix, for the server-rendered transfer pages.
 *
 * Why this exists: the per-hotel pages used to advertise a hardcoded per-region "from" price
 * (`FROM_PRICE_BY_REGION`, written when the fares were region-based). The fare model later became
 * ZONE-based and the constant never followed, so every page advertised BELOW what the booking widget
 * charges — €35 vs €25 on a near-airport hotel, €55 vs €35 on Belle Mare. A price the site doesn't
 * honour is worse than an unhelpful one, and it rode into the meta description and the JSON-LD Offer,
 * so Google showed it too. The fare table is the owner's (admin → Pricing), so it is the only source.
 *
 * Cached per request (React `cache`), so `generateMetadata` and the page body share one RPC. Falls
 * back to the bundled seed defaults when the fetch fails or the DB still returns the pre-migration
 * region-keyed shape — the same guard TransferBookingWidget applies to its own client-side fetch.
 */
export const loadAirportFares = cache(async (): Promise<AirportFareByZone> => {
  try {
    const activity = await getActivity(publicServiceContext(), AIRPORT_SLUG);
    const live = activity.airportFares;
    if (live?.zone1 && live?.zone2) return live;
  } catch (error) {
    console.error('[transfers] airport fare fetch failed', error);
  }
  return AIRPORT_FARE_DEFAULT;
});

/**
 * A hotel's real "from" fare in EUR: its zone's STANDARD CAR, one way — the cheapest thing anyone can
 * actually book to that hotel, which is exactly what "from €X / car" claims. Mirrors what the widget
 * quotes for a party of ≤4 without the SUV upgrade, and what api_book charges.
 */
export function transferFromPriceEur(slug: string, fares: AirportFareByZone): number {
  return centsToEur(airportTransferFareMinor(airportZoneForSlug(slug), 4, false, fares));
}
