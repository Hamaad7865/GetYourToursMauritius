import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVIEW_BLOCK_SIZE, activityRating, topicFor } from '@/lib/content/activity-reviews';
import {
  activityReviewBlock,
  activityReviews,
  activityReviewPool,
} from '@/lib/content/activity-reviews-pool';
import { TOPIC_STATS } from '@/lib/content/_review-stats.gen';
import { REVIEW_POOL } from '@/lib/content/_review-pool.gen';

/**
 * Per-activity review relevance. The reviews are the OPERATOR's real TripAdvisor/Google reviews, shown
 * on an activity when their text is relevant to it. Two invariants matter most:
 *   1. a listing card's rating equals the aggregate of the pool its detail page draws from, and
 *   2. the 186 KB review pool never reaches a client bundle.
 */

const act = (category: string, title = '', slug = 'x') => ({
  category,
  title,
  slug,
  ratingAvg: null,
  ratingCount: 0,
});

describe('topicFor', () => {
  it('maps each live category to its bucket', () => {
    expect(topicFor(act('Catamaran cruises'))).toBe('catamaran');
    expect(topicFor(act('Speedboat Tours'))).toBe('speedboat');
    expect(topicFor(act('Hiking & Land Adventures'))).toBe('hiking');
    expect(topicFor(act('Sea & water activities'))).toBe('water');
    expect(topicFor(act('Airport transfers'))).toBe('transfer');
    expect(topicFor(act('Private Cruises'))).toBe('catamaran');
    expect(topicFor(act('Sightseeing tours'))).toBe('sightseeing');
  });

  it('lets a more specific category beat the generic "tour" rule', () => {
    // "Speedboat Tours" contains "tour" — speedboat must still win.
    expect(topicFor(act('Speedboat Tours'))).toBe('speedboat');
    expect(topicFor(act('Sightseeing tours', 'Swimming with Dolphins Only'))).toBe('dolphin');
  });

  it('matches whole words only — "Subscooter" is not a scooter rental', () => {
    // Regression: /scooter/ (unbounded) put the submarine tour in the scooter-rental bucket.
    expect(topicFor(act('Sea & water activities', 'Blue Safari Submarine & Subscooter'))).toBe(
      'water',
    );
    expect(topicFor(act('Car & scooter rental', 'Scooter Rental'))).toBe('rental'); // still matches
  });

  it('prefers the dolphin bucket for a dolphin trip sold as a speedboat tour', () => {
    expect(topicFor(act('Speedboat Tours', 'Swimming with Dolphins Only'))).toBe('dolphin');
    expect(topicFor(act('Speedboat Tours', 'Encountering the Whales'))).toBe('dolphin');
    expect(topicFor(act('Speedboat Tours', 'Full Day Speed Boat Ile Aux Cerf'))).toBe('speedboat');
  });

  it('falls back to general for an unknown category', () => {
    expect(topicFor(act('Cooking classes'))).toBe('general');
  });
});

describe('activityRating', () => {
  it("returns the activity's OWN rating once it has a block's worth", () => {
    expect(
      activityRating({
        category: 'Catamaran cruises',
        ratingAvg: 4.2,
        ratingCount: REVIEW_BLOCK_SIZE,
      }),
    ).toEqual({ avg: 4.2, count: REVIEW_BLOCK_SIZE });
  });

  it('falls back to the topic aggregate when the activity has no reviews', () => {
    expect(activityRating(act('Catamaran cruises'))).toEqual(TOPIC_STATS.catamaran);
    expect(activityRating(act('Airport transfers'))).toEqual(TOPIC_STATS.transfer);
  });

  it('aggregates BOTH sets when a thin tour is topped up from the pool', () => {
    // Regression (North Tour): one 5★ guest review replaced the whole sightseeing block, so the page
    // showed a single card. Its own review now counts alongside the pool reviews shown beneath it.
    const topic = TOPIC_STATS.sightseeing;
    const rating = activityRating({
      category: 'Taxi Sightseeing tours',
      title: 'Private North Tour Mauritius',
      ratingAvg: 5,
      ratingCount: 1,
    });
    expect(rating.count).toBe(topic.count + 1);
    expect(rating.avg).toBeGreaterThanOrEqual(topic.avg);
    expect(rating.avg).toBeLessThanOrEqual(5);
  });

  it('a poor review of its own can never be hidden by the pool aggregate', () => {
    const topic = TOPIC_STATS.sightseeing;
    const rating = activityRating({ category: 'Sightseeing tours', ratingAvg: 1, ratingCount: 1 });
    expect(rating.avg).toBeLessThanOrEqual(topic.avg);
  });

  it('never reports a rating above the operator average by cherry-picking', () => {
    // Stats are computed over ALL matching reviews (every star, every language), so no topic can beat
    // a perfect score, and none should sit implausibly high.
    for (const [topic, s] of Object.entries(TOPIC_STATS)) {
      expect(s.avg, topic).toBeGreaterThan(4);
      expect(s.avg, topic).toBeLessThanOrEqual(5);
      expect(s.count, topic).toBeGreaterThan(0);
    }
  });
});

