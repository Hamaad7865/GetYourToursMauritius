import { z } from 'zod';

/** POST /activities/{slug}/reviews body. `.strict()` rejects unknown keys. */
export const reviewInputSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    text: z.string().trim().max(2000).optional(),
  })
  .strict();
export type ReviewInput = z.infer<typeof reviewInputSchema>;

/** One row in the caller's "My reviews" list. */
export const myReviewSchema = z.object({
  id: z.string(),
  activitySlug: z.string(),
  activityTitle: z.string(),
  rating: z.number().int(),
  text: z.string().nullable(),
  createdAt: z.string(),
});
export type MyReview = z.infer<typeof myReviewSchema>;
