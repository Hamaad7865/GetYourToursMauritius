import { apiHandler } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getBookingStatus, releasePendingBooking } from '@/lib/services/bookings';
import { jsonOk } from '@/lib/http/envelope';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/bookings/:ref/release — the customer removes their own unpaid "Awaiting payment" line
 * from the cart, handing the seats back immediately rather than waiting out the 30-minute hold.
 *
 * Ownership FIRST, exactly as the cancel route does it: an RLS-gated read (`getBookingStatus`)
 * returns 404 for a non-owner or an unknown ref, so a stranger cannot probe booking refs. Then
 * `api_release_pending_booking` re-checks ownership server-side and applies the money guard — a
 * booking with a settled payment surfaces as a friendly 409 (`payment_settled`), not a released seat.
 * Idempotent: a second call on an already-expired booking reports `alreadyReleased`.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { ref } = await params;
  const ctx = buildServiceContext(req);
  await getBookingStatus(ctx, ref); // ownership-first: RLS → 404 for a non-owner / unknown ref
  const result = await releasePendingBooking(ctx, ref);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
