import { apiHandler } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getBookingStatus, cancelBooking } from '@/lib/services/bookings';
import { jsonOk } from '@/lib/http/envelope';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/bookings/:ref/cancel — the customer cancels their own confirmed + paid booking and starts
 * a refund. Ownership FIRST: an RLS-gated read (`getBookingStatus`) returns 404 for a non-owner / unknown
 * ref, so a stranger can't probe bookings. Then `api_cancel_booking` (which re-checks ownership + the 24h
 * window server-side) routes it to refund_pending, frees the seat, and notifies the owner — who refunds in
 * Peach and marks it refunded. Typed RPC errors surface as a friendly 409 (cancellation_window_passed /
 * not_cancellable). The call is idempotent.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { ref } = await params;
  const ctx = buildServiceContext(req);
  await getBookingStatus(ctx, ref); // ownership-first: RLS → 404 for a non-owner / unknown ref
  const result = await cancelBooking(ctx, ref);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
