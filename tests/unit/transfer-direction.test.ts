import { describe, expect, it } from 'vitest';
import {
  anchorLeg,
  directionsSharingAnchor,
  legDates,
  parseTransferDirection,
  reservedDay,
  restoreDirection,
  transferLegParams,
  tripTypeForDirection,
} from '../../src/lib/transfers/direction';
import { checkoutHref } from '@/lib/cart/checkout-href';
import type { CartItem } from '@/lib/cart/useCart';

// The day-slot a transfer holds must be the day the guest travels. On prod (2026-10-17) both
// departure-only bookings held a slot on the widget's day (2026-10-09) while the guest left on
// 2026-10-15 (BMT61C672F6CC1B6, BMT128D90D2935B0): the widget only knew "arrival", and checkout let
// the guest switch to Departure and type a different date that never moved the occurrence.

describe('parseTransferDirection', () => {
  it('takes a valid tripDirection param as-is', () => {
    expect(parseTransferDirection('departure', 'one_way')).toBe('departure');
    expect(parseTransferDirection('arrival', 'return')).toBe('arrival');
    expect(parseTransferDirection('return', 'one_way')).toBe('return');
  });

  it('falls back to the legacy tripType (older URLs and cart lines)', () => {
    expect(parseTransferDirection(null, 'return')).toBe('return');
    expect(parseTransferDirection(null, 'one_way')).toBe('arrival');
    expect(parseTransferDirection('sideways', 'return')).toBe('return');
    expect(parseTransferDirection(undefined, undefined)).toBe('arrival');
  });
});

describe('tripTypeForDirection / anchorLeg', () => {
  it('prices only a return as two legs', () => {
    expect(tripTypeForDirection('arrival')).toBe('one_way');
    expect(tripTypeForDirection('departure')).toBe('one_way');
    expect(tripTypeForDirection('return')).toBe('return');
  });

  it('anchors a departure-only trip on the hotel pickup, everything else on the arrival', () => {
    expect(anchorLeg('departure')).toBe('departure');
    expect(anchorLeg('arrival')).toBe('arrival');
    expect(anchorLeg('return')).toBe('arrival');
  });

  it('lets checkout offer only directions that keep the reserved day', () => {
    expect(directionsSharingAnchor('departure')).toEqual(['departure']);
    expect(directionsSharingAnchor('arrival')).toEqual(['arrival', 'return']);
    expect(directionsSharingAnchor('return')).toEqual(['arrival', 'return']);
  });
});

