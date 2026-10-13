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
import {
  ATTRACTION_TOURS,
  DEFAULT_POST_TOURS,
  POST_HUBS,
  POST_TOURS,
  toursForPost,
} from '@/lib/content/tour-links';
import { ADDITIONAL_ATTRACTIONS_RAW } from '@/lib/content/_additional-attractions.gen';

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

  it('fills a post with no picks from the posts that follow it', async () => {
    const unlisted = posts.find((p) => !RELATED_POSTS[p.slug])!;
    const related = await loadRelatedPosts(unlisted.slug, 3);
    expect(related).toHaveLength(3);
    expect(related.map((p) => p.slug)).not.toContain(unlisted.slug);
  });

  // The fill used to be "the newest three" for everyone: 36 articles all linked the same post, four
  // days old, which then outranked the page it was written to support.
  it('does not hand every unpicked post the same three links', async () => {
    const unlisted = posts.filter((p) => !RELATED_POSTS[p.slug]);
    expect(unlisted.length).toBeGreaterThan(10);
    const counts = new Map<string, number>();
    for (const p of unlisted) {
      for (const r of await loadRelatedPosts(p.slug, 3)) {
        counts.set(r.slug, (counts.get(r.slug) ?? 0) + 1);
      }
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(6);
    expect(counts.size).toBeGreaterThan(unlisted.length / 2);
  });
});

/* Guide pages → tours (src/lib/content/tour-links.ts). Tour slugs are catalogue data and cannot be
 * checked here — the page drops any slug that is not published. What CAN go wrong at build time is
 * a mistyped attraction id or post slug, which would silently attach the cards to nothing. */
describe('tour links from guide pages', () => {
  const slugShape = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  it('ATTRACTION_TOURS lists one to four well-formed, distinct tour slugs per attraction', () => {
    for (const [id, tours] of Object.entries(ATTRACTION_TOURS)) {
      expect(id, id).toMatch(slugShape);
      expect(tours.length, id).toBeGreaterThan(0);
      expect(tours.length, id).toBeLessThanOrEqual(4);
      expect(new Set(tours).size, id).toBe(tours.length);
      for (const slug of tours) expect(slug, `${id} -> ${slug}`).toMatch(slugShape);
    }
  });

  it('every code-authored attraction it names exists', () => {
    // The other attractions live in the planner_places table, which a unit test cannot read; an id
    // that matches neither set would be a typo. These are the database ids as of Oct 2026.
    const databaseIds = new Set([
      'ile-aux-cerfs',
      'grand-river-south-east-waterfall',
      'trou-deau-douce',
      'ile-aux-aigrettes',
      'ilot-gabriel-island',
      'coin-de-mire-island',
      'grand-baie-beach',
      'pereybere-beach',
      'trou-aux-biches-beach',
      'cap-malheureux-church',
      'pamplemousses-botanical-garden',
      'port-louis-central-market',
      'trou-aux-cerfs',
      'chamarel-seven-coloured-earth',
      'chamarel-waterfall',
      'black-river-gorges-viewpoint',
      'black-river-gorges-national-park',
      'tamarind-falls',
      'la-vanille-nature-park',
      'le-morne-brabant',
      'le-morne-beach',
      'ile-aux-benitiers',
      'casela-nature-parks',
    ]);
    const codeIds = new Set(ADDITIONAL_ATTRACTIONS_RAW.map((p) => p.id));
    for (const id of Object.keys(ATTRACTION_TOURS)) {
      expect(databaseIds.has(id) || codeIds.has(id), id).toBe(true);
    }
  });

  it('POST_TOURS and POST_HUBS name only real posts', () => {
    for (const slug of [...Object.keys(POST_TOURS), ...Object.keys(POST_HUBS)]) {
      expect(postSlugs.has(slug), slug).toBe(true);
    }
  });

  it('gives every post some tours, its own or the default three', () => {
    expect(toursForPost('ile-aux-cerfs-guide')).toBe(POST_TOURS['ile-aux-cerfs-guide']);
    expect(toursForPost('is-mauritius-safe')).toBe(DEFAULT_POST_TOURS);
    expect(DEFAULT_POST_TOURS).toHaveLength(3);
  });

  // The seaplane page is the top-earning tour page and had no link from the content that describes
  // what it flies over. These three are the pages that content lives on.
  it('links the seaplane from the Le Morne and waterfall content', () => {
    expect(ATTRACTION_TOURS['le-morne-brabant']).toContain('seaplane');
    expect(POST_TOURS['hiking-le-morne']).toContain('seaplane');
    expect(POST_TOURS['best-waterfalls-in-mauritius']).toContain('seaplane');
  });

  it('sends the catamaran guide to the catamaran page with words a searcher types', () => {
    const hub = POST_HUBS['catamaran-cruises-mauritius']!;
    expect(hub.href).toBe('/mauritius-catamaran-cruise');
    expect(hub.label.en).toMatch(/catamaran cruises in mauritius/i);
    expect(hub.label.fr).toMatch(/catamaran/i);
  });

  it('never repeats a post when the picks run short of n', async () => {
    const related = await loadRelatedPosts('grand-bassin-guide', 5);
    expect(new Set(related.map((p) => p.slug)).size).toBe(related.length);
    expect(related.slice(0, 3).map((p) => p.slug)).toEqual(RELATED_POSTS['grand-bassin-guide']);
  });
});
