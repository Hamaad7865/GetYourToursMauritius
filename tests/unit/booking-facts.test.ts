import { describe, expect, it } from 'vitest';
import {
  partyChip,
  paymentCsvLabel,
  paymentPill,
  resolvePickup,
  statusPill,
} from '@/components/admin/BookingFacts';

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

/* Phase 2 of the back-office redesign: ONE status vocabulary on Today, Bookings and the Calendar. */
describe('status and payment chips', () => {
  it('names every booking status the same way on every screen', () => {
    const all = [
      'draft',
      'held',
      'payment_pending',
      'confirmed',
      'completed',
      'cancelled',
      'expired',
      'failed',
      'refund_pending',
      'refunded',
    ] as const;
    expect(all.map((s) => statusPill(s).label)).toEqual([
      'Draft',
      'Seat held',
      'Awaiting payment',
      'Confirmed',
      'Completed',
      'Cancelled',
      'Expired',
      'Failed',
      'Refund pending',
      'Refunded',
    ]);
    expect(statusPill('confirmed').tone).toBe('ok');
    expect(statusPill('cancelled').tone).toBe('bad');
    expect(statusPill('payment_pending').tone).toBe('warn');
  });

  it('reads a payment through paymentView, and a closed never-paid booking as "Not paid"', () => {
    expect(paymentPill('part_paid', 'confirmed')).toEqual({ label: 'Part paid', tone: 'warn' });
    expect(paymentPill('paid', 'confirmed')).toEqual({ label: 'Paid', tone: 'ok' });
    expect(paymentPill('pending', 'expired')).toEqual({ label: 'Not paid', tone: 'neutral' });
    expect(paymentPill('pending', 'payment_pending')).toEqual({
      label: 'Pending',
      tone: 'neutral',
    });
    expect(paymentPill('partially_refunded', 'confirmed').label).toBe('Partly refunded');
    expect(paymentPill('failed', 'payment_pending')).toEqual({ label: 'Failed', tone: 'bad' });
  });

  it('keeps the CSV Payment column byte-identical to what it exported before', () => {
    expect(paymentCsvLabel('partially_refunded', 'confirmed')).toBe('Partially Refunded');
    expect(paymentCsvLabel('refunded', 'refunded')).toBe('Refunded');
    expect(paymentCsvLabel('part_paid', 'confirmed')).toBe('Part paid');
    expect(paymentCsvLabel('pending', 'cancelled')).toBe('Not paid');
    expect(paymentCsvLabel('pending', 'held')).toBe('Pending');
    expect(paymentCsvLabel('paid', 'completed')).toBe('Paid');
    expect(paymentCsvLabel('failed', 'failed')).toBe('Failed');
  });

  it('a party still in checkout wears its booking status; one holding seats, its payment', () => {
    expect(partyChip({ status: 'held', counted: false, payView: 'pending' }).label).toBe(
      'Seat held',
    );
    expect(partyChip({ status: 'payment_pending', counted: false, payView: 'pending' }).label).toBe(
      'Awaiting payment',
    );
    expect(partyChip({ status: 'confirmed', counted: true, payView: 'part_paid' }).label).toBe(
      'Part paid',
    );
  });
});
