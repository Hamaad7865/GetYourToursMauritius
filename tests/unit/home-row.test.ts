import { describe, expect, it } from 'vitest';
import {
  chooseHomeRow,
  homeRowHeading,
  isHomePicks,
  mauritiusTomorrow,
  type HomeRow,
  type HomeRowInput,
} from '@/lib/catalogue/home-row';
import type { HomePicks } from '@/lib/validation/home-picks';
import type { TourImage, TourSummary } from '@/lib/validation/tours';

/* The homepage's first row (docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md). Four
 * rules, first that fits wins: guides read → on the island → most booked → today's private tours. Every
 * heading must be true of every tile under it, so no row tops up with tours it does not describe. */

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
    category: 'Catamaran cruises',
    location: null,
    durationMinutes: 480,
    fromPriceEur: 90,
    fromPriceMaxGuests: null,
    fromPriceIncluded: null,
    pricingMode: 'per_person',
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

const TOMORROW = '2026-10-18';
const picks = (over: Partial<HomePicks> = {}): HomePicks => ({
  date: TOMORROW,
  mostBooked: [],
  freeTomorrow: [],
  ...over,
});

// Catalogue order: a…h, then three private day tours (the fallback row's category).
const ACTIVITIES = [
  ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => tour(s)),
  tour('north-tour', { category: 'Taxi Sightseeing tours', pricingMode: 'vehicle' }),
  tour('south-tour', { category: 'Taxi Sightseeing tours', pricingMode: 'vehicle' }),
  tour('east-tour', { category: 'Taxi Sightseeing tours', pricingMode: 'vehicle' }),
];

const row = (input: Partial<HomeRowInput>): HomeRow =>
  chooseHomeRow({ activities: ACTIVITIES, picks: null, tomorrow: TOMORROW, ...input });
const slugs = (r: HomeRow) => r.tiles.map((x) => x.tour.slug);

