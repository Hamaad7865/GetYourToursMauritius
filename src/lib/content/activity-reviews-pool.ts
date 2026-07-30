import type { Review } from '@/lib/validation/tours';
import { REVIEW_POOL, type PoolReview } from './_review-pool.gen';
import { TOPIC_STATS } from './_review-stats.gen';
import { REVIEW_BLOCK_SIZE, topicFor } from './activity-reviews';

/**
 * SERVER-ONLY review selection. `_review-pool.gen` is ~186 KB, so importing this from a `'use client'`
 * module would ship the whole review corpus to the browser. The card rating lives in the client-safe
 * `activity-reviews.ts` instead, and `tests/unit/review-pool-server-only.test.ts` fails the build if
 * any client component reaches this file.
 *
 * An activity draws the reviews whose text mentions its topic; if that bucket is too thin to fill a
 * block we fall back to the whole pool, so every page shows real social proof.
 */

/** A topic bucket must offer at least this many reviews before we prefer it over the whole pool. */
const MIN_TOPIC_REVIEWS = 6;

/** Stable per-slug rotation so two catamaran tours don't render byte-identical review blocks
 *  (duplicate-content risk) while each stays deterministic across renders/deploys. */
function seedOffset(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return mod > 0 ? h % mod : 0;
}

function toReview(r: PoolReview): Review {
  return {
    id: r.id,
    author: r.author,
    rating: r.rating,
    text: r.text,
    // Guard the rare undated review so the date formatter never sees a non-date string.
    createdAt: r.date ?? '2023-01-01',
  };
}

/** The pool an activity draws from: its topic's reviews, or all of them when that bucket is thin.
 *  Follows the SAME collapse decision the stats generator made (TOPIC_STATS.collapsed) — otherwise a
 *  page's header aggregate and its review texts would come from different sets (the `air` bucket hit
 *  exactly that: stats collapsed to general while the pool stayed topic-only). */
export function activityReviewPool(activity: {
  category: string;
  title?: string;
  slug?: string;
}): PoolReview[] {
  const topic = topicFor(activity);
  if (TOPIC_STATS[topic]?.collapsed) return REVIEW_POOL;
  const matched = REVIEW_POOL.filter((r) => r.topics.includes(topic));
  return matched.length >= MIN_TOPIC_REVIEWS ? matched : REVIEW_POOL;
}

/** `n` topic-relevant reviews for an activity, rotated by its slug. */
export function activityReviews(
  activity: { category: string; title?: string; slug: string },
  n: number,
): Review[] {
  const pool = activityReviewPool(activity);
  if (pool.length <= n) return pool.map(toReview);
  const offset = seedOffset(activity.slug, pool.length);
  return [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, n).map(toReview);
}

/**
 * The review block a detail page renders: the activity's OWN reviews first, then enough
 * topic-relevant operator reviews to fill out the block.
 *
 * Topping up rather than switching (`own.length ? own : pool`) is the point — one guest review used
 * to hide the operator's whole review history, which left the best-reviewed kind of page looking the
 * emptiest. `pooled` tells the caller to label the block as operator-wide.
 */
export function activityReviewBlock(
  activity: { category: string; title?: string; slug: string },
  own: Review[],
): { reviews: Review[]; pooled: boolean } {
  const topUp = REVIEW_BLOCK_SIZE - own.length;
  if (topUp <= 0) return { reviews: own, pooled: false };
  const filler = activityReviews(activity, topUp);
  return { reviews: [...own, ...filler], pooled: filler.length > 0 };
}
