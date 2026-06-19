import { REVIEW_STATS, FEATURED_REVIEWS } from './_reviews.gen';

/**
 * Curated guest reviews (real TripAdvisor + Google reviews, scraped into
 * data/belle-mare-tours-reviews.json and curated into `_reviews.gen.ts`). Displayed with a
 * source credit link — backs the AggregateRating shown site-wide.
 */

export interface ReviewStats {
  total: number;
  average: number;
  tripadvisor: { rating: number; count: number };
  google: { rating: number; count: number };
  histogram: Record<string, number>;
}

export interface FeaturedReview {
  id: string;
  source: string;
  rating: number;
  title: string | null;
  text: string;
  author: string;
  authorLocation: string | null;
  date: string | null;
  url: string | null;
}

export const reviewStats: ReviewStats = REVIEW_STATS;
export const featuredReviews: FeaturedReview[] = FEATURED_REVIEWS;

export function topReviews(n: number): FeaturedReview[] {
  return FEATURED_REVIEWS.slice(0, n);
}