describe('rule 3 — most booked (everyone else, and what the server renders)', () => {
  it('shows the most-booked tours in booked order', () => {
    const r = row({ picks: picks({ mostBooked: ['c', 'a', 'f'] }) });
    expect(r.variant).toBe('popular');
    expect(slugs(r)).toEqual(['c', 'a', 'f']);
  });

  it('shows six at most', () => {
    const r = row({ picks: picks({ mostBooked: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }) });
    expect(slugs(r)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('skips tours not in the catalogue (unpublished, the airport transfer) and photo-less ones', () => {
    const activities = ACTIVITIES.map((a) =>
      a.slug === 'b' ? { ...a, heroImage: null, images: [] } : a,
    );
    const r = chooseHomeRow({
      activities,
      tomorrow: TOMORROW,
      picks: picks({ mostBooked: ['airport-transfer', 'b', 'a', 'c', 'd'] }),
    });
    expect(slugs(r)).toEqual(['a', 'c', 'd']);
  });

  it('never tops up with unbooked tours: fewer than three falls back to the private tours', () => {
    const r = row({ picks: picks({ mostBooked: ['c', 'a'] }) });
    expect(r.variant).toBe('private');
    expect(slugs(r)).toEqual(['north-tour', 'south-tour', 'east-tour']);
  });

  it('falls back to the private tours when the picks could not be loaded', () => {
    expect(row({ picks: null }).variant).toBe('private');
  });

  it('does not care about the date — what was booked does not change at midnight', () => {
    const r = row({ picks: picks({ date: '2026-10-01', mostBooked: ['a', 'b', 'c'] }) });
    expect(r.variant).toBe('popular');
  });
});

describe('rule 2 — on the island', () => {
  it('shows tours free tomorrow, most booked first, then in catalogue order', () => {
    const r = row({
      onIsland: true,
      picks: picks({ mostBooked: ['f', 'c', 'a'], freeTomorrow: ['a', 'b', 'c', 'g'] }),
    });
    expect(r.variant).toBe('island');
    expect(slugs(r)).toEqual(['c', 'a', 'b', 'g']);
  });

  it('needs three free tours, else falls through to most booked', () => {
    const r = row({
      onIsland: true,
      picks: picks({ mostBooked: ['d', 'e', 'f'], freeTomorrow: ['a', 'b'] }),
    });
    expect(r.variant).toBe('popular');
  });

  it('treats an answer about another day as nothing free', () => {
    const r = row({
      onIsland: true,
      picks: picks({
        date: '2026-10-17',
        mostBooked: ['d', 'e', 'f'],
        freeTomorrow: ['a', 'b', 'c'],
      }),
    });
    expect(r.variant).toBe('popular');
    expect(slugs(r)).toEqual(['d', 'e', 'f']);
  });

  it('is not used for visitors abroad', () => {
    const r = row({ picks: picks({ mostBooked: ['d', 'e', 'f'], freeTomorrow: ['a', 'b', 'c'] }) });
    expect(r.variant).toBe('popular');
  });
});

describe('rule 1 — guides read', () => {
  const interest = [
    { topic: 'post:x', slugs: ['c', 'a'] },
    { topic: 'attraction:y', slugs: ['a', 'e', 'g'] },
  ];

  it('shows the tours of the guides read, newest guide first, each tour once', () => {
    const r = row({ interest });
    expect(r.variant).toBe('guides');
    expect(slugs(r)).toEqual(['c', 'a', 'e', 'g']);
  });

  it('leaves out tours already shown in Continue planning', () => {
    expect(slugs(row({ interest, continuing: ['a'] }))).toEqual(['c', 'e', 'g']);
  });

  it('needs three tours, else falls through', () => {
    const r = row({
      interest: [{ topic: 'post:x', slugs: ['a', 'b'] }],
      picks: picks({ mostBooked: ['d', 'e', 'f'] }),
    });
    expect(r.variant).toBe('popular');
  });

  it('wins over the island row', () => {
    const r = row({
      interest,
      onIsland: true,
      picks: picks({ freeTomorrow: ['d', 'e', 'f', 'h'] }),
    });
    expect(r.variant).toBe('guides');
  });

  it('on the island, puts the tours free tomorrow first', () => {
    const r = row({
      interest: [{ topic: 'post:x', slugs: ['a', 'b', 'c', 'd'] }],
      onIsland: true,
      picks: picks({ freeTomorrow: ['c', 'a'] }),
    });
    expect(slugs(r)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('keeps the guides’ order for visitors abroad', () => {
    const r = row({
      interest: [{ topic: 'post:x', slugs: ['a', 'b', 'c', 'd'] }],
      picks: picks({ freeTomorrow: ['c', 'a'] }),
    });
    expect(slugs(r)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('homeRowHeading', () => {
  it('names each row through the translator', () => {
    const t = (s: string) => `«${s}»`;
    expect(homeRowHeading('guides', t)).toBe('«Picked from the guides you’ve read»');
    expect(homeRowHeading('island', t)).toBe('«Still free tomorrow»');
    expect(homeRowHeading('popular', t)).toBe('«Most booked by our guests»');
    expect(homeRowHeading('private', t)).toBe('«Private day tours with your own driver»');
  });
});

describe('mauritiusTomorrow', () => {
  it('is the day after the Mauritius date (UTC+4, no DST)', () => {
    expect(mauritiusTomorrow(new Date('2026-10-17T19:59:59Z'))).toBe('2026-10-18'); // 23:59 in MU
    expect(mauritiusTomorrow(new Date('2026-10-17T20:00:00Z'))).toBe('2026-10-19'); // 00:00 in MU
  });
});

describe('isHomePicks', () => {
  it('accepts a picks answer', () => {
    expect(isHomePicks(picks({ mostBooked: ['a'], freeTomorrow: ['b'] }))).toBe(true);
  });

  it('refuses anything else, so a bad answer keeps the row on screen', () => {
    expect(isHomePicks(null)).toBe(false);
    expect(isHomePicks('nope')).toBe(false);
    expect(isHomePicks({ date: TOMORROW, mostBooked: [] })).toBe(false);
    expect(isHomePicks({ date: 7, mostBooked: [], freeTomorrow: [] })).toBe(false);
    expect(isHomePicks({ date: TOMORROW, mostBooked: [1], freeTomorrow: [] })).toBe(false);
  });
});
