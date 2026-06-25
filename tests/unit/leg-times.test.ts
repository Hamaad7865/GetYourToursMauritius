import { describe, expect, it } from 'vitest';
import { addMinutesLocal, transferLegs, AIRPORT_DRIVE_MINUTES } from '@/lib/transfers/leg-times';

describe('addMinutesLocal', () => {
  it('adds minutes within the same day', () => {
    expect(addMinutesLocal('2026-06-28', '20:13', 60)).toEqual({ ymd: '2026-06-28', hhmm: '21:13' });
  });

  it('rolls over midnight to the next day', () => {
    expect(addMinutesLocal('2026-06-28', '23:40', 60)).toEqual({ ymd: '2026-06-29', hhmm: '00:40' });
  });

  it('handles end-of-month rollover', () => {
    expect(addMinutesLocal('2026-06-30', '23:30', 60)).toEqual({ ymd: '2026-07-01', hhmm: '00:30' });
  });

  it('returns null on malformed input', () => {
    expect(addMinutesLocal('', '20:13', 60)).toBeNull();
    expect(addMinutesLocal('2026-06-28', 'nope', 60)).toBeNull();
    expect(addMinutesLocal('28/06/2026', '20:13', 60)).toBeNull();
  });
});

describe('transferLegs', () => {
  it('arrival booking → one inbound leg with an estimated drop-off (pickup + 60)', () => {
    const legs = transferLegs({
      direction: 'arrival',
      serviceDateIso: '2026-06-28T08:00:00.000Z', // noon Mauritius → 28 Jun
      arrivalTime: '20:13',
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      kind: 'arrival',
      pickupYmd: '2026-06-28',
      pickupTime: '20:13',
      dropoffYmd: '2026-06-28',
      dropoffTime: '21:13',
    });
  });

  it('departure booking → one outbound leg from returnDate/returnTime', () => {
    const legs = transferLegs({
      direction: 'departure',
      returnDate: '2026-07-05',
      returnTime: '09:30',
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      kind: 'departure',
      pickupYmd: '2026-07-05',
      pickupTime: '09:30',
      dropoffTime: '10:30',
    });
  });

  it('return booking → both legs', () => {
    const legs = transferLegs({
      direction: 'return',
      serviceDateIso: '2026-06-28T08:00:00.000Z',
      arrivalTime: '20:13',
      returnDate: '2026-07-05',
      returnTime: '09:30',
    });
    expect(legs.map((l) => l.kind)).toEqual(['arrival', 'departure']);
  });

  it('skips a leg whose date/time is missing', () => {
    expect(transferLegs({ direction: 'arrival', serviceDateIso: null, arrivalTime: '20:13' })).toHaveLength(0);
    expect(transferLegs({ direction: 'return', serviceDateIso: '2026-06-28T08:00:00Z', arrivalTime: '20:13' })).toHaveLength(1);
  });

  it('the default drive estimate is the airport-transfer duration', () => {
    expect(AIRPORT_DRIVE_MINUTES).toBe(60);
  });
});
