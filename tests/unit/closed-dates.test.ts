import { describe, expect, it } from 'vitest';
import {
  formatDayRange,
  groupIntoRanges,
  mauritiusDay,
  normaliseClosedRange,
  slotStartUtc,
} from '@/lib/admin/closed-dates';

describe('closed-dates helpers', () => {
  it('groups days into consecutive runs, across a month end', () => {
    expect(
      groupIntoRanges(['2026-12-01', '2026-11-29', '2026-11-30', '2026-12-05', '2026-11-30']),
    ).toEqual([
      { from: '2026-11-29', to: '2026-12-01', days: 3 },
      { from: '2026-12-05', to: '2026-12-05', days: 1 },
    ]);
  });

  it('puts a slot at 12:00 Mauritius and reads Mauritius days at the +04:00 boundary', () => {
    expect(slotStartUtc('2026-11-30')).toBe('2026-11-30T08:00:00.000Z');
    expect(mauritiusDay('2026-11-29T19:59:59Z')).toBe('2026-11-29');
    expect(mauritiusDay('2026-11-29T20:00:00Z')).toBe('2026-11-30');
  });

  it('clamps a past start to today and rejects bad ranges', () => {
    expect(normaliseClosedRange('2026-11-20', '2026-11-29', '2026-11-24')).toEqual({
      from: '2026-11-24',
      to: '2026-11-29',
    });
    expect(() => normaliseClosedRange('2026-11-29', '2026-11-24', '2026-11-24')).toThrow();
    expect(() => normaliseClosedRange('2026-11-01', '2026-11-23', '2026-11-24')).toThrow();
    expect(() => normaliseClosedRange('2026-02-30', '2026-03-01', '2026-01-01')).toThrow();
    expect(() => normaliseClosedRange('2026-11-24', '2028-01-01', '2026-11-24')).toThrow();
  });

  it('formats a range compactly', () => {
    const today = '2026-11-24';
    expect(formatDayRange({ from: '2026-11-24', to: '2026-11-29' }, today)).toBe(
      'Tue 24 – Sun 29 Nov',
    );
    expect(formatDayRange({ from: '2026-11-30', to: '2026-11-30' }, today)).toBe('Mon 30 Nov');
    expect(formatDayRange({ from: '2026-12-28', to: '2027-01-03' }, today)).toBe(
      'Mon 28 Dec – Sun 3 Jan 2027',
    );
  });
});
