import { apiHandler, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { paginationMeta } from '@/lib/http/pagination';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { notificationsQuerySchema } from '@/lib/validation/notifications';
import { listNotifications } from '@/lib/services/notifications-feed';

export const runtime = 'edge';

/** GET /api/v1/notifications — the signed-in user's notification feed, newest first, paginated, with an
 *  optional `unreadOnly` filter. Owner-scoped; 401 for an anonymous caller. */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const query = parseQuery(req, notificationsQuerySchema);
  const ctx = buildServiceContext(req);
  const { items, total } = await listNotifications(ctx, query);
  return jsonOk(items, { meta: paginationMeta(query.page, query.pageSize, total) });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
