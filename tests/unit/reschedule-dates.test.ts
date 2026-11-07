import { describe, expect, it } from 'vitest';
import {
  isAwaitingDisruptionChoice,
  pickRescheduleDates,
  rescheduleAvailabilityUrl,
  rescheduleOutcome,
  wasRescheduled,
  type AvailabilitySlot,
} from '@/lib/booking/reschedule-dates';
import { formatTripDate } from '@/lib/i18n/format';

const OPT = 'opt-standard';
const OTHER = 'opt-private';

function slot(over: Partial<AvailabilitySlot> = {}): AvailabilitySlot {
  return {
    occurrenceId: 'occ-1',
    activityOptionId: OPT,
    startsAt: '2026-08-01T08:00:00.000Z',
    seatsLeft: 10,
    status: 'open',
    ...over,
  };
}

describe('pickRescheduleDates', () => {
  it('offers only dates on the booking’s own option', () => {
    const out = pickRescheduleDates(
      [
        slot({ occurrenceId: 'a', startsAt: '2026-08-01T08:00:00.000Z' }),
        slot({ occurrenceId: 'b', startsAt: '2026-08-02T08:00:00.000Z', activityOptionId: OTHER }),
      ],
      { activityOptionId: OPT, unitsNeeded: 2 },
    );
    expect(out.map((d) => d.occurrenceId)).toEqual(['a']);
  });

  it('measures need in booking UNITS, so a 6-guest van still fits a 1-seat day', () => {
    // A vehicle/private booking is quantity 1 (one van, one trip) with the headcount in pax, and
    // seatsLeft counts those same units. Filtering on the headcount would hide every date with fewer
    // than 6 vans free — including empty ones — for a booking that only ever consumed one.
    const out = pickRescheduleDates([slot({ occurrenceId: 'van-day', seatsLeft: 1 })], {
      activityOptionId: OPT,
      unitsNeeded: 1,
    });
    expect(out.map((d) => d.occurrenceId)).toEqual(['van-day']);
  });

  it('requires room for the WHOLE booking, not just one seat', () => {
    const out = pickRescheduleDates(
      [
        slot({ occurrenceId: 'tight', startsAt: '2026-08-01T08:00:00.000Z', seatsLeft: 3 }),
        slot({ occurrenceId: 'roomy', startsAt: '2026-08-02T08:00:00.000Z', seatsLeft: 4 }),
      ],
      { activityOptionId: OPT, unitsNeeded: 4 },
    );
    // seatsLeft 3 < party 4 — offering it would just earn an insufficient_capacity rejection.
    expect(out.map((d) => d.occurrenceId)).toEqual(['roomy']);
  });

  it('treats 0 or NaN units as needing one slot', () => {
    const slots = [slot({ occurrenceId: 'a', seatsLeft: 1 })];
    expect(pickRescheduleDates(slots, { activityOptionId: OPT, unitsNeeded: 0 })).toHaveLength(1);
    expect(pickRescheduleDates(slots, { activityOptionId: OPT, unitsNeeded: NaN })).toHaveLength(1);
    expect(
      pickRescheduleDates([slot({ seatsLeft: 0 })], { activityOptionId: OPT, unitsNeeded: 0 }),
    ).toHaveLength(0);
  });

  it('excludes the date the booking is already on', () => {
    const out = pickRescheduleDates(
      [
        slot({ occurrenceId: 'current', startsAt: '2026-08-01T08:00:00.000Z' }),
        slot({ occurrenceId: 'other', startsAt: '2026-08-02T08:00:00.000Z' }),
      ],
      { activityOptionId: OPT, unitsNeeded: 2, excludeOccurrenceId: 'current' },
    );
    expect(out.map((d) => d.occurrenceId)).toEqual(['other']);
  });

  it('skips anything not open', () => {
    const out = pickRescheduleDates(
      [
        slot({ occurrenceId: 'off', status: 'cancelled' }),
        slot({ occurrenceId: 'shut', startsAt: '2026-08-02T08:00:00.000Z', status: 'closed' }),
        slot({ occurrenceId: 'ok', startsAt: '2026-08-03T08:00:00.000Z' }),
      ],
      { activityOptionId: OPT, unitsNeeded: 1 },
    );
    expect(out.map((d) => d.occurrenceId)).toEqual(['ok']);
  });

  it('returns one entry per calendar day, earliest first', () => {
    const out = pickRescheduleDates(
      [
        slot({ occurrenceId: 'late', startsAt: '2026-08-05T08:00:00.000Z' }),
        slot({ occurrenceId: 'early-am', startsAt: '2026-08-01T06:00:00.000Z' }),
        slot({ occurrenceId: 'early-pm', startsAt: '2026-08-01T14:00:00.000Z' }),
      ],
      { activityOptionId: OPT, unitsNeeded: 1 },
    );
    expect(out.map((d) => d.occurrenceId)).toEqual(['early-am', 'late']);
  });

  it('honours the limit', () => {
    const slots = Array.from({ length: 20 }, (_, i) =>
      slot({
        occurrenceId: `o${i}`,
        startsAt: `2026-08-${String(i + 1).padStart(2, '0')}T08:00:00.000Z`,
      }),
    );
    expect(
      pickRescheduleDates(slots, { activityOptionId: OPT, unitsNeeded: 1, limit: 8 }),
    ).toHaveLength(8);
  });

  it('offers nothing when the booking has no option (a DTO gap must not become a wrong date)', () => {
    expect(pickRescheduleDates([slot()], { activityOptionId: null, unitsNeeded: 1 })).toEqual([]);
    expect(pickRescheduleDates([slot()], { activityOptionId: undefined, unitsNeeded: 1 })).toEqual(
      [],
    );
  });
});