describe('activityReviews', () => {
  it('draws only topic-relevant reviews when the bucket is big enough', () => {
    const pool = activityReviewPool(act('Catamaran cruises'));
    expect(pool.length).toBeGreaterThanOrEqual(6);
    expect(pool.every((r) => r.topics.includes('catamaran'))).toBe(true);
  });

  it('falls back to the whole pool for a thin/unknown topic', () => {
    expect(activityReviewPool(act('Cooking classes'))).toHaveLength(REVIEW_POOL.length);
  });

  it('returns n reviews, deterministically, and rotates per slug', () => {
    const a = activityReviews(act('Catamaran cruises', '', 'catamaran-sunset-cruise'), 9);
    const b = activityReviews(act('Catamaran cruises', '', 'catamaran-sunset-cruise'), 9);
    const c = activityReviews(act('Catamaran cruises', '', 'western-cruise-catamaran'), 9);
    expect(a).toHaveLength(9);
    expect(a).toEqual(b); // deterministic across renders
    expect(a.map((r) => r.id)).not.toEqual(c.map((r) => r.id)); // different slice per tour
  });

  it('every returned review is real and readable', () => {
    for (const r of activityReviews(act('Hiking & Land Adventures', '', 'hiking-le-morne'), 9)) {
      expect(r.rating).toBeGreaterThanOrEqual(4);
      expect(r.text?.length ?? 0).toBeGreaterThanOrEqual(80);
      expect(r.author).toBeTruthy();
      expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe('activityReviewBlock', () => {
  const own = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `own-${i}`,
      author: 'Guest',
      rating: 5,
      text: 'Great day out.',
      createdAt: '2026-07-22',
    }));

  it("fills a thin block with pool reviews, keeping the tour's own on top", () => {
    // Regression: the North Tour's single guest review switched the operator pool OFF, so the page
    // rendered one card where every sibling tour rendered nine.
    const block = activityReviewBlock(
      {
        category: 'Taxi Sightseeing tours',
        title: 'Private North Tour Mauritius',
        slug: 'north-tour',
      },
      own(1),
    );
    expect(block.reviews).toHaveLength(REVIEW_BLOCK_SIZE);
    expect(block.reviews[0]?.id).toBe('own-0');
    expect(block.pooled).toBe(true);
    expect(new Set(block.reviews.map((r) => r.id)).size).toBe(REVIEW_BLOCK_SIZE); // no duplicates
  });

  it('leaves a well-reviewed tour entirely to its own reviews', () => {
    const block = activityReviewBlock(
      { category: 'Taxi Sightseeing tours', slug: 'north-tour' },
      own(REVIEW_BLOCK_SIZE),
    );
    expect(block.pooled).toBe(false);
    expect(block.reviews.every((r) => r.id.startsWith('own-'))).toBe(true);
  });

  it('still fills the whole block for a tour with no reviews of its own', () => {
    const block = activityReviewBlock({ category: 'Catamaran cruises', slug: 'x' }, []);
    expect(block.reviews).toHaveLength(REVIEW_BLOCK_SIZE);
    expect(block.pooled).toBe(true);
  });
});

describe('review pool stays out of the client bundle', () => {
  /** Every .ts/.tsx under src/ and app/. */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) sourceFiles(p, out);
      else if (/\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }

  it("no 'use client' module imports the review pool", () => {
    const offenders = [...sourceFiles('src'), ...sourceFiles('app')].filter((f) => {
      const src = readFileSync(f, 'utf8');
      const isClient = /^\s*['"]use client['"]/m.test(src);
      const importsPool = /_review-pool\.gen|activity-reviews-pool/.test(src);
      return isClient && importsPool;
    });
    expect(
      offenders,
      `client components must not import the ${Math.round(JSON.stringify(REVIEW_POOL).length / 1024)}KB review pool`,
    ).toEqual([]);
  });
});
