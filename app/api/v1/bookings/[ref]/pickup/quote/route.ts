import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { quotePickupInputSchema } from '@/lib/validation/booking';
import { quotePickupAddon } from '@/lib/services/pickup';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/bookings/:ref/pickup/quote — what the transport supplement would cost for a pickup at
 * these coordinates. Read-only: dragging the map pin must never mint a payment row, which is why this
 * is a separate endpoint from the sibling POST /pickup rather than a dry-run flag on it.
 *
 * Ownership is enforced in SQL (api_quote_pickup_addon checks user_id/is_staff), so a stranger with a
 * ref gets a 403 rather than a price. Rate-limited because it is the one endpoint a signed-in user can
 * call in a loop with client-chosen input.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  await rateLimit(req, 'bookings:pickup-quote', 60);
  const { ref } = await params;
  const input = await parseJsonBody(req, quotePickupInputSchema);
  const ctx = buildServiceContext(req);
  return jsonOk(await quotePickupAddon(ctx, ref, input));
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
