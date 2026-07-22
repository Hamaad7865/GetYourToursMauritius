import { reviewStats as seedStats, featuredReviews as seedReviews } from './reviews';
import type { ReviewStats, FeaturedReview } from './reviews';
import { publicServiceContext } from '@/lib/http/context';
import { callRpc } from '@/lib/services/rpc';

/**
 * Live review stats: the scraped TripAdvisor/Google pool (`_reviews.gen.ts`) merged with APPROVED
 * guest_reviews rows, recomputed on every request — mirrors blog-live.ts's DB-over-seed pattern. On
 * any DB error the scraped stats still render (the page can never go down with the database).
 */

export interface DbApprovedReview {
  rating: number;
  body: string;
  customerName: string;
  submittedAt: string;
}

/** Pure — no I/O. Recomputes the combined average/histogram from the scraped seed + approved DB
 *  rows. Exported for unit testing; the async loader below is the only I/O boundary. */
export function mergeReviewStats(seed: ReviewStats, db: DbApprovedReview[]): ReviewStats {
  if (db.length === 0) return seed;
  const combinedCount = seed.total + db.length;
  const scrapedSum = seed.average * seed.total;
  const dbSum = db.reduce((s, r) => s + r.rating, 0);
  const histogram = { ...seed.histogram };
  for (const r of db) {
    const key = String(r.rating);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  return {
    ...seed,
    total: combinedCount,
    average: Math.round(((scrapedSum + dbSum) / combinedCount) * 10) / 10,
    histogram,
  };
}

/** Pure — no I/O. Newest DB reviews first, then the scraped pool. Exported for unit testing. */
export function mergeFeaturedReviews(
  seed: FeaturedReview[],
  db: DbApprovedReview[],
): FeaturedReview[] {
  const mapped: FeaturedReview[] = db.map((r, i) => ({
    id: `guest-${i}`,
    source: 'site',
    rating: r.rating,
    title: null,
    text: r.body,
    author: r.customerName,
    authorLocation: null,
    date: r.submittedAt.slice(0, 10),
    url: null,
  }));
  return [...mapped, ...seed];
}

async function loadApprovedGuestReviews(): Promise<DbApprovedReview[]> {
  const data = await callRpc(publicServiceContext(), 'api_list_approved_guest_reviews', {});
  return Array.isArray(data) ? (data as DbApprovedReview[]) : [];
}

export async function loadReviewStats(): Promise<ReviewStats> {
  try {
    return mergeReviewStats(seedStats, await loadApprovedGuestReviews());
  } catch {
    return seedStats;
  }
}

export async function loadFeaturedReviews(): Promise<FeaturedReview[]> {
  try {
    return mergeFeaturedReviews(seedReviews, await loadApprovedGuestReviews());
  } catch {
    return seedReviews;
  }
}
