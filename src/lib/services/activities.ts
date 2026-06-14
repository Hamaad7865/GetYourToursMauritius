import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { NotFoundError } from './errors';
import {
  tourDetailSchema,
  tourSummarySchema,
  type SearchToursQuery,
  type TourDetail,
  type TourSummary,
} from '@/lib/validation/tours';

export interface Paginated<T> {
  items: T[];
  total: number;
}

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
    page: query.page,
    pageSize: query.pageSize,
  });
  const result = searchResultSchema.parse(data);
  return { items: result.items, total: result.total };
}

export async function getActivity(ctx: ServiceContext, slug: string): Promise<TourDetail> {
  const data = await callRpc(ctx, 'api_get_activity', { slug });
  if (data === null || data === undefined) {
    throw new NotFoundError(`Activity "${slug}" not found`);
  }
  return tourDetailSchema.parse(data);
}