describe('transferLegParams → reservedDay round-trip', () => {
  it('departure: the pickup date rides as retDate, with no arrDate, and is the reserved day', () => {
    const q = transferLegParams({
      direction: 'departure',
      date: '2026-10-15',
      time: '09:30',
      returnDate: '',
      returnTime: '',
    });
    expect(q).toEqual({
      tripDirection: 'departure',
      tripType: 'one_way',
      retDate: '2026-10-15',
      retTime: '09:30',
    });
    const dir = parseTransferDirection(q.tripDirection, q.tripType);
    expect(reservedDay({ direction: dir, arrDate: q.arrDate, retDate: q.retDate })).toBe(
      '2026-10-15',
    );
  });

  it('arrival: the arrival date rides as arrDate and is the reserved day', () => {
    const q = transferLegParams({
      direction: 'arrival',
      date: '2026-10-09',
      time: '16:00',
      returnDate: '2026-10-15',
      returnTime: '10:00',
    });
    expect(q).toEqual({
      tripDirection: 'arrival',
      tripType: 'one_way',
      arrDate: '2026-10-09',
      arr: '16:00',
    });
    expect(reservedDay({ direction: 'arrival', arrDate: q.arrDate, retDate: q.retDate })).toBe(
      '2026-10-09',
    );
  });

  it('return: both legs ride; the arrival is the reserved day', () => {
    const q = transferLegParams({
      direction: 'return',
      date: '2026-10-09',
      time: '16:00',
      returnDate: '2026-10-15',
      returnTime: '10:00',
    });
    expect(q).toEqual({
      tripDirection: 'return',
      tripType: 'return',
      arrDate: '2026-10-09',
      arr: '16:00',
      retDate: '2026-10-15',
      retTime: '10:00',
    });
    expect(reservedDay({ direction: 'return', arrDate: q.arrDate, retDate: q.retDate })).toBe(
      '2026-10-09',
    );
  });

  it('omits empty times rather than sending blanks', () => {
    expect(
      transferLegParams({
        direction: 'departure',
        date: '2026-10-15',
        time: '',
        returnDate: '',
        returnTime: '',
      }),
    ).toEqual({ tripDirection: 'departure', tripType: 'one_way', retDate: '2026-10-15' });
  });

  it('a departure cart line keeps its direction and day through the cart', () => {
    const checkoutParams = {
      transfer: '1',
      dropoffSlug: 'lux-belle-mare',
      ...transferLegParams({
        direction: 'departure',
        date: '2026-10-15',
        time: '09:30',
        returnDate: '',
        returnTime: '',
      }),
    };
    const item: CartItem = {
      id: 'occ15:transfer',
      slug: 'airport-transfer',
      title: 'Airport transfer from LUX* Belle Mare',
      image: null,
      occurrenceId: 'occ15',
      dateLabel: '15 Oct 2026',
      lang: 'en',
      priceLabel: 'Transfer',
      guests: 2,
      unitEur: 55,
      pricingMode: 'vehicle',
      maxGuests: null,
      seatsLeft: 2,
      unit: 'per transfer',
      addedAt: 0,
      status: 'held',
      idemKey: 'idem-15',
      checkoutParams,
    };
    const q = new URL(checkoutHref(item), 'https://example.test').searchParams;
    const dir = parseTransferDirection(q.get('tripDirection'), q.get('tripType'));
    expect(dir).toBe('departure');
    expect(
      reservedDay({ direction: dir, arrDate: q.get('arrDate'), retDate: q.get('retDate') }),
    ).toBe('2026-10-15');
  });
});

describe('legDates — what checkout shows and sends', () => {
  it('pins the departure-only pickup to the reserved day, whatever the editable leg holds', () => {
    expect(
      legDates({ direction: 'departure', reservedDay: '2026-10-15', returnLegDate: '2026-10-20' }),
    ).toEqual({ arrivalDate: '', departureDate: '2026-10-15' });
  });

  it('pins the arrival to the reserved day; a lone arrival has no departure leg', () => {
    expect(
      legDates({ direction: 'arrival', reservedDay: '2026-10-09', returnLegDate: '2026-10-15' }),
    ).toEqual({ arrivalDate: '2026-10-09', departureDate: '' });
  });

  it('keeps the return leg of a return trip editable (it does not bind the slot)', () => {
    expect(
      legDates({ direction: 'return', reservedDay: '2026-10-09', returnLegDate: '2026-10-15' }),
    ).toEqual({ arrivalDate: '2026-10-09', departureDate: '2026-10-15' });
  });
});

describe('restoreDirection — a checkout draft may not move the reserved day', () => {
  it('restores a saved direction that shares the anchor', () => {
    expect(restoreDirection('return', 'arrival')).toBe('return');
    expect(restoreDirection('arrival', 'return')).toBe('arrival');
    expect(restoreDirection('departure', 'departure')).toBe('departure');
  });

  it('ignores a saved direction that would flip the anchor (the old prod bug path)', () => {
    expect(restoreDirection('departure', 'arrival')).toBe('arrival');
    expect(restoreDirection('departure', 'return')).toBe('return');
    expect(restoreDirection('arrival', 'departure')).toBe('departure');
    expect(restoreDirection('return', 'departure')).toBe('departure');
  });

  it('keeps the URL direction when nothing was saved', () => {
    expect(restoreDirection(undefined, 'departure')).toBe('departure');
  });
});
