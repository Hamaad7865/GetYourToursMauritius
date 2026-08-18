import { describe, expect, it } from 'vitest';
import { resolvePickup } from '@/components/admin/BookingFacts';

/* The day sheet and the bookings drawer brief the same driver about the same pickup, so they resolve
 * it through this one pure function. The bug it fixes: a quote-converted booking carries its hotel only
 * on the line's round-trip transfer, so the booking's own pickup is null — and the day sheet rendered
 * "No pickup · customer makes own way" and "Drop-off: —" directly beside a "Round-trip transfer" line. */
describe('resolvePickup', () => {
  const base = { pickupLocation: null, dropoffLocation: null, pickupPending: false };

  it('reads a round-trip transport add-on AS the pickup, drop-off same as pickup', () => {
    const r = resolvePickup({
      ...base,
      transportPickup: 'Coastal Road, Quatre Cocos 41601, Mauritius',
      transportDropoff: null,
    });
    expect(r.pickup).toEqual({
      kind: 'text',
      text: 'Coastal Road, Quatre Cocos 41601, Mauritius',
      roundTrip: true,
    });
    expect(r.dropoff).toEqual({ kind: 'same' });
  });

  it('reads no pickup and no transfer as make-own-way / dash', () => {
    const r = resolvePickup({ ...base });
    expect(r.pickup).toEqual({ kind: 'none' });
    expect(r.dropoff).toEqual({ kind: 'dash' });
  });

  it('keeps an explicit booking pickup, and its own distinct drop-off, over a transfer', () => {
    const r = resolvePickup({
      ...base,
      pickupLocation: 'Hotel Ambre, Belle Mare',
      dropoffLocation: 'SSR Airport',
      transportPickup: 'somewhere else',
    });
    expect(r.pickup).toEqual({ kind: 'text', text: 'Hotel Ambre, Belle Mare', roundTrip: false });
    expect(r.dropoff).toEqual({ kind: 'text', text: 'SSR Airport' });
  });

  it('an explicit pickup with a null drop-off means same as pickup, not a dash', () => {
    const r = resolvePickup({ ...base, pickupLocation: 'Hotel Ambre' });
    expect(r.pickup).toEqual({ kind: 'text', text: 'Hotel Ambre', roundTrip: false });
    expect(r.dropoff).toEqual({ kind: 'same' });
  });

  it('a pending pickup reads "to be arranged", drop-off same as pickup', () => {
    const r = resolvePickup({ ...base, pickupPending: true });
    expect(r.pickup).toEqual({ kind: 'pending' });
    expect(r.dropoff).toEqual({ kind: 'same' });
  });

  it('honours a round trip that names its own distinct drop-off', () => {
    const r = resolvePickup({
      ...base,
      transportPickup: 'Hotel A',
      transportDropoff: 'Hotel B',
    });
    expect(r.pickup).toEqual({ kind: 'text', text: 'Hotel A', roundTrip: true });
    expect(r.dropoff).toEqual({ kind: 'text', text: 'Hotel B' });
  });
});

/* Airport transfers are stored ARRIVAL-oriented (checkout hardcodes pickup = "SSR … (arrivals)",
 * drop-off = the hotel) for EVERY direction. For a DEPARTURE that reads backwards — the day sheet told
 * the operator to collect the guest at airport arrivals when the guest is at their hotel waiting to be
 * driven TO the airport. The reading must flip for a departure. */
describe('resolvePickup — airport-transfer direction', () => {
  const airport = 'SSR International Airport (arrivals)';
  const stored = {
    pickupLocation: airport,
    dropoffLocation: 'Lagoon Attitude',
    pickupPending: false,
  };

  it('flips a DEPARTURE to hotel → airport (departures), not the stored arrival orientation', () => {
    const r = resolvePickup({ ...stored, transferDirection: 'departure' });
    expect(r.pickup).toEqual({ kind: 'text', text: 'Lagoon Attitude', roundTrip: false });
    expect(r.dropoff).toEqual({ kind: 'text', text: 'SSR International Airport (departures)' });
  });

  it('leaves an ARRIVAL in its stored airport → hotel orientation', () => {
    const r = resolvePickup({ ...stored, transferDirection: 'arrival' });
    expect(r.pickup).toEqual({ kind: 'text', text: airport, roundTrip: false });
    expect(r.dropoff).toEqual({ kind: 'text', text: 'Lagoon Attitude' });
  });

  it('leaves a RETURN unchanged (it genuinely begins at the airport; shown as both-ways elsewhere)', () => {
    const r = resolvePickup({ ...stored, transferDirection: 'return' });
    expect(r.pickup).toEqual({ kind: 'text', text: airport, roundTrip: false });
    expect(r.dropoff).toEqual({ kind: 'text', text: 'Lagoon Attitude' });
  });

  it('a departure with no stored hotel still points the drop-off at departures, never a false airport pickup', () => {
    const r = resolvePickup({
      pickupLocation: airport,
      dropoffLocation: null,
      pickupPending: false,
      transferDirection: 'departure',
    });
    expect(r.pickup).toEqual({ kind: 'none' });
    expect(r.dropoff).toEqual({ kind: 'text', text: 'SSR International Airport (departures)' });
  });
});
