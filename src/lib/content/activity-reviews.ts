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
 * The rating a listing card / detail page shows for an activity that has no reviews of its own:
 * the aggregate of the reviews it actually draws from. Returns the activity's REAL rating whenever
 * it has one. Never feeds structured data — `productJsonLd` reads the raw DB rating, so the
 * schema.org aggregateRating stays honest (see src/lib/seo/jsonld.ts).
 */
export function activityRating(
  activity: Pick<TourSummary, 'category' | 'ratingAvg' | 'ratingCount'> & { title?: string },
): { avg: number; count: number } {
  if (activity.ratingCount > 0 && activity.ratingAvg != null) {
    return { avg: activity.ratingAvg, count: activity.ratingCount };
  }
  return TOPIC_STATS[topicFor(activity)];
}
