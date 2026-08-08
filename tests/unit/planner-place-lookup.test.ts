import { describe, expect, it } from 'vitest';
import {
  buildPreviewIndex,
  findPreview,
  normalizeName,
  type PlacePreview,
} from '@/lib/planner/place-lookup';

/* Matching the names ZilAi writes for a human back to the places we know — generous enough for its
 * phrasing ("Ile Aux Cerfs"), strict enough that the card never shows the wrong place. */

const preview = (name: string, over: Partial<PlacePreview> = {}): PlacePreview => ({
  name,
  category: 'Beach',
  region: 'East',
  blurb: null,
  facts: [],
  images: [],
  href: null,
  priceLabel: null,
  ratingLabel: null,
  ...over,
});

describe('normalizeName', () => {
  it('folds accents, case and punctuation', () => {
    expect(normalizeName('Île aux Cerfs')).toBe('ile aux cerfs');
    expect(normalizeName('ILE AUX CERFS')).toBe('ile aux cerfs');
    expect(normalizeName('Catamaran Cruise – Ile Aux Cerfs')).toBe(
      'catamaran cruise ile aux cerfs',
    );
  });
});

describe('findPreview', () => {
  it('matches across the model’s accent and case drift', () => {
    const index = buildPreviewIndex([preview('Île aux Cerfs')]);
    expect(findPreview(index, 'Ile Aux Cerfs')?.name).toBe('Île aux Cerfs');
  });

  it('matches a name the model shortened or padded', () => {
    const index = buildPreviewIndex([preview('Catamaran Cruise – Ile Aux Cerfs')]);
    // ZilAi rarely writes a catalogue title verbatim, so containment goes both ways.
    expect(findPreview(index, 'Catamaran Cruise')?.name).toBe('Catamaran Cruise – Ile Aux Cerfs');
    expect(findPreview(index, 'the Catamaran Cruise – Ile Aux Cerfs trip')?.name).toBe(
      'Catamaran Cruise – Ile Aux Cerfs',
    );
  });

  it('prefers the entry indexed first when two share a name', () => {
    const index = buildPreviewIndex([
      preview('Ile aux Cerfs', { href: '/activities/ile-aux-cerfs' }),
      preview('Île aux Cerfs', { href: null }),
    ]);
    expect(findPreview(index, 'Ile aux Cerfs')?.href).toBe('/activities/ile-aux-cerfs');
  });

  it('shows nothing rather than guessing between two plausible places', () => {
    const index = buildPreviewIndex([
      preview('Belle Mare Beach North'),
      preview('Belle Mare Beach South'),
    ]);
    expect(findPreview(index, 'Belle Mare Beach')).toBeNull();
  });

  it('never matches a short name loosely', () => {
    const index = buildPreviewIndex([preview('Le Morne Brabant Beach')]);
    expect(findPreview(index, 'Beach')).toBeNull();
    expect(findPreview(index, '')).toBeNull();
  });

  it('returns null for a place we simply do not know', () => {
    const index = buildPreviewIndex([preview('Blue Bay Beach')]);
    expect(findPreview(index, 'Trou aux Biches')).toBeNull();
  });
});
