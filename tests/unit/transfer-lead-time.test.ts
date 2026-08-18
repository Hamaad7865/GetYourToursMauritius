import { describe, expect, it } from 'vitest';
import {
  earliestBookableDay,
  returnBeforeArrival,
  returnTimeBeforeArrival,
} from '../../src/lib/transfers/lead-time';

describe('earliestBookableDay', () => {
  it('adds the advance-days floor to today', () => {
    expect(earliestBookableDay('2026-08-18', 0)).toBe('2026-08-18'); // same-day allowed
    expect(earliestBookableDay('2026-08-18', 1)).toBe('2026-08-19'); // default: tomorrow, no same-day
    expect(earliestBookableDay('2026-08-18', 2)).toBe('2026-08-20'); // the reported case (needs a driver)
  });

  it('rolls over month and year boundaries', () => {
    expect(earliestBookableDay('2026-08-30', 3)).toBe('2026-09-02');
    expect(earliestBookableDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('treats a negative or non-finite lead as no floor (never before today)', () => {
    expect(earliestBookableDay('2026-08-18', -5)).toBe('2026-08-18');
    expect(earliestBookableDay('2026-08-18', Number.NaN)).toBe('2026-08-18');
  });

  it('returns a malformed input unchanged rather than throwing', () => {
    expect(earliestBookableDay('', 2)).toBe('');
    expect(earliestBookableDay('not-a-date', 2)).toBe('not-a-date');
  });
});

describe('returnBeforeArrival', () => {
  it('flags a return strictly before arrival', () => {
    expect(returnBeforeArrival('2026-08-20', '2026-08-19')).toBe(true);
  });

  it('accepts same-day or later returns', () => {
    expect(returnBeforeArrival('2026-08-20', '2026-08-20')).toBe(false);
    expect(returnBeforeArrival('2026-08-20', '2026-08-25')).toBe(false);
  });

  it('is never invalid while a side is still empty', () => {
    expect(returnBeforeArrival('2026-08-20', '')).toBe(false);
    expect(returnBeforeArrival('', '2026-08-19')).toBe(false);
  });
});

describe('returnTimeBeforeArrival', () => {
  it('flags a same-day pickup strictly before the arrival time (the reported case)', () => {
    expect(returnTimeBeforeArrival('2026-08-20', '2026-08-20', '14:55', '11:55')).toBe(true);
  });

  it('accepts a same-day pickup at or after the arrival time', () => {
    expect(returnTimeBeforeArrival('2026-08-20', '2026-08-20', '14:55', '14:55')).toBe(false);
    expect(returnTimeBeforeArrival('2026-08-20', '2026-08-20', '14:55', '18:00')).toBe(false);
  });

  it('never flags a DIFFERENT-day return regardless of the clock', () => {
    expect(returnTimeBeforeArrival('2026-08-20', '2026-08-21', '14:55', '06:00')).toBe(false);
  });

  it('is never invalid while a date or time is still empty', () => {
    expect(returnTimeBeforeArrival('', '2026-08-20', '14:55', '11:55')).toBe(false);
    expect(returnTimeBeforeArrival('2026-08-20', '2026-08-20', '', '11:55')).toBe(false);
    expect(returnTimeBeforeArrival('2026-08-20', '2026-08-20', '14:55', '')).toBe(false);
  });
});
