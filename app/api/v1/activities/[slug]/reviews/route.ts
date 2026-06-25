import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { reviewInputSchema } from '@/lib/validation/reviews';
import { submitReview } from '@/lib/services/reviews';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ slug: string }> };

/** POST /api/v1/activities/{slug}/reviews — submit/update the caller's review (auth, booking-gated).
 *  404 unknown activity, 403 without a confirmed/completed booking for it. Recomputes the rating. */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { slug } = await params;
  const input = await parseJsonBody(req, reviewInputSchema);
  const ctx = buildServiceContext(req);
  const review = await submitReview(ctx, slug, input);
  return jsonOk(review, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
