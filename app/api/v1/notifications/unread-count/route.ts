import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getUnreadCount } from '@/lib/services/notifications-feed';

export const runtime = 'edge';

/** GET /api/v1/notifications/unread-count — the caller's unread count for the bell badge. Owner-scoped;
 *  401 for an anonymous caller. */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const ctx = buildServiceContext(req);
  const result = await getUnreadCount(ctx);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
