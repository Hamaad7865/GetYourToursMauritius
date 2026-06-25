import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { markAllNotificationsRead } from '@/lib/services/notifications-feed';

export const runtime = 'edge';

/** POST /api/v1/notifications/read-all — mark every one of the caller's notifications read. Idempotent
 *  (returns updated:0 when nothing was unread). */
export const POST = apiHandler(async (req) => {
  await requireUser(req);
  const ctx = buildServiceContext(req);
  const result = await markAllNotificationsRead(ctx);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
