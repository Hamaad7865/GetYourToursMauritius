import { describe, expect, it } from 'vitest';
import { HOME_TOURS_MAX, pickHomeTours } from '@/lib/catalogue/home-tours';
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
