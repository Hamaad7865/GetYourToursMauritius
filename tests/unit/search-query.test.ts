import { describe, expect, it } from 'vitest';
import { buildSearchUrl, travellersQueryParams, withTravellers } from '@/lib/search/query';

describe('buildSearchUrl', () => {
  it('omits every param at its default (no query, no date, 1 adult, 0 children)', () => {
    expect(buildSearchUrl({ query: '', date: null, adults: 1, kids: 0 })).toBe('/activities');
  });

  it('includes q, date and adults/children only when they differ from the default', () => {
    const url = buildSearchUrl({
      query: '  kayak  ',
      date: new Date(2026, 8, 15),
      adults: 2,
      kids: 1,
    });
    expect(url).toBe('/activities?q=kayak&date=2026-09-15&adults=2&children=1');
  });
});

describe('travellersQueryParams', () => {
  it('is empty at the default (1 adult, 0 children, or both unset)', () => {
    expect(travellersQueryParams()).toBe('');
    expect(travellersQueryParams(1, 0)).toBe('');
  });

  it('includes adults only when it differs from 1', () => {
    expect(travellersQueryParams(3, 0)).toBe('adults=3');
  });

  it('includes children only when greater than 0', () => {
    expect(travellersQueryParams(1, 2)).toBe('children=2');
  });

  it('includes both when both differ from default', () => {
    expect(travellersQueryParams(2, 1)).toBe('adults=2&children=1');
  });
});

describe('withTravellers', () => {
  it('returns the bare path when there is nothing to carry', () => {
    expect(withTravellers('/activities/kayak-tour', 1, 0)).toBe('/activities/kayak-tour');
    expect(withTravellers('/activities/kayak-tour')).toBe('/activities/kayak-tour');
  });

  it('appends a ? query string when adults/children differ from default', () => {
    expect(withTravellers('/activities/kayak-tour', 2, 1)).toBe(
      '/activities/kayak-tour?adults=2&children=1',
    );
  });
});
