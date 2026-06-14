import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getServerEnv } from '@/lib/config/env';
import { createPaymentInputSchema } from '@/lib/validation/booking';
import { createPaymentLink } from '@/lib/services/payments';

export const runtime = 'edge';

/**
 * POST /api/v1/payments — create a payment + hosted-checkout link for a booking.
 * Requires the booking owner (the public ref is NOT a bearer credential); guest
 * self-service checkout via an emailed token lands in Phase 4. The return URL is
 * derived server-side (no client redirect); the amount comes only from the DB.
 */
export const POST = apiHandler(async (req) => {
  await requireUser(req);
  const input = await parseJsonBody(req, createPaymentInputSchema);
  const ctx = buildServiceContext(req);
  const returnUrl = `${getServerEnv().NEXT_PUBLIC_SITE_URL}/bookings/${input.bookingRef}`;
  const link = await createPaymentLink(ctx, {
    bookingRef: input.bookingRef,
    returnUrl,
    idempotencyKey: input.idempotencyKey,
  });
  return jsonOk(link, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
