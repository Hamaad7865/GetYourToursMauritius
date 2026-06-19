import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/holds/:id — the hold's current lifecycle state, owner-scoped, so the cart can reconcile
 * its held lines on load. App-level authz + service role: we read the hold by id, then return it only
 * to its creator. A non-owner gets 404 (not 403) so the endpoint never leaks whether a hold exists.
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;

  const admin = createServiceRoleClient();
  const { data: hold, error: holdErr } = await admin
    .from('booking_holds')
    .select('status, expires_at, created_by')
    .eq('id', id)
    .maybeSingle();
  if (holdErr) throw new Error(holdErr.message);
  // Don't leak existence: an unknown hold and a hold the caller doesn't own both return not_found.
  if (!hold || hold.created_by !== user.id) {
    return jsonError(404, 'not_found', 'Hold not found');
  }

  return jsonOk({ holdId: id, status: hold.status, expiresAt: hold.expires_at });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
