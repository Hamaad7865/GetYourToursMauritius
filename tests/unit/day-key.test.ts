import { describe, expect, it } from 'vitest';
import { nominalDayKey, utcDayKey } from '@/lib/services/day-key';

describe('utcDayKey', () => {
  it('keys a noon-UTC slot by its UTC calendar day (the day-shift bug at UTC+12)', () => {
    // Slots are materialized at noon UTC. Under the OLD local-time key, a UTC+12 user would have
    // seen this on 2026-06-21; utcDayKey correctly yields the operator's intended 2026-06-20.
    expect(utcDayKey('2026-06-20T12:00:00Z')).toBe('2026-06-20');
  });
  it('does not roll into the next day across the UTC midnight boundary', () => {
    expect(utcDayKey('2026-06-20T23:00:00Z')).toBe('2026-06-20');
    expect(utcDayKey('2026-06-21T00:00:00Z')).toBe('2026-06-21');
  });
  it('zero-pads month and day', () => {
    expect(utcDayKey('2026-01-05T12:00:00Z')).toBe('2026-01-05');
  });
});

describe('nominalDayKey', () => {
  it('keys a local-constructed calendar cell by its nominal Y/M/D', () => {
    expect(nominalDayKey(new Date(2026, 5, 20))).toBe('2026-06-20'); // month is 0-based
    expect(nominalDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
