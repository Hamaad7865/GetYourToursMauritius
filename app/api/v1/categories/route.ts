import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { listCategories } from '@/lib/services/activities';

export const runtime = 'edge';

/** GET /api/v1/categories — the active browse categories (public). */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  const ctx = buildServiceContext(req);
  const categories = await listCategories(ctx);
  return jsonOk(categories, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
