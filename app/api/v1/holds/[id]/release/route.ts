import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/holds/:id/release — release a hold the caller owns (the cart calls this when a held
 * line is removed). App-level authz + service role: we read the hold's owner, verify it against the
 * caller, then call the service-role-granted `release_hold` (mirrors /payments/sync). A leaked hold
 * id alone can't release someone else's reservation — only its creator may. Idempotent at the DB.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;

  const admin = createServiceRoleClient();
  const { data: hold, error: holdErr } = await admin
    .from('booking_holds')
    .select('id, created_by')
    .eq('id', id)
    .maybeSingle();
  if (holdErr) throw new Error(holdErr.message);
  if (!hold) return jsonError(404, 'not_found', 'Hold not found');
  // Authorize: only the hold's owner may release it (the hold id is not a bearer credential).
  if (hold.created_by !== user.id) {
    return jsonError(403, 'forbidden', 'You do not own this hold');
  }

  const { error: releaseErr } = await admin.rpc('release_hold', { p_hold_id: id });
  if (releaseErr) throw new Error(releaseErr.message);

  return jsonOk({ released: true });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
