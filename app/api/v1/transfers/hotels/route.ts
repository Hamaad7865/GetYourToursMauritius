import { apiHandler, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { paginationMeta } from '@/lib/http/pagination';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { transferHotelsQuerySchema } from '@/lib/validation/transfers';
import { searchTransferHotels } from '@/lib/services/transfers';

export const runtime = 'edge';

/** GET /api/v1/transfers/hotels — typeahead over the bookable airport-transfer hotels (public). */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  const query = parseQuery(req, transferHotelsQuerySchema);
  const ctx = buildServiceContext(req);
  const { items, total } = await searchTransferHotels(ctx, query);
  return jsonOk(items, {
    meta: paginationMeta(query.page, query.pageSize, total),
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
