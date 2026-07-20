import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { getBookingStatus, rescheduleBooking } from '@/lib/services/bookings';
import { rescheduleBookingInputSchema } from '@/lib/validation/booking';
import { jsonOk } from '@/lib/http/envelope';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/bookings/:ref/reschedule — the customer moves their own confirmed + paid booking to another
 * date. Ownership FIRST: an RLS-gated read (`getBookingStatus`) returns 404 for a non-owner / unknown ref,
 * so a stranger can't probe bookings. Then `api_reschedule_booking` re-checks ownership, pins the target to
 * the SAME activity option (same option = same price, so no money moves), re-checks capacity under a row
 * lock, and enforces the 24h window — bypassed only for a booking WE disrupted. Typed RPC errors surface as
 * friendly 409s. Idempotent.
 *
 * Rate-limited unlike the sibling cancel route: this one takes a client-supplied occurrence id, so it is
 * the only booking mutation a signed-in user could otherwise use to probe occurrence ids in a loop.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  await rateLimit(req, 'bookings:reschedule', 10);
  const { ref } = await params;
  const input = await parseJsonBody(req, rescheduleBookingInputSchema);
  const ctx = buildServiceContext(req);
  await getBookingStatus(ctx, ref); // ownership-first: RLS → 404 for a non-owner / unknown ref
  const result = await rescheduleBooking(ctx, ref, input.occurrenceId);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
