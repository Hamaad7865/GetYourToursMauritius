import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { wishlistInputSchema } from '@/lib/validation/wishlist';
import { addToWishlist, listWishlist } from '@/lib/services/wishlist';

export const runtime = 'edge';

/** GET /api/v1/wishlist — the signed-in user's saved activities as full TourSummary cards, newest
 *  first. Owner-scoped; private (never cached). 401 for an anonymous caller. */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const ctx = buildServiceContext(req);
  const items = await listWishlist(ctx);
  return jsonOk(items);
});

/** POST /api/v1/wishlist — save an activity by slug (idempotent). 201 when newly saved, 200 if it was
 *  already saved; 404 when no published activity has that slug. */
export const POST = apiHandler(async (req) => {
  await requireUser(req);
  const { slug } = await parseJsonBody(req, wishlistInputSchema);
  const ctx = buildServiceContext(req);
  const result = await addToWishlist(ctx, slug);
  return jsonOk({ slug: result.slug, saved: result.saved }, { status: result.created ? 201 : 200 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
