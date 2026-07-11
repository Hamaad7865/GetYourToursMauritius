import { z } from 'zod';

/** POST /wishlist body — the activity slug to save. `.strict()` rejects unknown keys. */
export const wishlistInputSchema = z.object({ slug: z.string().trim().min(1).max(120) }).strict();
export type WishlistInput = z.infer<typeof wishlistInputSchema>;

/** POST /wishlist response data. `saved` is always true on success; the 201-vs-200 status conveys
 *  whether it was newly added or already present. */
export const wishlistAddResultSchema = z.object({
  slug: z.string(),
  saved: z.literal(true),
});
export type WishlistAddResult = z.infer<typeof wishlistAddResultSchema>;

/** DELETE /wishlist/{slug} response data — always saved:false (idempotent remove). */
export const wishlistRemoveResultSchema = z.object({
  slug: z.string(),
  saved: z.literal(false),
});
export type WishlistRemoveResult = z.infer<typeof wishlistRemoveResultSchema>;
