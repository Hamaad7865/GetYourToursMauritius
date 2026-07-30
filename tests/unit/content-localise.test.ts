import { describe, expect, it } from 'vitest';
import { localiseContent } from '@/lib/content/localise';

/**
 * Same per-field rule as the SQL path: French where it exists, English everywhere else. A row-level
 * swap would blank whole sections of a partially translated guide.
 */
describe('localiseContent', () => {
  const en = { slug: 'grand-baie', name: 'Grand Baie', intro: 'A lively hub.',
    highlights: ['Catamaran cruise', 'Dive the reefs'] };

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
});
