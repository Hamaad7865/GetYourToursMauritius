import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getBearerToken } from '@/lib/http/auth';
import { serviceRoleServiceContext } from '@/lib/http/context';
import { getServerEnv } from '@/lib/config/env';
import { getNotificationProvider } from '@/lib/notifications';
import { drainNotifications } from '@/lib/services/notifications';

export const runtime = 'edge';

/**
 * POST /api/v1/internal/notifications/drain — worker endpoint that sends queued notifications.
 * NOT public: requires INTERNAL_TASK_SECRET (via `x-internal-secret` or a Bearer token), and is
 * 503 until that secret is configured. Meant to be called by a scheduler (cron) every minute.
 */
export const POST = apiHandler(async (req) => {
  const secret = getServerEnv().INTERNAL_TASK_SECRET;
  if (!secret) return jsonError(503, 'not_configured', 'Internal tasks are not configured');
  const provided = req.headers.get('x-internal-secret') ?? getBearerToken(req);
  if (provided !== secret) return jsonError(401, 'unauthorized', 'Invalid task secret');

  const ctx = serviceRoleServiceContext();
  const result = await drainNotifications(ctx, getNotificationProvider());
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
