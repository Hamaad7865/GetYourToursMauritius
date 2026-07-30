import type { TourSummary } from '@/lib/validation/tours';
import { TOPIC_STATS } from './_review-stats.gen';
import type { ReviewTopic } from './review-topics';

/**
 * Relevance mapping from an ACTIVITY to a review topic, plus the rating that topic carries.
 *
 * CLIENT-SAFE: this module imports only `_review-stats.gen` (≈1 KB). The 186 KB review pool lives in
 * `activity-reviews-pool.ts`, which must only ever be imported from a server component.
 *
 * The reviews are Belle Mare Tours' own TripAdvisor/Google reviews — of the OPERATOR, not of any one
 * tour. We show a guest's catamaran review on catamaran tours because it's relevant, and the page
 * labels the block accordingly. The rating is the honest aggregate over EVERY scraped review that
 * mentions the topic (all stars, all languages), so it never flatters by dropping the bad ones.
 */

/**
 * Which review topic an activity draws from. First match wins, so order is significant: the specific
 * rules run before the generic `tour` → sightseeing catch-all, and a dolphin trip prefers dolphin
 * reviews over the speedboat it happens to be booked on.
 *
 * Every token is word-bounded — without `\b`, "Blue Safari Submarine & Sub*scooter*" matches `scooter`
 * and a submarine tour ends up showing scooter-rental reviews.
 */
export function topicFor(activity: { category: string; title?: string }): ReviewTopic {
  const s = `${activity.category} ${activity.title ?? ''}`.toLowerCase();
  if (/\btransfers?\b|\bairport\b/.test(s)) return 'transfer';
  if (/\bcatamarans?\b|\bprivate cruise/.test(s)) return 'catamaran';
  if (/\bdolphins?\b|\bwhales?\b/.test(s)) return 'dolphin';
  if (/\bspeed ?boats?\b/.test(s)) return 'speedboat';
  if (/\bhiking\b|\bhikes?\b|\bland adventure|\btrek/.test(s)) return 'hiking';
  if (/\bscooters?\b|\brentals?\b|\brent\b|\bcar hire\b|\bquad\b/.test(s)) return 'rental';
  if (/\bhelicopters?\b|\bparasail|\bskydive\b|\bseaplane\b|\bair activit/.test(s)) return 'air';
  if (
    /\bsea\b|\bwater\b|\bdiving\b|\bscuba\b|\bfishing\b|\bkayak\b|\bsubmarine\b|\bsnorkel/.test(s)
  ) {
    return 'water';
  }
  if (/\bsightseeing\b|\btours?\b|\bexcursion/.test(s)) return 'sightseeing';
  return 'general';
}

/**
 * How many reviews an activity's detail page shows. A tour with FEWER of its own is topped up from
 * the operator pool rather than left standing alone — a single review must never switch the
 * operator's social proof off. (The North Tour did exactly that: its one real guest review replaced
 * the 554-review sightseeing block, so the page read as "no reviews".)
 */
export const REVIEW_BLOCK_SIZE = 9;

/**
 * The rating a listing card / detail page shows: the aggregate of the reviews it actually draws
 * from, which is the invariant that keeps a card's rating equal to its detail page's block.
 *
 *   - `REVIEW_BLOCK_SIZE`+ of its own  → its own rating alone, untouched.
 *   - a thin handful of its own        → its own AND the topic's, because the page shows both.
 *   - none of its own                  → the topic aggregate.
 *
 * Never feeds structured data — `productJsonLd` reads the raw DB rating, so the schema.org
 * aggregateRating always describes this product alone (see src/lib/seo/jsonld.ts).
 */
export function activityRating(
  activity: Pick<TourSummary, 'category' | 'ratingAvg' | 'ratingCount'> & { title?: string },
): { avg: number; count: number } {
  const topic = TOPIC_STATS[topicFor(activity)];
  const ownAvg = activity.ratingAvg;
  const ownCount = activity.ratingCount;
  if (ownAvg == null || ownCount <= 0) return topic;
  if (ownCount >= REVIEW_BLOCK_SIZE) return { avg: ownAvg, count: ownCount };
  // Weighted over both sets — the blend can only move the headline toward the truth, never above it.
  const count = ownCount + topic.count;
  const avg = (ownAvg * ownCount + topic.avg * topic.count) / count;
  return { avg: Math.round(avg * 10) / 10, count };
}
