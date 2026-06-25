import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { markNotificationRead } from '@/lib/services/notifications-feed';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ id: string }> };

/** POST /api/v1/notifications/{id}/read — mark a notification read (owner-scoped). 403 if it isn't the
 *  caller's, 404 if it doesn't exist. Idempotent. */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { id } = await params;
  const ctx = buildServiceContext(req);
  const result = await markNotificationRead(ctx, id);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
