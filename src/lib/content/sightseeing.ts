import type { Review, TourSummary } from '@/lib/validation/tours';
import { reviewStats, topReviews, featuredReviews, type FeaturedReview } from './reviews';

/**
 * Canonical content shared by EVERY private sightseeing (vehicle) tour, so the whole range presents
 * an identical, premium set of highlights, know-before-you-go notes and social proof regardless of
 * what each tour's admin record happens to carry. The per-tour itinerary + full description still
 * convey the specific places each tour visits — these are the operator promises common to all of
 * them. A "private sightseeing tour" is a vehicle-priced activity (`pricingMode === 'vehicle'`).
 */

/** The selling points every private sightseeing tour shares — rendered instead of the per-tour
 *  highlights so the "Highlights" section reads the same across every sightseeing tour. */
export const SIGHTSEEING_HIGHLIGHTS: string[] = [
  'Private, air-conditioned vehicle with a professional English-speaking driver-guide — exclusively for your group, never shared.',
  'Door-to-door hotel or port pickup and drop-off anywhere in Mauritius, included in the price.',
  'Flexible morning departure — start your day any time between 7:30 and 9:30 am.',
  'A fully flexible route — add, swap or skip stops on the day to match your pace and interests.',
  'Free first child seat and complimentary bottled water on board.',
  'One fixed, all-in price with no hidden fees — pay securely online and get instant confirmation.',
];

/** "Know before you go" notes shown on every private sightseeing tour. The entrance-fee / cash note
 *  is the important one: site, museum and park tickets are NOT part of the tour fare. */
export const SIGHTSEEING_IMPORTANT_INFO: string[] = [
  'Entrance fees to attractions, museums, gardens and nature parks are not included in the tour price. Please carry some cash (Mauritian rupees) to pay these on the day — many sites do not accept cards.',
  'Lunch and personal expenses are not included unless stated; your driver-guide is happy to recommend good local spots and stop wherever you like.',
  'Bring sun protection, comfortable walking shoes and swimwear if your route includes a beach or waterfall stop.',
  'Travel times between stops are approximate and depend on traffic and how long you choose to spend at each place.',
  'Modest dress (shoulders and knees covered) is required to enter temples and other places of worship, such as Grand Bassin.',
];

/** Operator-wide aggregate (real TripAdvisor + Google) used as the social-proof fallback for a
 *  sightseeing tour that has no reviews of its own, so every tour shows a rating. */
export const SIGHTSEEING_FALLBACK_RATING = {
  avg: reviewStats.average,
  count: reviewStats.total,
};

function toReview(r: FeaturedReview): Review {
  return {
    id: r.id,
    author: r.authorLocation ? `${r.author} · ${r.authorLocation}` : r.author,
    rating: r.rating,
    text: r.text,
    // Featured reviews are dated; the fallback only guards the rare null so the date formatter never
    // sees a non-date string.
    createdAt: r.date ?? '2023-01-01',
  };
}

/** Stable per-tour rotation offset so each sightseeing tour shows a DIFFERENT (but deterministic)
 *  slice of the curated pool — avoids byte-identical review blocks across every sightseeing URL. */
function seedOffset(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return mod > 0 ? h % mod : 0;
}

/** Curated operator reviews (real TripAdvisor / Google) in the catalogue `Review` shape, so a
 *  sightseeing tour with no reviews of its own still shows genuine social proof. Pass the tour `seed`
 *  (its slug) to rotate the pool per tour so the blocks aren't identical across sightseeing pages. */
export function sightseeingReviews(n: number, seed?: string): Review[] {
  const pool = featuredReviews;
  if (!seed || pool.length <= n) return topReviews(n).map(toReview);
  const offset = seedOffset(seed, pool.length);
  return [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, n).map(toReview);
}

/** The rating to show on a listing/summary card: the tour's own when it has reviews, otherwise — for
 *  private sightseeing (vehicle) tours only — the operator-wide scraped aggregate (4.8 / 1,076), so
 *  every sightseeing card shows real social proof instead of "— (0)". Returns null for any other
 *  activity with no reviews (the card keeps its own "New activity" / empty state). Mirrors the
 *  detail-page fallback, so the card and the page agree. */
export function effectiveCardRating(
  activity: Pick<TourSummary, 'pricingMode' | 'ratingAvg' | 'ratingCount'>,
): { avg: number; count: number } | null {
  if (activity.ratingCount > 0 && activity.ratingAvg != null) {
    return { avg: activity.ratingAvg, count: activity.ratingCount };
  }
  if (activity.pricingMode === 'vehicle') {
    return { avg: SIGHTSEEING_FALLBACK_RATING.avg, count: SIGHTSEEING_FALLBACK_RATING.count };
  }
  return null;
}
