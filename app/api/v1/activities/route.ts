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
  const user = await authenticateOptional(req);
  const query = parseQuery(req, searchToursQuerySchema);
  const ctx = buildServiceContext(req);
  const { items, total } = await searchActivities(ctx, query);
  // Cache anonymous catalogue reads at the edge (changes rarely; takes load off the DB). Never
  // cache an authenticated response — a staff token can see drafts, which must not land in a
  // shared public cache.
  const headers = user
    ? undefined
    : { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' };
  return jsonOk(items, { meta: paginationMeta(query.page, query.pageSize, total), headers });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
