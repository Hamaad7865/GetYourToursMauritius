import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { ConfigError } from '@/lib/services/errors';
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
  const env = getServerEnv();

  // FAIL CLOSED (money path): NEXT_PUBLIC_SITE_URL defaults to localhost, so a deploy that forgets to
  // set it would send the customer a localhost return URL and a localhost Origin to Peach (which may
  // reject on the mismatch). Refuse to create the checkout instead of silently breaking payment.
  if (!isSiteUrlConfiguredForLive(env)) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime. It builds the Peach return URL + Origin (and every canonical/OG ' +
        'link); refusing to create a checkout that would redirect the customer to localhost. Set ' +
        'NEXT_PUBLIC_SITE_URL to the real production https origin.',
      { code: 'site_url_not_configured' },
    );
  }

  const returnUrl = `${env.NEXT_PUBLIC_SITE_URL}/bookings/${input.bookingRef}`;
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
