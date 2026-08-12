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
