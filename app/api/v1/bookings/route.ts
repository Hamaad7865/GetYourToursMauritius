import { apiHandler, parseJsonBody, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { paginationMeta } from '@/lib/http/pagination';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional, requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
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

/** POST /api/v1/bookings — create a payment_pending booking (guest or authenticated). Per-IP
 *  rate-limited so anonymous booking-row creation can't be scripted to exhaust inventory. */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const ctx = buildServiceContext(req);
  await rateLimit(req, ctx, 'bookings:create', 15);
  const input = await parseJsonBody(req, createBookingInputSchema);
  const booking = await createBooking(ctx, input);
  return jsonOk(booking, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
