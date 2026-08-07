import { describe, expect, it } from 'vitest';
import { proposeSchedule } from '@/lib/quotes/schedule';

/**
 * `proposeSchedule` is the rest-day spacer behind the AI email → draft flow (plan Task A3): given a
 * date window and N excursions, it spaces them `gapDays` apart so a "one rest day between excursions"
 * request lands as day 1 / day 3 / day 5 rather than four tours crammed onto consecutive days. It is
 * pure and best-effort — when the window is too small it places what fits and REPORTS the shortfall so
 * the operator (never the guest) sees it.
 */
describe('proposeSchedule', () => {
  it('spaces excursions gapDays apart within the window (the French-email case)', () => {
    // 2 people, 1–9 Sept, 4 excursions, one rest day between (gap of 2 days).
    const result = proposeSchedule('2026-09-01', '2026-09-09', 4, 2);
    expect(result.dates).toEqual(['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-07']);
    expect(result.requested).toBe(4);
    expect(result.placed).toBe(4);
    expect(result.truncated).toBe(false);
  });

  it('places back-to-back days when the gap is 1', () => {
    const result = proposeSchedule('2026-09-01', '2026-09-09', 3, 1);
    expect(result.dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(result.truncated).toBe(false);
  });

  it('truncates and reports when the window is too small for every excursion', () => {
    // Only 09-01 and 09-03 fit before the window closes on 09-04.
    const result = proposeSchedule('2026-09-01', '2026-09-04', 4, 2);
    expect(result.dates).toEqual(['2026-09-01', '2026-09-03']);
    expect(result.requested).toBe(4);
    expect(result.placed).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('never places two excursions on the same day (gap clamped to at least 1)', () => {
    const result = proposeSchedule('2026-09-01', '2026-09-09', 3, 0);
    expect(new Set(result.dates).size).toBe(result.dates.length);
    expect(result.dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('with no upper bound places every excursion (unbounded window)', () => {
    const result = proposeSchedule('2026-09-01', null, 3, 2);
    expect(result.dates).toEqual(['2026-09-01', '2026-09-03', '2026-09-05']);
    expect(result.truncated).toBe(false);
  });

  it('returns nothing when there is no start date', () => {
    const result = proposeSchedule(null, '2026-09-09', 4, 2);
    expect(result.dates).toEqual([]);
    expect(result.placed).toBe(0);
    expect(result.truncated).toBe(true);
  });

  it('returns nothing for zero excursions', () => {
    const result = proposeSchedule('2026-09-01', '2026-09-09', 0, 2);
    expect(result.dates).toEqual([]);
    expect(result.requested).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('reports truncation when the window ends before it starts', () => {
    const result = proposeSchedule('2026-09-09', '2026-09-01', 2, 2);
    expect(result.dates).toEqual([]);
    expect(result.truncated).toBe(true);
  });
});
