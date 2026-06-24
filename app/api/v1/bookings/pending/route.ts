import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { listMyPendingBookings } from '@/lib/services/bookings';

export const runtime = 'edge';

/**
 * GET /api/v1/bookings/pending — the signed-in user's `payment_pending` bookings, each joined to its
 * live hold expiry, for the cart's "Awaiting payment" section. Owner-scoped by `api_my_pending_bookings`
 * (the RLS-safe seam onto the staff-only `booking_holds`); `requireUser` 401s an anonymous caller before
 * any DB access.
 */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const ctx = buildServiceContext(req);
  const bookings = await listMyPendingBookings(ctx);
  return jsonOk(bookings);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