describe('rescheduleAvailabilityUrl', () => {
  it('spans today to the horizon and escapes the slug', () => {
    const url = rescheduleAvailabilityUrl('sunset cruise/2', new Date(2026, 6, 20));
    expect(url).toContain('/api/v1/activities/sunset%20cruise%2F2/availability');
    expect(url).toContain('from=2026-07-20');
    expect(url).toContain('to=2027-01-16'); // 20 Jul 2026 + 180 days
  });
});

describe('isAwaitingDisruptionChoice', () => {
  it('is true only for a disruption the guest has not resolved', () => {
    expect(isAwaitingDisruptionChoice(null)).toBe(false);
    expect(isAwaitingDisruptionChoice(undefined)).toBe(false);
    expect(isAwaitingDisruptionChoice({ resolvedAt: null })).toBe(true);
    expect(isAwaitingDisruptionChoice({})).toBe(true);
    expect(isAwaitingDisruptionChoice({ resolvedAt: '2026-07-20T10:00:00Z' })).toBe(false);
  });
});

describe('wasRescheduled', () => {
  it('is true only once the guest answered a call-off by moving', () => {
    expect(wasRescheduled(null)).toBe(false);
    expect(wasRescheduled({ resolvedAt: null, resolution: null })).toBe(false);
    expect(wasRescheduled({ resolvedAt: '2026-11-07T10:00:00Z', resolution: 'refunded' })).toBe(
      false,
    );
    expect(wasRescheduled({ resolvedAt: '2026-11-07T10:00:00Z', resolution: 'rescheduled' })).toBe(
      true,
    );
  });
});

describe('rescheduleOutcome', () => {
  it('names the new date and the old one from the server answer', () => {
    expect(
      rescheduleOutcome(
        { startsAt: '2026-11-15T12:00:00Z', previousStartsAt: '2026-11-08T12:00:00Z' },
        '2026-11-14T12:00:00Z',
      ),
    ).toEqual({ kind: 'moved', to: '2026-11-15T12:00:00Z', from: '2026-11-08T12:00:00Z' });
  });

  it('still says "moved" when the server did not know the old date', () => {
    expect(rescheduleOutcome({ startsAt: '2026-11-15T12:00:00Z' })).toEqual({
      kind: 'moved',
      to: '2026-11-15T12:00:00Z',
      from: null,
    });
  });

  it('never calls an idempotent replay a move (that answer carries no date)', () => {
    expect(rescheduleOutcome({ alreadyOnDate: true }, '2026-11-15T12:00:00Z')).toEqual({
      kind: 'same',
      to: '2026-11-15T12:00:00Z',
    });
  });

  it('announces nothing when no real date is known', () => {
    expect(rescheduleOutcome(null)).toBeNull();
    expect(rescheduleOutcome({ alreadyOnDate: true })).toBeNull();
    expect(rescheduleOutcome({ startsAt: 'not a date' })).toBeNull();
  });
});

describe('formatTripDate', () => {
  it('reads the day on the island clock, not the browser clock', () => {
    // 21:30 UTC on the 14th is already 01:30 on the 15th in Mauritius (UTC+4).
    expect(formatTripDate('2026-11-14T21:30:00Z', 'en')).toBe('Sun, 15 Nov 2026');
    // A noon-UTC day slot stays on its own day.
    expect(formatTripDate('2026-11-08T12:00:00Z', 'en')).toBe('Sun, 8 Nov 2026');
  });

  it('speaks French to a French visitor', () => {
    expect(formatTripDate('2026-11-08T12:00:00Z', 'fr')).toBe('dim. 8 nov. 2026');
  });

  it('returns an empty string for a value that is not a date', () => {
    expect(formatTripDate('nope', 'en')).toBe('');
  });
});
