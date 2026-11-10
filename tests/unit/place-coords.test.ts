import { describe, expect, it } from 'vitest';
import { lookupPlaceCoords, normalisePlaceName } from '@/lib/maps/place-coords';
import { PLACE_COORDS } from '@/lib/content/_place-coords.gen';

describe('normalisePlaceName', () => {
  it('folds case, accents, punctuation, spacing and a trailing ", Mauritius"', () => {
    expect(normalisePlaceName('  Chamarel Waterfall, Mauritius ')).toBe('chamarel waterfall');
    expect(normalisePlaceName('Île aux  Cerfs')).toBe('ile aux cerfs');
    expect(normalisePlaceName("Trou D'eau Douce")).toBe('trou d eau douce');
  });
});

describe('lookupPlaceCoords', () => {
  it('is undefined for a name the table does not know (the caller asks Google)', () => {
    expect(lookupPlaceCoords('definitely not a place 123')).toBeUndefined();
  });

  it('only ever stores points on Mauritius', () => {
    for (const [name, p] of Object.entries(PLACE_COORDS)) {
      if (p === null) continue;
      const onIsland = p.lat > -20.6 && p.lat < -19.75 && p.lng > 57.25 && p.lng < 57.85;
      expect(onIsland, name).toBe(true);
    }
  });

  it('keys are already normalised, so every entry is reachable', () => {
    for (const name of Object.keys(PLACE_COORDS)) expect(normalisePlaceName(name)).toBe(name);
  });
});
