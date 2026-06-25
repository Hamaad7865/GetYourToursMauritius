import { apiHandler, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { facetsQuerySchema } from '@/lib/validation/tours';
import { searchFacets } from '@/lib/services/activities';

export const runtime = 'edge';

/** GET /api/v1/activities/facets — price/duration slider bounds for the q/category/type scope (public). */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  const query = parseQuery(req, facetsQuerySchema);
  const ctx = buildServiceContext(req);
  const facets = await searchFacets(ctx, query);
  return jsonOk(facets, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
