import { apiHandler, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { paginationMeta } from '@/lib/http/pagination';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { searchToursQuerySchema } from '@/lib/validation/tours';
import { searchActivities } from '@/lib/services/activities';

export const runtime = 'edge';

/** GET /api/v1/activities — paginated catalogue search (public; RLS shows published only). */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  const query = parseQuery(req, searchToursQuerySchema);
  const ctx = buildServiceContext(req);
  const { items, total } = await searchActivities(ctx, query);
  return jsonOk(items, { meta: paginationMeta(query.page, query.pageSize, total) });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
