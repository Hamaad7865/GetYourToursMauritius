import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { reviewSchema, type Review } from '@/lib/validation/tours';
import { myReviewSchema, type MyReview, type ReviewInput, type SubmitGuestReviewInput, submitGuestReviewInputSchema } from '@/lib/validation/reviews';

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

const submitResultSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  submittedAt: z.string(),
});
export type SubmitGuestReviewResult = z.infer<typeof submitResultSchema>;

/** Submit a review via a one-time invite token — no login required (guest bookings included). */
export async function submitGuestReview(
  ctx: ServiceContext,
  input: SubmitGuestReviewInput,
): Promise<SubmitGuestReviewResult> {
  const data = await callRpc(ctx, 'api_submit_guest_review', input);
  return submitResultSchema.parse(data);
}

/**
 * Note: there is deliberately NO `moderateGuestReview` wrapper here. Moderation is staff-only and
 * happens from the admin screen, a 'use client' React component with no `Request`/service-role
 * credentials to build a ServiceContext from — like every other admin screen in this codebase
 * (AdminLeads, vehicle-pricing), it calls the RPC directly through the browser Supabase client under
 * RLS (see Task 12). Adding an unused server-side wrapper here would be dead code.
 */

/** Service-role sweep: enqueue review-request invites for trips that ended before the eligibility
 *  boundary. Returns the number of invites created. Called by the maintenance cron. */
export async function enqueueReviewInvites(ctx: ServiceContext): Promise<number> {
  const data = await callRpc(ctx, 'api_enqueue_review_invites', {});
  return z.number().int().parse(data);
}
