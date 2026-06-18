import { describe, expect, it } from 'vitest';
import {
  regionFromCoords,
  categoryFromTypes,
  durationForCategory,
  closesAtFromHours,
  mapGooglePlace,
} from '@/lib/maps/google-places';

describe('regionFromCoords', () => {
  it('classifies the island into N/S/E/W/Central', () => {
    expect(regionFromCoords(-20.0, 57.58)).toBe('North'); // Grand Baie
    expect(regionFromCoords(-20.45, 57.31)).toBe('South'); // Le Morne
    expect(regionFromCoords(-20.19, 57.77)).toBe('East'); // Belle Mare
    expect(regionFromCoords(-20.27, 57.37)).toBe('West'); // Flic en Flac
    expect(regionFromCoords(-20.32, 57.51)).toBe('Central'); // Curepipe
  });
});

describe('categoryFromTypes', () => {
  it('maps Google types + name keywords to planner categories', () => {
    expect(categoryFromTypes(['beach'], 'Flic en Flac Beach')).toBe('Beach');
    expect(categoryFromTypes([], 'Chamarel Waterfall')).toBe('Waterfall');
    expect(categoryFromTypes([], 'Le Pouce Mountain')).toBe('Viewpoint');
    expect(categoryFromTypes([], 'Île aux Cerfs')).toBe('Island');
    expect(categoryFromTypes(['hindu_temple'], 'Grand Bassin Temple')).toBe('Culture');
    expect(categoryFromTypes(['national_park'], 'Casela Nature Park')).toBe('Nature');
    expect(categoryFromTypes(['market'], 'Central Market')).toBe('Market');
    expect(categoryFromTypes(['restaurant'], 'Some Cafe')).toBe('Landmark'); // default
  });
});

describe('durationForCategory', () => {
  it('returns category defaults and a fallback', () => {
    expect(durationForCategory('Beach')).toBe(120);
    expect(durationForCategory('Viewpoint')).toBe(30);
    expect(durationForCategory('Unknown')).toBe(90);
  });
});

describe('closesAtFromHours', () => {
  it('formats the first closing time, or null', () => {
    expect(closesAtFromHours({ periods: [{ close: { hour: 17, minute: 30 } }] })).toBe('17:30');
    expect(closesAtFromHours({ periods: [{ close: { hour: 9, minute: 0 } }] })).toBe('09:00');
    expect(closesAtFromHours({ periods: [{}] })).toBeNull();
    expect(closesAtFromHours(undefined)).toBeNull();
  });
});

describe('mapGooglePlace', () => {
  it('maps a raw place into a PlannerPlace', () => {
    const p = mapGooglePlace({
      id: 'ChIJxxx',
      displayName: { text: 'Trou aux Biches' },
      location: { latitude: -20.05, longitude: 57.55 },
      types: ['beach'],
      editorialSummary: { text: 'White-sand beach.' },
    });
    expect(p).not.toBeNull();
    expect(p).toMatchObject({
      id: 'ChIJxxx',
      name: 'Trou aux Biches',
      category: 'Beach',
      region: 'North',
      lat: -20.05,
      lng: 57.55,
      durationMin: 120,
      blurb: 'White-sand beach.',
      imageUrl: null,
    });
  });

  it('returns null when essentials are missing', () => {
    expect(mapGooglePlace({ displayName: { text: 'No coords' } })).toBeNull();
    expect(mapGooglePlace({ id: 'x', location: { latitude: -20, longitude: 57 } })).toBeNull();
  });
});
