import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { NotFoundError } from './errors';
import {
  categorySummarySchema,
  facetsSchema,
  tourDetailSchema,
  tourSummarySchema,
  type CategorySummary,
  type Facets,
  type FacetsQuery,
  type SearchToursQuery,
  type TourDetail,
  type TourSummary,
} from '@/lib/validation/tours';

export interface Paginated<T> {
  items: T[];
  total: number;
}

/** Dedicated transfer products are booked via the /airport-transfers flow, not the tour catalogue, so
 *  they must never appear as catalogue activities. Excluded from every catalogue surface (home rails,
 *  browse, search, related, sitemap) at the searchActivities chokepoint; the now-empty "Airport
 *  transfers" category then drops out of the home showcase on its own. (Rentals are a separate concern
 *  and stay.) */
export const CATALOGUE_HIDDEN_SLUGS = ['airport-transfer', 'hotel-transfer'];

const searchResultSchema = z.object({
  items: z.array(tourSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export async function searchActivities(
  ctx: ServiceContext,
  query: SearchToursQuery,
): Promise<Paginated<TourSummary>> {
  const data = await callRpc(ctx, 'api_search_activities', {
    q: query.q ?? null,
    category: query.category ?? null,
    type: query.type ?? null,
    region: query.region ?? null,
    priceMin: query.priceMin ?? null,
    priceMax: query.priceMax ?? null,
    durationMin: query.durationMin ?? null,
    durationMax: query.durationMax ?? null,
    minRating: query.minRating ?? null,
    page: query.page,
    pageSize: query.pageSize,
  });
  const result = searchResultSchema.parse(data);
  // Drop the dedicated transfer products (see CATALOGUE_HIDDEN_SLUGS) from every catalogue surface, and
  // decrement the count by however many were removed from this page (exact for the single-page fetches
  // the home/related/sitemap use).
  const items = result.items.filter((i) => !CATALOGUE_HIDDEN_SLUGS.includes(i.slug));
  return { items, total: result.total - (result.items.length - items.length) };
}

export async function getActivity(ctx: ServiceContext, slug: string): Promise<TourDetail> {
  const data = await callRpc(ctx, 'api_get_activity', { slug });
  if (data === null || data === undefined) {
    throw new NotFoundError(`Activity "${slug}" not found`);
  }
  return tourDetailSchema.parse(data);
}

/** Filter-slider bounds (price/duration) for the current q/category/type scope. */
export async function searchFacets(ctx: ServiceContext, query: FacetsQuery): Promise<Facets> {
  const data = await callRpc(ctx, 'api_search_facets', {
    q: query.q ?? null,
    category: query.category ?? null,
    type: query.type ?? null,
  });
  return facetsSchema.parse(data);
}

/** The active browse categories. */
export async function listCategories(ctx: ServiceContext): Promise<CategorySummary[]> {
  const data = await callRpc(ctx, 'api_list_categories', {});
  return z.array(categorySummarySchema).parse(data ?? []);
}
