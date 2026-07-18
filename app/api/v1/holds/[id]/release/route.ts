import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser, getBearerToken } from '@/lib/http/auth';
import { createUserClient } from '@/lib/supabase/client';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/holds/:id/release — release a hold the caller owns (the cart calls this when a held
 * line is removed).
 *
 * Routes through the locked `api_release_hold` RPC AS THE CALLER (user JWT → auth.uid()), rather than a
 * raw service-role update. That RPC is the single source of truth for two guards this endpoint must
 * not skip:
 *   1. ownership — `auth.uid() = created_by` (a leaked hold id is not a bearer credential), and
 *   2. `hold_attached` — a hold already bound to an in-flight booking is CONSUMED, not releasable;
 *      freeing it would hand the seat away while that booking is mid-payment, bouncing a legitimately
 *      paid booking into refund_pending at the paid-time capacity re-check.
 * The previous direct `update booking_holds set status='released'` enforced (1) but not (2).
 * Idempotent: releasing an already-inactive hold is a no-op that still returns 200.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req); // 401 fast on a missing/invalid token before we touch the DB
  const { id } = await params;

  const supabase = createUserClient(getBearerToken(req));
  const { error } = await supabase.rpc('api_release_hold', { p_hold_id: id });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('hold_not_found')) return jsonError(404, 'not_found', 'Hold not found');
    if (msg.includes('hold_attached')) {
      return jsonError(409, 'conflict', 'This hold is attached to a booking and can’t be released');
    }
    if (msg.includes('forbidden')) return jsonError(403, 'forbidden', 'You do not own this hold');
    throw new Error(msg);
  }

  return jsonOk({ released: true });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
