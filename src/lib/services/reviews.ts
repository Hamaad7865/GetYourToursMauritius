import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { reviewSchema, type Review } from '@/lib/validation/tours';
import { myReviewSchema, type MyReview, type ReviewInput } from '@/lib/validation/reviews';

/** Submit (or update) the caller's review for an activity. Booking-gated + rating recompute happen in
 *  api_submit_review: 404 unknown slug, 403 when the caller has no confirmed/completed booking. */
export async function submitReview(
  ctx: ServiceContext,
  slug: string,
  input: ReviewInput,
): Promise<Review> {
  const data = await callRpc(ctx, 'api_submit_review', {
    slug,
    rating: input.rating,
    text: input.text ?? null,
  });
  return reviewSchema.parse(data);
}

const myReviewsSchema = z.object({ items: z.array(myReviewSchema), total: z.number().int() });

/** The caller's own reviews, newest first, paginated. */
export async function listMyReviews(
  ctx: ServiceContext,
  query: { page: number; pageSize: number },
): Promise<{ items: MyReview[]; total: number }> {
  const data = await callRpc(ctx, 'api_my_reviews', { page: query.page, pageSize: query.pageSize });
  return myReviewsSchema.parse(data ?? { items: [], total: 0 });
}
