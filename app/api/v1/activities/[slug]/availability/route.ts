import { apiHandler, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { availabilityQuerySchema } from '@/lib/validation/tours';
import { checkAvailability } from '@/lib/services/availability';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ slug: string }> };

/** GET /api/v1/activities/:slug/availability — bookable occurrences with live seats_left. */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await authenticateOptional(req);
  const { slug } = await params;
  const query = parseQuery(req, availabilityQuerySchema);
  const ctx = buildServiceContext(req);
  const slots = await checkAvailability(ctx, { slug, from: query.from, to: query.to });
  return jsonOk(slots);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
