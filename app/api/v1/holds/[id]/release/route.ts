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
 * caller, then flip the hold inactive (mirrors /payments/sync). A leaked hold id alone can't release
 * someone else's reservation — only its creator may. Idempotent: an already-inactive hold updates
 * zero rows and still returns 200 (so removing an already-expired held line never errors).
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

  // Idempotent: only an active hold is flipped; an already released/expired one updates zero rows
  // (no error). Setting status away from 'active' frees the reserved capacity (used_capacity counts
  // active holds). Ownership was verified above, so this is the owner releasing their own hold.
  const { error: releaseErr } = await admin
    .from('booking_holds')
    .update({ status: 'released' })
    .eq('id', id)
    .eq('status', 'active');
  if (releaseErr) throw new Error(releaseErr.message);

  return jsonOk({ released: true });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
