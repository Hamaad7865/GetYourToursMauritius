import { describe, expect, it } from 'vitest';
import {
  departureClock,
  occurrenceDepartureTime,
  tourDepartureTime,
} from '@/lib/catalogue/departure-time';

/* Every catalogue day-slot is materialised at a placeholder clock time (noon, or 16:00 on slots made
 * before the July timezone fix), so a tour's real departure is the start time staff typed on the
 * activity or its option — free text like "09:00", "07 00" or "09:00 - 17:00". These pin how that text
 * becomes the "HH:MM" every booking surface prints. */

describe('departureClock', () => {
  it.each([
    ['09:00', '09:00'],
    ['9:00', '09:00'],
    ['  07:15 ', '07:15'],
    ['07 00', '07:00'],
    ['7.30', '07:30'],
    ['07h30', '07:30'],
    ['16:00', '16:00'],
    ['09:00 - 17:00', '09:00'],
    ['08:00–12:00', '08:00'],
    ['9am', '09:00'],
    ['9:30 am', '09:30'],
    ['2pm', '14:00'],
    ['12pm', '12:00'],
    ['12:15am', '00:15'],
    // Only a full "am"/"pm" is a meridiem — the "a" of a trailing word must not turn 17:00 invalid.
    ['17:00 approx', '17:00'],
    // How Postgres returns a `time` column (session_occurrences.departure_time).
    ['08:00:00', '08:00'],
  ])('reads %j as %j', (text, expected) => {
    expect(departureClock(text)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', 'Flexible', 'TBC', 'Morning', '25:00', '09:75', '0900'])(
    'reads %j as no time',
    (text) => {
      expect(departureClock(text)).toBeNull();
    },
  );
});

describe('tourDepartureTime', () => {
  it("uses the option's own start time first — a Half day and a Full day can leave at different times", () => {
    expect(tourDepartureTime('16:00', '09:00')).toBe('16:00');
  });

  it("falls back to the activity's start time when the option has none", () => {
    expect(tourDepartureTime(null, '09:00')).toBe('09:00');
    expect(tourDepartureTime('  ', '09:00')).toBe('09:00');
  });

  it("does not borrow the activity's time when the option says something that is not a time", () => {
    // Mirrors the public "at a glance" facts, where the option's text wins outright.
    expect(tourDepartureTime('Flexible', '09:00')).toBeNull();
  });

  it('is null when neither carries a start time', () => {
    expect(tourDepartureTime(null, null)).toBeNull();
    expect(tourDepartureTime(undefined, '')).toBeNull();
  });
});

describe('occurrenceDepartureTime', () => {
  it('lets the time staff set for one departure win over the tour’s start time', () => {
    expect(occurrenceDepartureTime('08:15:00', '16:00', '09:00')).toBe('08:15');
  });

  it("falls back to the tour's start time when the departure has none of its own", () => {
    expect(occurrenceDepartureTime(null, '16:00', '09:00')).toBe('16:00');
    expect(occurrenceDepartureTime(undefined, null, '09:00')).toBe('09:00');
    expect(occurrenceDepartureTime(null, null, null)).toBeNull();
  });
});
