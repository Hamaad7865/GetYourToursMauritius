import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getBookingStatus } from '@/lib/services/bookings';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/** GET /api/v1/bookings/:ref — booking status (RLS-gated to the owner or staff). */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { ref } = await params;
  const ctx = buildServiceContext(req);
  const booking = await getBookingStatus(ctx, ref);
  return jsonOk(booking);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
