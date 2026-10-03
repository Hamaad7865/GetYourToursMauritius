import { describe, expect, it, vi } from 'vitest';

/* Page-two pushes (Search Console, 30 Aug – 26 Sep 2026): pages ranking #11–26 for real demand
 * ("ile maurice en decembre", "grand bassin mauritius", "ile aux cerfs", "blue bay mauritius") get
 * links from stronger pages and French titles that carry the phrase French searchers type. Every
 * hand-listed slug here must point at a page that exists — a typo would ship a dead link silently. */

vi.mock('@/lib/http/context', () => ({ publicServiceContext: vi.fn(() => ({})) }));
vi.mock('@/lib/services/seo', () => ({
  listDbPosts: vi.fn(async () => []),
  getDbPost: vi.fn(async () => null),
}));

import { posts, POST_META_FR, POST_META_OVERRIDES, RELATED_POSTS } from '@/lib/content/blog';
import { loadRelatedPosts } from '@/lib/content/blog-live';
import { ATTRACTION_LINKS } from '@/lib/content/attractions';
import { areas } from '@/lib/content/areas';

const postSlugs = new Set(posts.map((p) => p.slug));
const areaSlugs = new Set(areas.map((a) => a.slug));

describe('hand-listed link targets exist', () => {
  it('RELATED_POSTS names only real posts, never the post itself', () => {
    for (const [slug, picks] of Object.entries(RELATED_POSTS)) {
      expect(postSlugs.has(slug), slug).toBe(true);
      for (const pick of picks) {
        expect(postSlugs.has(pick), `${slug} -> ${pick}`).toBe(true);
        expect(pick).not.toBe(slug);
      }
    }
  });

  it('ATTRACTION_LINKS points at real guides and real areas', () => {
    for (const [id, { guide, area, catamaran }] of Object.entries(ATTRACTION_LINKS)) {
      expect(guide || area || catamaran, id).toBeTruthy();
      if (guide) expect(postSlugs.has(guide), `${id} guide ${guide}`).toBe(true);
      if (area) expect(areaSlugs.has(area), `${id} area ${area}`).toBe(true);
    }
  });

  it('POST_META_FR only covers real posts', () => {
    for (const slug of Object.keys(POST_META_FR)) expect(postSlugs.has(slug), slug).toBe(true);
  });
});

describe('French search titles', () => {
  it('say "île Maurice" — the phrase French searchers type', () => {
    for (const [slug, meta] of Object.entries(POST_META_FR)) {
      expect(meta.metaTitle, slug).toMatch(/[îÎ]le Maurice/);
      if (meta.metaDescription) expect(meta.metaDescription.length).toBeLessThanOrEqual(160);
    }
  });

  it('retitle the December post in both languages', () => {
    expect(POST_META_OVERRIDES['mauritius-in-december']?.metaTitle).toMatch(
      /^Mauritius in December/,
    );
    expect(POST_META_FR['mauritius-in-december']?.metaTitle).toMatch(/^Île Maurice en décembre/);
  });
});

describe('loadRelatedPosts', () => {
  it('leads with the hand-picked posts, in order', async () => {
    const related = await loadRelatedPosts('best-time-to-visit-mauritius', 3);
    expect(related.map((p) => p.slug)).toEqual(RELATED_POSTS['best-time-to-visit-mauritius']);
  });

  it('falls back to the newest posts for a post with no picks', async () => {
    const unlisted = posts.find((p) => !RELATED_POSTS[p.slug])!;
    const related = await loadRelatedPosts(unlisted.slug, 3);
    expect(related).toHaveLength(3);
    expect(related.map((p) => p.slug)).not.toContain(unlisted.slug);
  });

  it('never repeats a post when the picks run short of n', async () => {
    const related = await loadRelatedPosts('grand-bassin-guide', 5);
    expect(new Set(related.map((p) => p.slug)).size).toBe(related.length);
    expect(related.slice(0, 3).map((p) => p.slug)).toEqual(RELATED_POSTS['grand-bassin-guide']);
  });
});
