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
    supplements: [],
    customItems: [],
    balanceDueEur: 0,
    transfer: null,
    ...over,
  };
}

/**
 * A QUOTE booking's lines do not live in `booking_items` at all.
 *
 * api_convert_quote sends every non-occurrence line — custom, rental, and now the transport add-on —
 * to `booking_custom_items`, because booking_items' NOT NULL occurrence + option are load-bearing for
 * capacity, the day sheet and the voucher. The staff drawer only ever summed booking_items, so a
 * quote booking made entirely of those lines showed its WHOLE total as one "Unaccounted" line: the
 * operator could see €1.00 was owed and nothing about what it was for.
 *
 * Observed on the real booking BMT2D0A9EF6FF61C — 0 booking_items rows, one booking_custom_items row
 * ("Test", €1.00), rendered as "Unaccounted €1.00".
 */
describe('a quote booking, whose lines live in booking_custom_items', () => {
  const custom = {
    description: 'Round-trip transfer · Dolphin swim',
    quantity: 1,
    subtotalEur: 60,
  };

  it('names each line instead of lumping them into "Unaccounted"', () => {
    const charges = bookingExtraCharges(
      booking({ totalEur: 60, items: [], customItems: [custom] }),
    );
    expect(charges).toEqual([{ label: 'Round-trip transfer · Dolphin swim', amountEur: 60 }]);
    expect(charges.some((c) => c.label === 'Unaccounted')).toBe(false);
  });

  it('shows the quantity when a line covers more than one of something', () => {
    const charges = bookingExtraCharges(
      booking({
        totalEur: 120,
        items: [],
        customItems: [{ description: 'Dolphin swim', quantity: 2, subtotalEur: 120 }],
      }),
    );
    expect(charges[0]!.label).toContain('Dolphin swim');
    expect(charges[0]!.label).toContain('2');
    expect(charges[0]!.amountEur).toBe(120);
  });

  it('still surfaces a genuine residue alongside the custom lines', () => {
    // The "Unaccounted" line exists so a charge nobody modelled shows up rather than silently
    // inflating the total. Accounting for custom items must not blunt that.
    const charges = bookingExtraCharges(
      booking({ totalEur: 85, items: [], customItems: [custom] }),
    );
    expect(charges).toContainEqual({ label: 'Unaccounted', amountEur: 25 });
  });

  it('adds up alongside a normal catalogue line and a transport fee', () => {
    const charges = bookingExtraCharges(
      booking({ totalEur: 790, transportEur: 30, customItems: [custom] }),
    );
    expect(charges.some((c) => c.label === 'Unaccounted')).toBe(false);
    expect(charges).toContainEqual({ label: 'Door-to-door transport', amountEur: 30 });
  });
});

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

  // The supplement is folded into total_minor with no booking_items row, so without its own line
  // here the whole charge would land in "Unaccounted" and staff couldn't explain the total.
  it('explains the optional supplement, using the label snapshot on the booking', () => {
    const charges = bookingExtraCharges(
      booking({
        totalEur: 750,
        supplements: [{ name: 'Lobster for lunch', qty: 2, totalEur: 50 }],
      }),
    );
    expect(charges).toEqual([{ label: 'Lobster for lunch (2)', amountEur: 50 }]);
  });

  it('drops the count from the supplement label when only one guest took it', () => {
    const charges = bookingExtraCharges(
      booking({
        totalEur: 725,
        supplements: [{ name: 'Lobster for lunch', qty: 1, totalEur: 25 }],
      }),
    );
    expect(charges).toEqual([{ label: 'Lobster for lunch', amountEur: 25 }]);
  });

  it('lists every add-on together, transport first and the supplement last', () => {
    const charges = bookingExtraCharges(
      booking({
        totalEur: 792,
        transportEur: 30,
        childSeats: 3,
        supplements: [{ name: 'Lobster for lunch', qty: 2, totalEur: 50 }],
      }),
    );
    expect(charges).toEqual([
      { label: 'Door-to-door transport', amountEur: 30 },
      { label: 'Child seats (3)', amountEur: 12 },
      { label: 'Lobster for lunch (2)', amountEur: 50 },
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
