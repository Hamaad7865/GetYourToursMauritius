import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { tourSummarySchema, type TourSummary } from '@/lib/validation/tours';

/** api_add_wishlist also returns `created` (internal): true when newly inserted, false when it was
 *  already saved. The route uses it to pick 201 vs 200; it is not part of the public response body. */
const addResultSchema = z.object({
  slug: z.string(),
  saved: z.literal(true),
  created: z.boolean(),
});
export type AddWishlistResult = z.infer<typeof addResultSchema>;

const removeResultSchema = z.object({ slug: z.string(), saved: z.literal(false) });

/** The caller's saved activities as full TourSummary cards (same shape as /activities), newest first. */
export async function listWishlist(ctx: ServiceContext): Promise<TourSummary[]> {
  const data = await callRpc(ctx, 'api_my_wishlist', {});
  return z.array(tourSummarySchema).parse(data ?? []);
}

/** Save an activity by slug (idempotent). 404 (NotFoundError) when no published activity has that slug. */
export async function addToWishlist(ctx: ServiceContext, slug: string): Promise<AddWishlistResult> {
  const data = await callRpc(ctx, 'api_add_wishlist', { slug });
  return addResultSchema.parse(data);
}

/** Remove a saved activity by slug (idempotent — succeeds even when it wasn't saved). */
export async function removeFromWishlist(
  ctx: ServiceContext,
  slug: string,
): Promise<{ slug: string; saved: false }> {
  const data = await callRpc(ctx, 'api_remove_wishlist', { slug });
  return removeResultSchema.parse(data);
}
