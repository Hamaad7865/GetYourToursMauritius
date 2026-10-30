import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { serviceRoleServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { requestGuestLink } from '@/lib/services/guest';
import { guestBookingLookupInputSchema } from '@/lib/validation/booking';

export const runtime = 'edge';

/**
 * POST /api/v1/bookings/lookup — "Find my booking", for a guest who has lost the email or is on a new
 * device. No auth: that is the point. It ALWAYS answers 202 and shows nothing. When the ref and the
 * email match a guest booking, a fresh manage link goes to the address already on the booking, never
 * the typed one, so this can only send mail to the mailbox that should have it.
 */
export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'bookings:lookup', 5, 3600);
  const input = await parseJsonBody(req, guestBookingLookupInputSchema);
  await requestGuestLink(serviceRoleServiceContext(), input);
  return jsonOk({ received: true }, { status: 202 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
