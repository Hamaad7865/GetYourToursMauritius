import { describe, expect, it } from 'vitest';
import { localiseContent } from '@/lib/content/localise';
import type { Area, AreaContent } from '@/lib/content/areas';
import { ADDITIONAL_ATTRACTIONS_RAW } from '@/lib/content/_additional-attractions.gen';
import {
  localisedPlace,
  localisedAttractionExtra,
  ATTRACTION_EXTRA,
} from '@/lib/content/attractions';
import { transfers, localisedTransfer, type Transfer } from '@/lib/content/transfers';

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

describe('attractions content localisation', () => {
  const montChoisy = ADDITIONAL_ATTRACTIONS_RAW.find((p) => p.id === 'mont-choisy-beach')!;

  it('translates the blurb for fr, keeps English for en, never touches real-world fields', () => {
    const fr = localisedPlace(montChoisy, 'fr');
    const en = localisedPlace(montChoisy, 'en');
    expect(fr.blurb).not.toBe(montChoisy.blurb);
    expect(en.blurb).toBe(montChoisy.blurb);
    // id/name/region/category are real-world data — AttractionTranslation cannot express them, so
    // they must be byte-identical to the English source regardless of locale.
    expect(fr.id).toBe(montChoisy.id);
    expect(fr.name).toBe(montChoisy.name);
    expect(fr.region).toBe(montChoisy.region);
    expect(fr.category).toBe(montChoisy.category);
  });

  it('falls back to the English blurb when a place has no French entry at all', () => {
    const noOverlay = {
      ...montChoisy,
      id: 'not-a-real-attraction-slug',
      blurb: 'Some English text.',
    };
    expect(localisedPlace(noOverlay, 'fr').blurb).toBe('Some English text.');
  });

  it('translates the marquee editorial (body/bestTime/tips) for fr', () => {
    const extraEn = ATTRACTION_EXTRA['chamarel-seven-coloured-earth']!;
    const extraFr = localisedAttractionExtra('chamarel-seven-coloured-earth', 'fr');
    expect(extraFr).toBeDefined();
    expect(extraFr!.body).not.toEqual(extraEn.body);
    expect(extraFr!.bestTime).not.toBe(extraEn.bestTime);
    expect(extraFr!.tips).not.toEqual(extraEn.tips);
  });

  it('returns undefined editorial for a slug with no ATTRACTION_EXTRA entry, in either locale', () => {
    expect(localisedAttractionExtra('mont-choisy-beach', 'fr')).toBeUndefined();
    expect(localisedAttractionExtra('mont-choisy-beach', 'en')).toBeUndefined();
  });

  it('per-field fallback: a translated body with no translated bestTime/tips never renders blank', () => {
    // Same property Task 13 established for AreaTranslation, exercised here through the merge
    // localisedAttractionExtra uses — a partially translated entry must degrade per field, not blank.
    const enExtra = {
      body: ['English body.'],
      bestTime: 'English best time.',
      tips: ['English tip.'],
    };
    const frPartial = { body: ['French body.'] }; // bestTime/tips deliberately left untranslated
    const merged = localiseContent(enExtra, frPartial, 'fr');
    expect(merged.body).toEqual(['French body.']);
    expect(merged.bestTime).toBe('English best time.');
    expect(merged.tips).toEqual(['English tip.']);
  });
});

describe('transfers content localisation', () => {
  const luxBelleMare = transfers.find((t) => t.slug === 'lux-belle-mare')!;

  it('translates intro/included/faq for fr, keeps English for en', () => {
    const fr = localisedTransfer(luxBelleMare, 'fr');
    const en = localisedTransfer(luxBelleMare, 'en');
    expect(fr.intro).not.toBe(luxBelleMare.intro);
    expect(fr.included).not.toEqual(luxBelleMare.included);
    expect(fr.faq).not.toEqual(luxBelleMare.faq);
    expect(en.intro).toBe(luxBelleMare.intro);
    expect(en.included).toEqual(luxBelleMare.included);
    expect(en.faq).toEqual(luxBelleMare.faq);
  });

  it('never touches hotel/area/region/distance/duration/path/fromPriceEur or nearbyAttractions', () => {
    // These are real-world facts a customer relies on (or real proper nouns) — TransferTranslation
    // cannot even express them, so a French entry can never override them.
    const fr = localisedTransfer(luxBelleMare, 'fr');
    expect(fr.hotelName).toBe(luxBelleMare.hotelName);
    expect(fr.area).toBe(luxBelleMare.area);
    expect(fr.region).toBe(luxBelleMare.region);
    expect(fr.distanceKmFromAirport).toBe(luxBelleMare.distanceKmFromAirport);
    expect(fr.durationMinFromAirport).toBe(luxBelleMare.durationMinFromAirport);
    expect(fr.path).toBe(luxBelleMare.path);
    expect(fr.fromPriceEur).toBe(luxBelleMare.fromPriceEur);
    expect(fr.nearbyAttractions).toEqual(luxBelleMare.nearbyAttractions);
  });

  it('falls back to English for a hotel with no French entry at all', () => {
    const noOverlay: Transfer = { ...luxBelleMare, slug: 'not-a-real-hotel-slug' };
    const out = localisedTransfer(noOverlay, 'fr');
    expect(out.intro).toBe(noOverlay.intro);
    expect(out.included).toEqual(noOverlay.included);
    expect(out.faq).toEqual(noOverlay.faq);
  });

  it('per-field fallback: a translated intro with no translated faq never renders a blank FAQ', () => {
    // Same property Task 13 established for AreaTranslation and Task 14 for AttractionTranslation,
    // exercised here through the merge localisedTransfer uses.
    const enTransfer = {
      intro: 'English intro.',
      included: ['English included item.'],
      faq: [{ q: 'English question?', a: 'English answer.' }],
    };
    const frPartial = { intro: 'Intro français.' }; // included/faq deliberately left untranslated
    const merged = localiseContent(enTransfer, frPartial, 'fr');
    expect(merged.intro).toBe('Intro français.');
    expect(merged.included).toEqual(['English included item.']);
    expect(merged.faq).toEqual([{ q: 'English question?', a: 'English answer.' }]);
  });
});
