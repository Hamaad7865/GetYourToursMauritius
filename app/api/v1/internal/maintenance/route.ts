import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getBearerToken } from '@/lib/http/auth';
import { serviceRoleServiceContext } from '@/lib/http/context';
import { getServerEnv } from '@/lib/config/env';
import { runBookingMaintenance, materializeAvailability } from '@/lib/services/maintenance';

export const runtime = 'edge';

/**
 * POST /api/v1/internal/maintenance — worker endpoint that sweeps stale holds and expires
 * abandoned bookings. NOT public: requires INTERNAL_TASK_SECRET. Meant to run on a cron (e.g.
 * every 5 minutes).
 */
export const POST = apiHandler(async (req) => {
  const secret = getServerEnv().INTERNAL_TASK_SECRET;
  if (!secret) return jsonError(503, 'not_configured', 'Internal tasks are not configured');
  const provided = req.headers.get('x-internal-secret') ?? getBearerToken(req);
  if (provided !== secret) return jsonError(401, 'unauthorized', 'Invalid task secret');

  const ctx = serviceRoleServiceContext();
  const result = await runBookingMaintenance(ctx);
  // Roll the open-ended availability window forward (now that the read path no longer fills it).
  const slotsCreated = await materializeAvailability(ctx);
  return jsonOk({ ...result, slotsCreated });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
