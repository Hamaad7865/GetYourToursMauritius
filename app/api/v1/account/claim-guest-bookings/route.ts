import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireAccount } from '@/lib/http/auth';
import { serviceRoleServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { claimGuestBookings } from '@/lib/services/guest';

export const runtime = 'edge';

/**
 * POST /api/v1/account/claim-guest-bookings — hand the signed-in account the PAID guest bookings made
 * with its confirmed address. AuthProvider calls it on every sign-in, next to the quote claim. It takes
 * no input: the address comes from the account itself, and the proof is that it is confirmed.
 */
export const POST = apiHandler(async (req) => {
  const user = await requireAccount(req);
  await rateLimit(req, 'account:claim', 10);
  const claimed = await claimGuestBookings(serviceRoleServiceContext(), user.id);
  return jsonOk({ claimed });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
