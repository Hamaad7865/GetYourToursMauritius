import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { removeFromWishlist } from '@/lib/services/wishlist';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ slug: string }> };

/** DELETE /api/v1/wishlist/{slug} — remove a saved activity (idempotent: 200 with saved:false even if
 *  it wasn't saved). Owner-scoped; 401 for an anonymous caller. */
export const DELETE = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { slug } = await params;
  const ctx = buildServiceContext(req);
  const result = await removeFromWishlist(ctx, slug);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
