import { describe, expect, it } from 'vitest';
import { buildInvoice } from '@/lib/invoice/model';

/**
 * `buildInvoice` is a PURE mapper: booking + payment + business identity -> an itemized,
 * VAT-inclusive (15%) invoice/receipt model the PDF + HTML renderers consume.
 *
 * Field names mirror the REAL shapes:
 *  - booking: `booking_json` / `bookingSchema` (ref, customerName, customerEmail, currency, totalEur,
 *    items[{ priceLabel, quantity, pax, subtotalEur }], pickupLocation, dropoffLocation, childSeats,
 *    transportEur). `activityTitle` + `when` (occurrence date/time) are NOT in booking_json — the caller
 *    (Task 6) joins and supplies them, so they're plain input fields here.
 *  - payment (Task 1): `charged_amount_minor` is stored in MINOR units, so the input is `chargedAmountMinor`
 *    and the model converts it to a major-unit `chargedAmount`.
 *  - business: the SITE identity block.
 *
 * The customer's prices ALREADY include 15% VAT, so per the whole invoice net = gross / 1.15.
 */
const business = {
  legalName: 'Belle Mare Tours Ltd',
  brn: 'C09091906',
  vat: '20529965',
  street: 'Royal Road, Belle Mare',
  locality: 'Belle Mare',
  region: 'Flacq',
  country: 'MU',
  email: 'bookings@getyourtoursmauritius.com',
  phone: '+230 5772 9919',
};

describe('buildInvoice', () => {
  it('splits a single VAT-inclusive line into net + 15% VAT (gross stays exact)', () => {
    const inv = buildInvoice(
      {
        ref: 'BMT-1',
        customerName: 'Jean',
        customerEmail: 'j@x.com',
        currency: 'EUR',
        totalEur: 115,
        activityTitle: 'Boat Trip',
        when: '2026-08-09T06:00:00Z',
        pickupLocation: null,
        dropoffLocation: null,
        childSeats: 0,
        transportEur: 0,
        items: [{ priceLabel: 'Adult', quantity: 1, pax: null, subtotalEur: 115 }],
      },
      {
        chargedAmountMinor: 12500,
        chargedCurrency: 'USD',
        paidAt: '2026-06-20T10:00:00Z',
        providerRef: 'pe_123',
      },
      business,
    );

    // (c) invoiceNumber === ref
    expect(inv.invoiceNumber).toBe('BMT-1');
    // (a) single VAT-inclusive line: total 115 -> net 100, vat 15, vatRatePct 15, gross 115 exact
    expect(inv.totalGrossEur).toBe(115);
    expect(inv.subtotalNetEur).toBe(100);
    expect(inv.vatAmountEur).toBe(15);
    expect(inv.vatRatePct).toBe(15);
    expect(inv.currency).toBe('EUR');

    // one line, mapped from the single item
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toEqual({
      description: 'Boat Trip — Adult',
      quantity: 1,
      unitGrossEur: 115,
      lineGrossEur: 115,
    });

    // (d) the payment block carries chargedAmount (converted from minor) + chargedCurrency
    expect(inv.payment.chargedAmount).toBe(125);
    expect(inv.payment.chargedCurrency).toBe('USD');
    expect(inv.payment.paidAt).toBe('2026-06-20T10:00:00Z');
    expect(inv.payment.providerRef).toBe('pe_123');

    // issuedAt is supplied by the caller (no new Date()): falls back to paidAt
    expect(inv.issuedAt).toBe('2026-06-20T10:00:00Z');

    // business + customer + booking blocks are carried through
    expect(inv.business.legalName).toBe('Belle Mare Tours Ltd');
    expect(inv.customer).toEqual({ name: 'Jean', email: 'j@x.com' });
    expect(inv.booking).toEqual({
      ref: 'BMT-1',
      activityTitle: 'Boat Trip',
      when: '2026-08-09T06:00:00Z',
      pickup: null,
      dropoff: null,
      transfer: null,
    });
  });

  it('builds a transport line and a child-seat line, and the lines sum to the total', () => {
    const inv = buildInvoice(
      {
        ref: 'BMT-2',
        customerName: 'A',
        customerEmail: 'a@x.com',
        currency: 'EUR',
        totalEur: 191,
        activityTitle: 'Tour',
        when: '2026-08-09T06:00:00Z',
        pickupLocation: 'Hotel',
        dropoffLocation: null,
        childSeats: 2, // first free + 1 extra @ €6 = €6 child-seat line
        transportEur: 30,
        items: [{ priceLabel: 'Adult', quantity: 3, pax: null, subtotalEur: 155 }],
      },
      { chargedAmountMinor: 20700, chargedCurrency: 'USD', issuedAt: '2026-06-20T12:00:00Z' },
      business,
    );

    // (b) lines (items + Door-to-door transport + Child seats) sum to totalEur
    const sum = inv.lines.reduce((s, l) => s + l.lineGrossEur, 0);
    expect(sum).toBeCloseTo(191, 2);

    const descriptions = inv.lines.map((l) => l.description);
    expect(descriptions).toContain('Tour — Adult');
    expect(inv.lines.some((l) => /door-to-door transport/i.test(l.description))).toBe(true);
    expect(inv.lines.some((l) => /child seats/i.test(l.description))).toBe(true);

    // the item line uses pax ?? quantity (pax null -> quantity 3) for unit price
    const itemLine = inv.lines.find((l) => l.description === 'Tour — Adult')!;
    expect(itemLine.quantity).toBe(3);
    expect(itemLine.lineGrossEur).toBe(155);

    // the child-seat line amount matches childSeatsCost(2) = €6
    const childLine = inv.lines.find((l) => /child seats/i.test(l.description))!;
    expect(childLine.lineGrossEur).toBe(6);
    expect(childLine.description).toBe('Child seats (2)');

    // VAT-inclusive split over the whole invoice
    expect(inv.totalGrossEur).toBe(191);
    expect(inv.subtotalNetEur + inv.vatAmountEur).toBeCloseTo(191, 2);
    expect(inv.vatRatePct).toBe(15);

    // no paidAt -> issuedAt comes from the explicit issuedAt input
    expect(inv.issuedAt).toBe('2026-06-20T12:00:00Z');
    expect(inv.payment.chargedAmount).toBe(207);
    expect(inv.booking.pickup).toBe('Hotel');
  });

  it('omits the transport and child-seat lines when their amounts are zero', () => {
    const inv = buildInvoice(
      {
        ref: 'BMT-3',
        customerName: 'B',
        customerEmail: 'b@x.com',
        currency: 'EUR',
        totalEur: 92,
        activityTitle: 'Snorkel',
        when: '2026-09-01T08:00:00Z',
        pickupLocation: null,
        dropoffLocation: null,
        childSeats: 1, // first seat is free -> childSeatsCost(1) = 0 -> no line
        transportEur: 0,
        items: [{ priceLabel: 'Adult', quantity: 2, pax: null, subtotalEur: 92 }],
      },
      { chargedAmountMinor: 9900, chargedCurrency: 'USD', issuedAt: '2026-09-01T00:00:00Z' },
      business,
    );

    expect(inv.lines).toHaveLength(1);
    expect(inv.lines.some((l) => /transport/i.test(l.description))).toBe(false);
    expect(inv.lines.some((l) => /child seat/i.test(l.description))).toBe(false);
  });
});
