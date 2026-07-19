import { describe, expect, it } from 'vitest';
import {
  MAX_TRIP_DAYS,
  addDays,
  daySpan,
  isDayKey,
  parseTripParams,
  tripDates,
  tripToParams,
  type TripDayPlan,
} from '@/lib/planner/trip';

describe('isDayKey', () => {
  it('accepts a real calendar day', () => {
    expect(isDayKey('2026-09-01')).toBe(true);
  });
  it('rejects malformed / empty / missing values', () => {
    expect(isDayKey('2026-9-1')).toBe(false);
    expect(isDayKey('01-09-2026')).toBe(false);
    expect(isDayKey('')).toBe(false);
    expect(isDayKey(null)).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });
  it('rejects an impossible date instead of rolling it over', () => {
    expect(isDayKey('2026-02-31')).toBe(false);
    expect(isDayKey('2026-13-01')).toBe(false);
  });
});

describe('addDays / daySpan', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02');
  });
  it('spans are inclusive-exclusive whole days', () => {
    expect(daySpan('2026-09-01', '2026-09-05')).toBe(4);
    expect(daySpan('2026-09-05', '2026-09-01')).toBe(-4);
    expect(daySpan('2026-09-01', '2026-09-01')).toBe(0);
  });
});

describe('tripDates', () => {
  it('enumerates the inclusive range (the Sep 1–5 example → 5 days)', () => {
    expect(tripDates('2026-09-01', '2026-09-05')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });
  it('swaps a reversed range instead of failing', () => {
    expect(tripDates('2026-09-05', '2026-09-01')).toEqual(tripDates('2026-09-01', '2026-09-05'));
  });
  it('clamps to MAX_TRIP_DAYS from the start date', () => {
    const dates = tripDates('2026-09-01', '2026-09-30');
    expect(dates).toHaveLength(MAX_TRIP_DAYS);
    expect(dates[0]).toBe('2026-09-01');
    expect(dates[MAX_TRIP_DAYS - 1]).toBe(addDays('2026-09-01', MAX_TRIP_DAYS - 1));
  });
  it('returns [] for malformed input (link degrades to single-day mode)', () => {
    expect(tripDates('garbage', '2026-09-05')).toEqual([]);
    expect(tripDates('2026-09-01', '2026-02-31')).toEqual([]);
  });
});

const day = (date: string, over: Partial<TripDayPlan> = {}): TripDayPlan => ({
  date,
  stopIds: [],
  dinnerId: null,
  activitySlug: null,
  ...over,
});

describe('trip URL codec', () => {
  it('round-trips a full trip (stops, dinner, activity)', () => {
    const days: TripDayPlan[] = [
      day('2026-09-01', { stopIds: ['pl-a', 'pl-b'], dinnerId: 'pl-din' }),
      day('2026-09-02', { activitySlug: 'catamaran-ile-aux-cerfs' }),
      day('2026-09-03'),
    ];
    const params = new URLSearchParams();
    tripToParams(params, days);
    expect(parseTripParams(params, 6)).toEqual(days);
  });

  it('clears stale day params when the trip shrinks', () => {
    const params = new URLSearchParams();
    tripToParams(params, [
      day('2026-09-01', { stopIds: ['a'] }),
      day('2026-09-02', { stopIds: ['b'], dinnerId: 'x', activitySlug: 'snorkel-trip' }),
    ]);
    tripToParams(params, [day('2026-09-01', { stopIds: ['a'] })]);
    expect(params.get('d1')).toBeNull();
    expect(params.get('din1')).toBeNull();
    expect(params.get('act1')).toBeNull();
    expect(params.get('to')).toBe('2026-09-01');
  });

  it('removes everything for an empty trip (back to single-day mode)', () => {
    const params = new URLSearchParams('from=2026-09-01&to=2026-09-02&d0=a&stops=keep');
    tripToParams(params, []);
    expect([...params.keys()]).toEqual(['stops']);
  });

  it('returns null without a valid from+to pair (single-day links unaffected)', () => {
    expect(parseTripParams(new URLSearchParams('stops=a,b'), 6)).toBeNull();
    expect(parseTripParams(new URLSearchParams('from=2026-09-01'), 6)).toBeNull();
    expect(parseTripParams(new URLSearchParams('from=garbage&to=2026-09-02'), 6)).toBeNull();
  });

  it('caps per-day stop ids, de-duplicates, and drops junk slugs from a hand-edited link', () => {
    const params = new URLSearchParams({
      from: '2026-09-01',
      to: '2026-09-01',
      d0: ' a , b ,a,c,d,e,f,g,h ',
      act0: 'NOT a slug!',
      din0: '   ',
    });
    const parsed = parseTripParams(params, 6);
    expect(parsed).not.toBeNull();
    expect(parsed![0]!.stopIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(parsed![0]!.activitySlug).toBeNull();
    expect(parsed![0]!.dinnerId).toBeNull();
  });

  it('ignores day params beyond the derived range and fills missing days as empty', () => {
    const params = new URLSearchParams({
      from: '2026-09-01',
      to: '2026-09-02',
      d1: 'x',
      d9: 'ignored',
    });
    const parsed = parseTripParams(params, 6)!;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.stopIds).toEqual([]);
    expect(parsed[1]!.stopIds).toEqual(['x']);
  });
});
