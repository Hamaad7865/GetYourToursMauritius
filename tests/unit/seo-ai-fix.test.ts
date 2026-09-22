import { describe, expect, it } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import type { LanguageModelV1 } from 'ai';
import {
  runSeoAiFix,
  verifySeoFix,
  anchorKeyword,
  toSaveValues,
  type SeoFixPage,
} from '@/lib/services/seo-ai-fix';
import { ValidationError } from '@/lib/services/errors';
import type { ServiceContext } from '@/lib/services/context';

/**
 * The one-click AI fix, proved WITHOUT Gemini: the model is a MockLanguageModelV1 answering
 * generateObject with fixed JSON, and the port is a stub page list — so these tests pin the
 * CONTRACT that must hold in production:
 *   - a rewrite is saved only if it passes budgets + brand + keyword + duplicate verification;
 *   - anything else comes back unverified with the reasons, and nothing is written;
 *   - with no model configured the feature reports itself unavailable rather than throwing.
 */

const ctx = {
  locale: 'en',
  ai: { name: 'google', model: 'gemini-2.0-flash' },
} as unknown as ServiceContext;

/** A model that answers `generateObject` with a fixed JSON object (json object-generation mode). */
function scriptedObjectModel(object: unknown): LanguageModelV1 {
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: 'json',
    doGenerate: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      finishReason: 'stop' as const,
      usage: { promptTokens: 1, completionTokens: 1 },
      text: JSON.stringify(object),
    }),
  });
}

function page(over: Partial<SeoFixPage> = {}): SeoFixPage {
  return {
    path: '/',
    label: 'Homepage',
    group: 'Main pages',
    title: 'Belle Mare Tours — Mauritius Tours, Activities & Airport Taxi',
    description:
      'Book Mauritius tours, activities and excursions direct with Belle Mare Tours: catamaran cruises, dolphin swims, island day tours and airport transfers.',
    requireBrand: false,
    kind: 'override',
    slug: null,
    ...over,
  };
}

describe('anchorKeyword', () => {
  it('takes the first substantial non-brand word', () => {
    expect(anchorKeyword('Sunset Catamaran Cruise to Ile aux Cerfs | Belle Mare Tours')).toBe(
      'sunset',
    );
  });
  it('skips brand words to the topical one', () => {
    expect(anchorKeyword('Belle Mare Tours — Mauritius Day Trips')).toBe('mauritius');
  });
  it('returns null when there is nothing to anchor to', () => {
    expect(anchorKeyword('')).toBeNull();
    expect(anchorKeyword('Rent')).toBeNull();
  });
});

describe('verifySeoFix', () => {
  const LONG_TITLE = `Sunset Catamaran Cruise to Ile aux Cerfs Lagoon Day Trip 2026!`;
  const LONG_DESC =
    `Sail to Ile aux Cerfs aboard a spacious catamaran with snorkelling stops, a beach barbecue ` +
    `lunch, open bar service, and hotel pickup and drop-off included in every fare we quote you!`;
  it('accepts a within-budget rewrite and reports the cleared codes', () => {
    expect(LONG_TITLE.length).toBeGreaterThan(60);
    expect(LONG_DESC.length).toBeGreaterThan(160);
    const pages = [page({ title: LONG_TITLE, description: LONG_DESC })];
    const fixedTitle = 'Sunset Catamaran Cruise to Ile aux Cerfs | Belle Mare Tours';
    const fixedDesc =
      'Sail to Ile aux Cerfs by catamaran — snorkelling, beach barbecue lunch and hotel pickup included.';
    expect(fixedTitle.length).toBeLessThanOrEqual(60);
    expect(fixedDesc.length).toBeGreaterThanOrEqual(70);
    expect(fixedDesc.length).toBeLessThanOrEqual(160);
    const check = verifySeoFix(pages, '/', fixedTitle, fixedDesc);
    expect(check.ok).toBe(true);
    expect(check.fixed).toContain('title-too-long');
    expect(check.fixed).toContain('description-too-long');
  });

  it('rejects an over-budget rewrite', () => {
    const pages = [page({ title: 'A'.repeat(61), description: 'B'.repeat(100) })];
    const check = verifySeoFix(pages, '/', 'A'.repeat(61), 'B'.repeat(100));
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/61 characters/);
  });

  it('rejects a dropped brand on pages that ship absolute', () => {
    const pages = [
      page({
        requireBrand: true,
        title: `Sunset Cruise Day Trip Extra Long Title 12345 | Belle Mare Tours`,
      }),
    ];
    const check = verifySeoFix(
      pages,
      '/',
      'Sunset Cruise Day Trip Extra Long and Shorter Now',
      'C'.repeat(100),
    );
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/brand/);
  });

  it('rejects keyword drift even when the lengths are fine', () => {
    const pages = [
      page({
        requireBrand: true,
        title: 'Sunset Catamaran Cruise to Ile aux Cerfs Lagoon Trip 12 | Belle Mare Tours',
        description: 'D'.repeat(100),
      }),
    ];
    const check = verifySeoFix(
      pages,
      '/',
      'Amazing Boat Day Out on the Water Lagoon Trip 12 | Belle Mare Tours',
      'D'.repeat(100),
    );
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/sunset/);
  });

  it('rejects a rewrite that would duplicate another page', () => {
    const shared = 'Ile aux Cerfs Speedboat Day Trip With Lunch 12 | Belle Mare Tours';
    const pages = [
      page({ path: '/a', label: 'A', title: 'A'.repeat(61), description: 'E'.repeat(100) }),
      page({ path: '/b', label: 'B', title: shared, description: 'F'.repeat(100) }),
    ];
    const check = verifySeoFix(pages, '/a', shared, 'E'.repeat(100));
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/Same title/);
  });

  it('reports unknown pages instead of verifying against nothing', () => {
    const check = verifySeoFix([page()], '/nope', 'Whatever Title Here Yes', 'G'.repeat(100));
    expect(check.ok).toBe(false);
  });
});

