import { apiHandler, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { paginationMeta } from '@/lib/http/pagination';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { paginationQuerySchema } from '@/lib/validation/common';
import { listMyReviews } from '@/lib/services/reviews';

export const runtime = 'edge';

/** GET /api/v1/account/reviews — the caller's own reviews ("My reviews"), newest first, paginated. */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const query = parseQuery(req, paginationQuerySchema);
  const ctx = buildServiceContext(req);
  const { items, total } = await listMyReviews(ctx, query);
  return jsonOk(items, { meta: paginationMeta(query.page, query.pageSize, total) });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
