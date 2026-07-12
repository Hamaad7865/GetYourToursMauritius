import { apiHandler, parseJsonBody, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { paginationMeta } from '@/lib/http/pagination';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext, serviceRoleRpcContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { bookingHistoryQuerySchema, createBookingInputSchema } from '@/lib/validation/booking';
import { createBooking, listMyBookings } from '@/lib/services/bookings';

export const runtime = 'edge';

/**
 * GET /api/v1/bookings — the signed-in user's booking history ("My Trips"), newest first, paginated,
 * with optional `status` and trip-date (`from`/`to`) filters. Owner-scoped by api_my_bookings;
 * `requireUser` 401s an anonymous caller before any DB access. Detail stays at GET /bookings/{ref}.
 */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const query = parseQuery(req, bookingHistoryQuerySchema);
  const ctx = buildServiceContext(req);
  const { items, total } = await listMyBookings(ctx, query);
  return jsonOk(items, { meta: paginationMeta(query.page, query.pageSize, total) });
});

/** POST /api/v1/bookings — create a payment_pending booking. SIGNED-IN ONLY: the checkout UI forces
 *  sign-in before booking, api_create_payment requires the booking owner anyway (a guest booking could
 *  never be paid), and api_book's anon grant is revoked — so an anonymous caller gets a clean 401 here
 *  instead of a raw DB permission error. Per-IP rate-limited so booking-row creation can't be scripted
 *  to exhaust inventory. */
export const POST = apiHandler(async (req) => {
  const user = await requireUser(req);
  await rateLimit(req, 'bookings:create', 15);
  const input = await parseJsonBody(req, createBookingInputSchema);
  // api_book is service-role-only (a registered user could otherwise call it directly and skip the
  // limiter above), so book through a service-role client and hand the RPC the JWKS-verified user id to
  // stamp as the booking owner — never trusting a client-sent id.
  const booking = await createBooking(serviceRoleRpcContext(), input, user.id);
  return jsonOk(booking, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
