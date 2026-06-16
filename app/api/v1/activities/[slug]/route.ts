import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getActivity } from '@/lib/services/activities';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ slug: string }> };

/** GET /api/v1/activities/:slug — full activity detail (404 if not found / not published). */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  const user = await authenticateOptional(req);
  const { slug } = await params;
  const ctx = buildServiceContext(req);
  const activity = await getActivity(ctx, slug);
  // Edge-cache anonymous reads only (see /activities): never cache a staff response that may
  // include unpublished detail.
  const headers = user
    ? undefined
    : { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' };
  return jsonOk(activity, { headers });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
