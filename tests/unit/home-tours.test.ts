import { describe, expect, it } from 'vitest';
import { HOME_TOURS_MAX, pickHomeTours, pickPrivateCruises } from '@/lib/catalogue/home-tours';
import { isPrivateCruiseCategory } from '@/lib/categories/categories';
import type { TourImage, TourSummary } from '@/lib/validation/tours';

/* The homepage's first row shows our private day tours. Which ones, and in what order, has to follow
 * the catalogue — the owner edits it in /admin and expects the homepage to keep up. */

const photo = (id: string): TourImage => ({
  id,
  url: `https://img.test/${id}.jpg`,
  alt: null,
  position: 0,
});

const tour = (slug: string, over: Partial<TourSummary> = {}): TourSummary =>
  ({
    id: slug,
    slug,
    type: 'tour',
    title: `Tour ${slug}`,
    summary: null,
    category: 'Taxi Sightseeing tours',
    location: null,
    durationMinutes: 480,
    fromPriceEur: 90,
    fromPriceMaxGuests: null,
    fromPriceIncluded: null,
    pricingMode: 'vehicle',
    minAdvanceDays: 1,
    ratingAvg: null,
    ratingCount: 0,
    heroImage: photo(slug),
    images: [],
    region: null,
    lat: null,
    lng: null,
    ...over,
  }) as TourSummary;

const slugs = (picked: ReturnType<typeof pickHomeTours>) => picked.map((p) => p.tour.slug);

describe('pickHomeTours', () => {
  it('keeps the sightseeing day tours and nothing else', () => {
    const picked = pickHomeTours([
      tour('north-tour'),
      tour('catamaran', { category: 'Catamaran cruises', pricingMode: 'per_person' }),
      tour('south-tour'),
      tour('skydive', { category: 'Air Activity', pricingMode: 'per_person' }),
    ]);
    expect(slugs(picked)).toEqual(['north-tour', 'south-tour']);
  });

  it('follows the catalogue’s order, which is the order set in /admin', () => {
    const picked = pickHomeTours([tour('south-east'), tour('north'), tour('shopping')]);
    expect(slugs(picked)).toEqual(['south-east', 'north', 'shopping']);
  });

  it('matches the category by what it is, not by its exact name', () => {
    // The live category has been "Private Sightseeing tours" and "Taxi Sightseeing tours"; the
    // fallback list calls it "Sightseeing tours". A rename must not empty the homepage row.
    const picked = pickHomeTours([
      tour('a', { category: 'Private Sightseeing tours' }),
      tour('b', { category: 'Sightseeing tours' }),
      tour('c', { category: 'Taxi Sightseeing tours' }),
    ]);
    expect(picked).toHaveLength(3);
  });

  it('leaves out a tour with no photo rather than showing an empty tile', () => {
    const picked = pickHomeTours([
      tour('no-photo', { heroImage: null, images: [] }),
      tour('with-photo'),
    ]);
    expect(slugs(picked)).toEqual(['with-photo']);
  });

  it('falls back to the first gallery photo when there is no hero image', () => {
    const gallery = photo('gallery-1');
    const [picked] = pickHomeTours([tour('a', { heroImage: null, images: [gallery] })]);
    expect(picked!.image).toBe(gallery);
  });

  it('stops at one row, and a photo-less tour does not use up a place in it', () => {
    const many = [
      tour('no-photo', { heroImage: null }),
      ...Array.from({ length: 9 }, (_, i) => tour(`t${i}`)),
    ];
    const picked = pickHomeTours(many);
    expect(picked).toHaveLength(HOME_TOURS_MAX);
    expect(slugs(picked)[0]).toBe('t0');
  });

  it('returns nothing when the catalogue has no day tours (the row then disappears)', () => {
    expect(pickHomeTours([])).toEqual([]);
    expect(pickHomeTours([tour('x', { category: 'Catamaran cruises' })])).toEqual([]);
  });
});

/* The second homepage row: our private boat trips (owner, 2026-11-09: "emphasize on private things
 * like private cruises"). Same rules as the day tours: catalogue order, photo-less tours skipped. */
describe('pickPrivateCruises', () => {
  const cruise = (slug: string, over: Partial<TourSummary> = {}) =>
    tour(slug, {
      category: 'Private Cruises',
      pricingMode: 'per_group',
      fromPriceEur: 850,
      fromPriceIncluded: 4,
      ...over,
    });

  it('keeps the private boat trips, in catalogue order, and nothing else', () => {
    const picked = pickPrivateCruises([
      cruise('cataspeed-5-islands'),
      tour('shared-catamaran', { category: 'Catamaran cruises', pricingMode: 'per_person' }),
      tour('north-tour'),
      cruise('private-dolphins'),
    ]);
    expect(slugs(picked)).toEqual(['cataspeed-5-islands', 'private-dolphins']);
  });

  it('survives a rename of the category in /admin', () => {
    for (const name of ['Private Cruises', 'Private boat trips', 'Private catamaran & speedboat']) {
      expect(isPrivateCruiseCategory(name), name).toBe(true);
    }
    for (const name of ['Catamaran cruises', 'Speedboat Tours', 'Taxi Sightseeing tours', null]) {
      expect(isPrivateCruiseCategory(name), String(name)).toBe(false);
    }
  });

  it('skips a trip with no photo and stops at one row', () => {
    const many = [
      cruise('no-photo', { heroImage: null, images: [] }),
      ...Array.from({ length: 9 }, (_, i) => cruise(`c${i}`)),
    ];
    const picked = pickPrivateCruises(many);
    expect(picked).toHaveLength(HOME_TOURS_MAX);
    expect(slugs(picked)[0]).toBe('c0');
  });
});
