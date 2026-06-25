import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { transfers, type TransferRegion } from '@/lib/content/transfers';
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

/** Representative "from" price by region — fallback when a hotel has no generated content row (mirror of
 *  FROM_PRICE_BY_REGION in src/lib/content/transfers.ts). The exact price always comes from the quote. */
const FROM_PRICE_BY_REGION: Record<string, number> = {
  South: 25,
  East: 35,
  Central: 30,
  West: 40,
  North: 50,
};

/** slug → generated landing-page content (area, coords, duration, from-price). */
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
      fromPriceEur: c?.fromPriceEur ?? FROM_PRICE_BY_REGION[h.region as TransferRegion] ?? null,
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
    pax: query.pax,
    suv: query.suv ?? false,
    tripType: query.tripType,
  });
  return transferQuoteSchema.parse(data);
}
