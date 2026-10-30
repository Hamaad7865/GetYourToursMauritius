import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { serviceRoleServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import {
  bookingRefLooksValid,
  clearGuestLinkCookie,
  readGuestLinkCookie,
} from '@/lib/guest/link-cookie';
import { NotFoundError } from '@/lib/services/errors';
import { adoptGuestBooking } from '@/lib/services/guest';
import { adoptGuestBookingInputSchema } from '@/lib/validation/booking';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/bookings/:ref/adopt — move a guest booking into the caller's guest session, on proof of
 * the emailed link. The page calls this only after the guest taps "View my booking", never on load:
 * see the /open route for why.
 *
 * The caller is still identified by the Bearer JWT. The link token is a second proof about the BOOKING,
 * from the httpOnly cookie /open set, or from `{ token }` for a mobile app holding the deep link.
 *
 * Anonymous callers only: a real account gets a guest booking by confirmed email, never by holding a
 * link (POST /api/v1/account/claim-guest-bookings). So a forwarded email cannot put a booking in a
 * stranger's account.
 *
 * ONE ANSWER FOR EVERY REFUSAL: 404. Unknown ref, bad token, a booking that is not guest-owned, a quote,
 * a real-account caller. A split between them would show which refs exist.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  const user = await requireUser(req);
  await rateLimit(req, 'bookings:adopt', 10, 600);
  const { ref } = await params;

  const body = adoptGuestBookingInputSchema.safeParse(await req.json().catch(() => ({})));
  const token = readGuestLinkCookie(req) ?? (body.success ? body.data.token : undefined);
  if (!user.isAnonymous || !bookingRefLooksValid(ref) || !token) {
    throw new NotFoundError('Not found');
  }

  const adopted = await adoptGuestBooking(serviceRoleServiceContext(), {
    ref,
    userId: user.id,
    token,
  });
  if (!adopted) throw new NotFoundError('Not found');

  return jsonOk({ ref }, { headers: { 'set-cookie': clearGuestLinkCookie(ref) } });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
