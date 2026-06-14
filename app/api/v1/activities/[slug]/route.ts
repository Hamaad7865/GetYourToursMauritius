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
  await authenticateOptional(req);
  const { slug } = await params;
  const ctx = buildServiceContext(req);
  const activity = await getActivity(ctx, slug);
  return jsonOk(activity);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
