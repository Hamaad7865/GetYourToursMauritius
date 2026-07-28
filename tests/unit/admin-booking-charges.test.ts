import { describe, expect, it } from 'vitest';
import { bookingExtraCharges } from '@/lib/admin/bookings';
import type { BookingItemRow, BookingRow } from '@/lib/admin/bookings';

function item(over: Partial<BookingItemRow> = {}): BookingItemRow {
  return {
    priceLabel: 'Private Group up to 4 persons',
    quantity: 1,
    pax: 2,
    unitAmountEur: 700,
    subtotalEur: 700,
    activityTitle: 'Private Full Day Catamaran Ile Aux Cerfs',
    optionName: 'Private Group up to 4 persons',
    startsAt: '2026-08-18T05:00:00Z',
    ...over,
  };
}

function booking(over: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 'id',
    ref: 'BMT781204A71D0C6',
    status: 'confirmed',
    paymentState: 'paid',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@x.com',
    customerPhone: null,
    source: 'web',
    currency: 'EUR',
    totalEur: 700,
    notes: null,
    createdAt: '2026-07-28T05:31:00Z',
    items: [item()],
    activityTitle: 'Private Full Day Catamaran Ile Aux Cerfs',
    startsAt: '2026-08-18T05:00:00Z',
    guests: 2,
    netPaidEur: 700,
    grossPaidEur: 700,
    refundedEur: 0,
    customItinerary: null,
    pickupLocation: null,
    dropoffLocation: null,
    pickupPending: false,
    childSeats: 0,
    transportEur: 0,
    transfer: null,
    ...over,
  };
}

describe('bookingExtraCharges', () => {
  it('has no lines when the items already add up to the total', () => {
    expect(bookingExtraCharges(booking())).toEqual([]);
  });

  // The live booking that exposed this: €700 item + €30 transport = a €730 total the drawer
  // could not explain, because transport_minor has no booking_items row.
  it('explains a transport add-on that lives outside booking_items', () => {
    const charges = bookingExtraCharges(booking({ totalEur: 730, transportEur: 30 }));
    expect(charges).toEqual([{ label: 'Door-to-door transport', amountEur: 30 }]);
  });

  it('explains the child-seat extra (first seat free, €6 each after)', () => {
    const charges = bookingExtraCharges(booking({ totalEur: 712, childSeats: 3 }));
    expect(charges).toEqual([{ label: 'Child seats (3)', amountEur: 12 }]);
  });

  it('omits a child-seat line when the only seat is the free one', () => {
    expect(bookingExtraCharges(booking({ childSeats: 1 }))).toEqual([]);
  });

  it('lists transport and child seats together, transport first', () => {
    const charges = bookingExtraCharges(
      booking({ totalEur: 742, transportEur: 30, childSeats: 3 }),
    );
    expect(charges).toEqual([
      { label: 'Door-to-door transport', amountEur: 30 },
      { label: 'Child seats (3)', amountEur: 12 },
    ]);
  });

  // The guard: a total we cannot attribute must show up as a line rather than silently
  // inflate the Total — that invisibility is the bug this helper exists to prevent.
  it('surfaces an unattributed remainder instead of hiding it', () => {
    const charges = bookingExtraCharges(booking({ totalEur: 745, transportEur: 30 }));
    expect(charges).toEqual([
      { label: 'Door-to-door transport', amountEur: 30 },
      { label: 'Unaccounted', amountEur: 15 },
    ]);
  });

  it('surfaces a negative remainder too (a discount the drawer does not model)', () => {
    const charges = bookingExtraCharges(booking({ totalEur: 650 }));
    expect(charges).toEqual([{ label: 'Unaccounted', amountEur: -50 }]);
  });

  it('does not invent a remainder from cent-level float drift', () => {
    const charges = bookingExtraCharges(
      booking({
        totalEur: 100.1,
        items: [item({ subtotalEur: 33.37 }), item({ subtotalEur: 66.73 })],
      }),
    );
    expect(charges).toEqual([]);
  });

  it('sums every item line before deciding a total is unexplained', () => {
    const charges = bookingExtraCharges(
      booking({
        totalEur: 730,
        transportEur: 30,
        items: [item({ subtotalEur: 400 }), item({ subtotalEur: 300 })],
      }),
    );
    expect(charges).toEqual([{ label: 'Door-to-door transport', amountEur: 30 }]);
  });
});
