import { describe, expect, it } from 'vitest';
import {
  mergeReviewStats,
  mergeFeaturedReviews,
  type DbApprovedReview,
} from '@/lib/content/guest-reviews-live';
import type { ReviewStats, FeaturedReview } from '@/lib/content/reviews';

const SEED_STATS: ReviewStats = {
  total: 100,
  average: 4.8,
  tripadvisor: { rating: 4.8, count: 60 },
  google: { rating: 4.7, count: 40 },
  histogram: { '5': 80, '4': 15, '3': 5 },
};

describe('mergeReviewStats', () => {
  it('returns the seed unchanged when there are no approved DB reviews', () => {
    expect(mergeReviewStats(SEED_STATS, [])).toEqual(SEED_STATS);
  });

  it('folds DB reviews into the total, average and histogram', () => {
    const db: DbApprovedReview[] = [
      { rating: 5, body: 'Great!', customerName: 'A', submittedAt: '2026-07-20T00:00:00Z' },
      { rating: 3, body: 'Okay', customerName: 'B', submittedAt: '2026-07-21T00:00:00Z' },
    ];
    const merged = mergeReviewStats(SEED_STATS, db);
    expect(merged.total).toBe(102);
    expect(merged.histogram['5']).toBe(81);
    expect(merged.histogram['3']).toBe(6);
    // (100*4.8 + 5 + 3) / 102 = 4.784.. → rounded to 1dp
    expect(merged.average).toBe(4.8);
  });
});

describe('mergeFeaturedReviews', () => {
  it('puts DB reviews first, newest given order preserved, then the seed pool', () => {
    const seed: FeaturedReview[] = [
      {
        id: 's1',
        source: 'tripadvisor',
        rating: 5,
        title: null,
        text: 'Seed review',
        author: 'Seed Author',
        authorLocation: null,
        date: '2026-01-01',
        url: null,
      },
    ];
    const db: DbApprovedReview[] = [
      {
        rating: 4,
        body: 'Loved it',
        customerName: 'New Guest',
        submittedAt: '2026-07-22T00:00:00Z',
      },
    ];
    const merged = mergeFeaturedReviews(seed, db);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.author).toBe('New Guest');
    expect(merged[0]!.source).toBe('site');
    expect(merged[1]!.author).toBe('Seed Author');
  });
});
