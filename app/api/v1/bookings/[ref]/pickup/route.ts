import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext, serviceRoleRpcContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { ConfigError } from '@/lib/services/errors';
import { requestPickupInputSchema } from '@/lib/validation/booking';
import { requestPickup } from '@/lib/services/pickup';
import { createPaymentLink } from '@/lib/services/payments';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/bookings/:ref/pickup — the guest who booked "pickup to be arranged" commits to an
 * address.
 *
 * Two outcomes, and the caller must handle both:
 *   applied: true   — nothing was owed, the pickup is already on the booking. No checkout.
 *   applied: false  — a supplement is due; the address is parked until it settles, and the response
 *                     carries the Peach session to pay it.
 *
 * The fee is never taken from the request body — api_request_pickup re-derives it from the
 * coordinates. This route only decides whether a checkout is needed and mints it.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  await rateLimit(req, 'bookings:pickup', 20);
  const { ref } = await params;
  const input = await parseJsonBody(req, requestPickupInputSchema);
  const ctx = buildServiceContext(req);

  const result = await requestPickup(ctx, ref, input);
  if (result.applied) {
    return jsonOk({ ...result, payment: null });
  }

  // Same fail-closed gate as POST /api/v1/payments: a deploy that forgot NEXT_PUBLIC_SITE_URL would
  // hand Peach a localhost return URL and Origin. Refuse rather than break the payment silently.
  const env = getServerEnv();
  if (!isSiteUrlConfiguredForLive(env)) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime; refusing to create a pickup-supplement checkout.',
      { code: 'site_url_not_configured' },
    );
  }

  const payment = await createPaymentLink(
    ctx,
    {
      bookingRef: ref,
      returnUrl: `${env.NEXT_PUBLIC_SITE_URL}/bookings/${ref}`,
      purpose: 'pickup_addon',
    },
    serviceRoleRpcContext(),
  );
  return jsonOk({ ...result, payment }, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
