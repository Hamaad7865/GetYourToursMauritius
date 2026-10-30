import { apiHandler, parseJsonBody, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { paginationMeta } from '@/lib/http/pagination';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import {
  buildServiceContext,
  serviceRoleRpcContext,
  serviceRoleServiceContext,
} from '@/lib/http/context';
import { localeFromCookieHeader } from '@/lib/http/request-locale';
import { clientIp, rateLimit } from '@/lib/http/rate-limit';
import { bookingHistoryQuerySchema, createBookingInputSchema } from '@/lib/validation/booking';
import { createBooking, listMyBookings } from '@/lib/services/bookings';
import { assertGuestBookingAllowed } from '@/lib/services/guest';
import { AccountRequiredError } from '@/lib/services/errors';
import { verifyTurnstile } from '@/lib/guest/turnstile';
import { readGuestCheckoutConfig } from '@/lib/settings/guest-checkout';

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

/** POST /api/v1/bookings — create a payment_pending booking. Needs a JWT, and a caller with none gets
 *  a clean 401: api_book's anon grant is revoked and api_create_payment requires the booking owner.
 *
 *  A GUEST has a JWT too, from a Supabase anonymous sign-in, and owns the booking like anyone else, so
 *  everything after this route runs unchanged. Their branch only adds what a free identity needs: the
 *  owner's kill switch, a per-IP limit, Turnstile and the caps (services/guest.ts).
 *
 *  Per-IP rate-limited so booking-row creation can't be scripted to exhaust inventory. */
export const POST = apiHandler(async (req) => {
  const user = await requireUser(req);
  await rateLimit(req, 'bookings:create', 15);
  const input = await parseJsonBody(req, createBookingInputSchema);
  // The language the checkout is in. The confirmation email and PDFs render from this, later and
  // off-request, and for a guest that email is the way back to the booking.
  const locale = localeFromCookieHeader(req.headers.get('cookie'));

  if (user.isAnonymous) {
    const { enabled } = await readGuestCheckoutConfig();
    if (!enabled) throw new AccountRequiredError();
    await rateLimit(req, 'bookings:guest', 10, 3600);
    await verifyTurnstile(input.turnstileToken, clientIp(req));
    await assertGuestBookingAllowed(serviceRoleServiceContext(), {
      userId: user.id,
      email: input.customer.email,
      idempotencyKey: input.idempotencyKey,
    });
    // Always 'web': the manage link and the claim only ever touch web bookings.
    const booking = await createBooking(
      serviceRoleRpcContext(locale),
      { ...input, source: 'web' },
      user.id,
    );
    return jsonOk(booking, { status: 201 });
  }

  // api_book is service-role-only (a registered user could otherwise call it directly and skip the
  // limiter above), so book through a service-role client and hand the RPC the JWKS-verified user id to
  // stamp as the booking owner — never trusting a client-sent id.
  const booking = await createBooking(serviceRoleRpcContext(locale), input, user.id);
  return jsonOk(booking, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
