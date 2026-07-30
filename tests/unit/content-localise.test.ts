import { describe, expect, it } from 'vitest';
import { localiseContent } from '@/lib/content/localise';
import type { Area, AreaContent } from '@/lib/content/areas';

/**
 * Same per-field rule as the SQL path: French where it exists, English everywhere else. A row-level
 * swap would blank whole sections of a partially translated guide.
 */
describe('localiseContent', () => {
  const en = {
    slug: 'grand-baie',
    name: 'Grand Baie',
    intro: 'A lively hub.',
    highlights: ['Catamaran cruise', 'Dive the reefs'],
  };

  it('returns English untouched for the en locale', () => {
    expect(localiseContent(en, { intro: 'Un pôle animé.' }, 'en')).toEqual(en);
  });

  it('overlays only the fields the French entry defines', () => {
    const out = localiseContent(en, { intro: 'Un pôle animé.' }, 'fr');
    expect(out.intro).toBe('Un pôle animé.');
    expect(out.highlights).toEqual(['Catamaran cruise', 'Dive the reefs']);
    expect(out.slug).toBe('grand-baie');
  });

  it('returns English when there is no French entry at all', () => {
    expect(localiseContent(en, undefined, 'fr')).toEqual(en);
  });

  it('ignores empty strings and empty arrays, which mean untranslated', () => {
    const out = localiseContent(en, { intro: '', highlights: [] }, 'fr');
    expect(out.intro).toBe('A lively hub.');
    expect(out.highlights).toEqual(['Catamaran cruise', 'Dive the reefs']);
  });

  it('never lets a French entry introduce a slug', () => {
    // A translated slug would break every URL and every internal link to this page.
    const out = localiseContent(en, { slug: 'grande-baie', intro: 'Un pôle animé.' }, 'fr');
    expect(out.slug).toBe('grand-baie');
    expect(out.intro).toBe('Un pôle animé.');
  });

  it('does not mutate the English source', () => {
    const source = { slug: 'belle-mare', intro: 'A quiet beach.' };
    localiseContent(source, { intro: 'Une plage tranquille.' }, 'fr');
    expect(source.intro).toBe('A quiet beach.');
  });

  it('keeps the full English type when the French entry is a narrower allowlist type', () => {
    // Regression guard for generic inference. Without NoInfer on the French parameter, T infers
    // from the narrower translation type and the result silently loses fields Area adds on top of
    // AreaContent — `path` here — which only surfaces as a type error at the call site later.
    const area: Area = {
      slug: 'grand-baie',
      name: 'Grand Baie',
      region: 'North',
      intro: 'A lively hub.',
      highlights: [],
      beaches: ['La Cuvette Beach'],
      gettingThere: 'About an hour from SSR.',
      goodFor: ['Families'],
      nearbyAttractions: ['Pereybere Beach'],
      faq: [],
      path: '/destinations/grand-baie',
    };
    const translation: Partial<Pick<AreaContent, 'intro' | 'gettingThere'>> = {
      intro: 'Un pôle animé.',
    };

    const out = localiseContent(area, translation, 'fr');

    // Compiles only if `out` is Area, not AreaContent.
    expect(out.path).toBe('/destinations/grand-baie');
    expect(out.intro).toBe('Un pôle animé.');
    // Real Mauritian place names are untouched — the translation type cannot even express them.
    expect(out.beaches).toEqual(['La Cuvette Beach']);
    expect(out.name).toBe('Grand Baie');
  });
});