describe('toSaveValues', () => {
  it('strips one brand suffix for blog posts (the template re-adds it)', () => {
    const blog = page({ kind: 'blog', slug: 'when-to-visit', requireBrand: true });
    const out = toSaveValues(
      blog,
      'When to Visit Mauritius in 2026 | Belle Mare Tours',
      'H'.repeat(100),
    );
    expect(out.saveTitle).toBe('When to Visit Mauritius in 2026');
    expect(out.saveDescription).toBe('H'.repeat(100));
  });
  it('passes override and tour values through untouched', () => {
    const tour = page({ kind: 'tour', slug: 'sunset-catamaran', requireBrand: true });
    const out = toSaveValues(tour, 'Sunset Catamaran | Belle Mare Tours', 'I'.repeat(100));
    expect(out.saveTitle).toBe('Sunset Catamaran | Belle Mare Tours');
  });
});

describe('runSeoAiFix', () => {
  const LONG_TITLE = 'Sunset Catamaran Cruise to Ile aux Cerfs Lagoon Day Trip 2026! For Real';
  const GOOD_TITLE = 'Sunset Catamaran Cruise to Ile aux Cerfs | Belle Mare Tours';
  const GOOD_DESC =
    'Sail to Ile aux Cerfs by catamaran — snorkelling, beach barbecue lunch and hotel pickup included.';

  it('fixes a too-long title end to end with a scripted model', async () => {
    expect(LONG_TITLE.length).toBeGreaterThan(60);
    const port = { listPages: async () => [page({ title: LONG_TITLE, description: GOOD_DESC })] };
    const result = await runSeoAiFix(
      ctx,
      port,
      '/',
      scriptedObjectModel({ title: GOOD_TITLE, description: GOOD_DESC }),
    );
    expect(result.available).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.title).toBe(GOOD_TITLE);
    expect(result.titleChars).toBeLessThanOrEqual(60);
    expect(result.fixedCodes).toContain('title-too-long');
    expect(result.note).toBeNull();
  });

  it('short-circuits clean pages without touching the model', async () => {
    const clean = page({
      title: 'Mauritius Tours & Day Trips — Book Direct',
      description:
        'Island day trips, catamaran cruises and private sightseeing booked direct with us.',
    });
    const port = { listPages: async () => [clean] };
    // null model would be "unconfigured" — a clean page must never get that far.
    const result = await runSeoAiFix(ctx, port, '/', null);
    expect(result.available).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.fixedCodes).toEqual([]);
    expect(result.note).toMatch(/Already clean/);
  });

  it('reports unavailable when no model is configured', async () => {
    const port = {
      listPages: async () => [page({ title: 'J'.repeat(61), description: 'K'.repeat(100) })],
    };
    const result = await runSeoAiFix(ctx, port, '/', null);
    expect(result.available).toBe(false);
    expect(result.verified).toBe(false);
  });

  it('throws a 400 ValidationError for unknown paths', async () => {
    const port = { listPages: async () => [page()] };
    await expect(runSeoAiFix(ctx, port, '/nope', null)).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns unverified (never a silent save) after two failed attempts', async () => {
    const port = {
      listPages: async () => [page({ title: 'L'.repeat(61), description: 'M'.repeat(100) })],
    };
    // The model keeps answering over budget; both attempts fail verification.
    const result = await runSeoAiFix(
      ctx,
      port,
      '/',
      scriptedObjectModel({ title: 'L'.repeat(61), description: 'M'.repeat(100) }),
    );
    expect(result.available).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.fixedCodes).toEqual([]);
    expect(result.note).toMatch(/nothing was saved/);
  });
});
