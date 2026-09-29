import { describe, expect, it } from 'vitest';

/* Search-result copy for the content families. Search Console (30 Aug – 26 Sep 2026) showed these
 * pages ranking at #7–9 with 0.4–0.9% CTR: attraction titles ran to 72 characters on average,
 * descriptions were hard-sliced mid-word at 320, and every French attraction/destination page served
 * its English title. These pin the fixes. */

import { fitSnippet, snippetWithTail, SNIPPET_MAX } from '@/lib/seo/snippet';
import { attractionMetaTitle, attractionMetaDescription } from '@/lib/content/attractions';
import { areas, areaMetaTitle, areaMetaDescription, localisedArea } from '@/lib/content/areas';
import { posts, POST_META_OVERRIDES } from '@/lib/content/blog';
import { BRAND_SUFFIX } from '@/lib/seo/page-registry';
import type { PlannerPlace } from '@/lib/validation/planner';

const place = (over: Partial<PlannerPlace>): PlannerPlace =>
  ({ id: 'x', name: 'Crystal Rock', region: 'West', blurb: '', ...over }) as PlannerPlace;

describe('fitSnippet', () => {
  it('returns short text untouched (whitespace normalised)', () => {
    expect(fitSnippet('  A calm   lagoon.  ')).toBe('A calm lagoon.');
  });

  it('prefers whole sentences that fit the window', () => {
    const s1 = 'Sheltered bay with an emerald lagoon and powder-white beaches on the north coast.';
    const s2 = 'The liveliest resort town on the island, with nightlife and water sports.';
    const s3 = 'It is busy in August, so book boat trips a few days ahead.';
    const out = fitSnippet(`${s1} ${s2} ${s3}`);
    expect(out).toBe(`${s1} ${s2}`);
    expect(out.length).toBeLessThanOrEqual(SNIPPET_MAX);
  });

  it('falls back to whole words plus an ellipsis — never a mid-word cut', () => {
    const long = 'word '.repeat(60).trim();
    const out = fitSnippet(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(out.slice(0, -1).endsWith('word')).toBe(true);
  });

  it('does not treat an abbreviation as a sentence end', () => {
    const text = `Stay near St. Regis for the calmest water on the coast. ${'More detail follows here. '.repeat(8)}`;
    expect(fitSnippet(text).startsWith('Stay near St. Regis for the calmest water')).toBe(true);
    expect(fitSnippet(text)).not.toBe('Stay near St.');
  });

  it('snippetWithTail appends the tail only when both fit whole', () => {
    expect(snippetWithTail('Short lead.', 'Book now.')).toBe('Short lead. Book now.');
    const lead = `${'x'.repeat(140)}.`;
    expect(snippetWithTail(lead, 'A tail that would overflow.')).toBe(lead);
  });

  it('snippetWithTail ends a short first sentence with the tail instead of an ellipsis', () => {
    const first =
      'A quiet public beach on the far north coast, between Cap Malheureux and Grand Gaube.';
    const rest =
      'Its shallow lagoon and steady cross-shore winds make it a known kitesurfing spot.';
    expect(snippetWithTail(`${first} ${rest}`, 'Private tours with hotel pickup.')).toBe(
      `${first} Private tours with hotel pickup.`,
    );
  });
});

describe('attraction meta', () => {
  it('puts the place first and fits the ~60-char window with the brand for a typical name', () => {
    const title = attractionMetaTitle(place({ name: 'Anse La Raie' }));
    expect(title).toBe('Anse La Raie, Mauritius: Visitor Guide');
    expect(`${title}${BRAND_SUFFIX}`.length).toBeLessThanOrEqual(60);
  });

  it('serves French pages a French title', () => {
    expect(attractionMetaTitle(place({ name: 'Anse La Raie' }), 'fr')).toBe(
      'Anse La Raie, île Maurice : guide de visite',
    );
  });

  it('keeps the description inside the snippet window, never mid-word', () => {
    const blurb =
      'Sheltered bay with an emerald lagoon, powder-white beaches, and the liveliest resort town on the island with vibrant nightlife and water sports.';
    const d = attractionMetaDescription(place({ blurb }));
    expect(d.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(d.startsWith(blurb)).toBe(true);
  });

  it('gives an untranslated attraction a French sentence rather than its English blurb', () => {
    const d = attractionMetaDescription(
      place({ id: 'no-french-entry', blurb: 'An English-only blurb.' }),
      'fr',
    );
    expect(d).toContain('île Maurice');
    expect(d).not.toContain('English-only');
  });
});

describe('area meta', () => {
  it('gives every destination a title and a clean description in both languages', () => {
    for (const a of areas) {
      for (const locale of ['en', 'fr'] as const) {
        const local = localisedArea(a, locale);
        const title = areaMetaTitle(local, locale);
        const description = areaMetaDescription(local, locale);
        expect(title.startsWith(a.name)).toBe(true);
        expect(description.length).toBeLessThanOrEqual(SNIPPET_MAX);
      }
      expect(areaMetaTitle(a, 'fr')).not.toBe(areaMetaTitle(a, 'en'));
    }
  });

  it('uses the hand-tuned Belle Mare copy that names the beach and the hotels', () => {
    const bm = areas.find((a) => a.slug === 'belle-mare')!;
    expect(areaMetaTitle(bm)).toBe('Belle Mare Beach, Mauritius: Hotels & Things to Do');
    expect(areaMetaTitle(bm, 'fr')).toContain('île Maurice');
    // It promises hotels — only honest because this area carries a curated hotel list.
    expect(bm.stayOptions?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('blog meta overrides', () => {
  it('applies each override to a real seed post', () => {
    for (const [slug, meta] of Object.entries(POST_META_OVERRIDES)) {
      const post = posts.find((p) => p.slug === slug);
      expect(post, slug).toBeDefined();
      if (meta.metaTitle) expect(post!.metaTitle).toBe(meta.metaTitle);
      if (meta.metaDescription) {
        expect(post!.metaDescription).toBe(meta.metaDescription);
        expect(meta.metaDescription.length).toBeLessThanOrEqual(160);
      }
    }
  });

  it('never lets a seed post carry the brand itself (the template adds it — twice is a bug)', () => {
    for (const p of posts) expect(p.metaTitle, p.slug).not.toContain('Belle Mare Tours');
  });
});
