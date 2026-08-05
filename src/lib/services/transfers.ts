import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { transfers } from '@/lib/content/transfers';
import { loadAirportFares } from '@/lib/transfers/from-price';
import { airportTransferFareMinor, centsToEur } from '@/lib/services/pricing';
import {
  transferAreaSchema,
  transferHotelSchema,
  transferQuoteSchema,
  type TransferArea,
  type TransferHotel,
  type TransferHotelsQuery,
  type TransferQuote,
  type TransferQuoteQuery,
} from '@/lib/validation/transfers';

/** slug → generated landing-page content (area, coords, duration). */
const CONTENT_BY_SLUG = new Map(transfers.map((t) => [t.slug, t]));

const hotelsRpcSchema = z.object({
  items: z.array(
    z.object({ slug: z.string(), name: z.string(), region: z.string(), zone: z.string() }),
  ),
  total: z.number().int(),
});

/** Typeahead over the bookable airport-transfer hotels, enriched with display extras from content. */
export async function searchTransferHotels(
  ctx: ServiceContext,
  query: TransferHotelsQuery,
): Promise<{ items: TransferHotel[]; total: number }> {
  const data = await callRpc(ctx, 'api_search_transfer_hotels', {
    q: query.q ?? null,
    page: query.page,
    pageSize: query.pageSize,
  });
  const parsed = hotelsRpcSchema.parse(data ?? { items: [], total: 0 });
  // The row's own ZONE decides the fare, priced off the live matrix — this used to be a per-region
  // estimate (a second copy of the one the landing pages carried), which sat below what a guest is
  // actually charged. Standard car, one way: the cheapest thing bookable to that hotel.
  const fares = await loadAirportFares();
  const items = parsed.items.map((h): TransferHotel => {
    const c = CONTENT_BY_SLUG.get(h.slug);
    return transferHotelSchema.parse({
      slug: h.slug,
      name: h.name,
      region: h.region,
      zone: h.zone,
      area: c?.area ?? null,
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      durationMin: c?.durationMinFromAirport ?? null,
      fromPriceEur: centsToEur(airportTransferFareMinor(h.zone, 4, false, fares)) || null,
    });
  });
  return { items, total: parsed.total };
}

/** The curated point-to-point area list (region + airport zone), server-classified. */
export async function listTransferAreas(ctx: ServiceContext): Promise<TransferArea[]> {
  const data = await callRpc(ctx, 'api_list_transfer_areas', {});
  return z.array(transferAreaSchema).parse(data ?? []);
}

/** A read-only transfer fare estimate that equals the api_book charge for the same inputs. */
export async function quoteTransfer(
  ctx: ServiceContext,
  query: TransferQuoteQuery,
): Promise<TransferQuote> {
  const data = await callRpc(ctx, 'api_transfer_quote', {
    transferSlug: query.transferSlug,
    dropoffSlug: query.dropoffSlug ?? null,
    dropoffArea: query.dropoffArea ?? null,
    pickupSlug: query.pickupSlug ?? null,
    pickupArea: query.pickupArea ?? null,
    pickupLat: query.pickupLat ?? null,
    pickupLng: query.pickupLng ?? null,
    dropoffLat: query.dropoffLat ?? null,
    dropoffLng: query.dropoffLng ?? null,
    pax: query.pax,
    suv: query.suv ?? false,
    tripType: query.tripType,
  });
  return transferQuoteSchema.parse(data);
}
