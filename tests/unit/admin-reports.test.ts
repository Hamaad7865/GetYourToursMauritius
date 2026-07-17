import { describe, expect, it } from 'vitest';
import { computeReports, mauYearRangeUtc, VAT_RATE } from '@/lib/admin/reports';
import type { BookingRow } from '@/lib/admin/bookings';

function booking(over: Partial<BookingRow>): BookingRow {
  return {
    id: 'id',
    ref: 'BMT-0001',
    status: 'confirmed',
    paymentState: 'paid',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@x.com',
    customerPhone: null,
    source: 'web',
    currency: 'EUR',
    totalEur: 115,
    notes: null,
    createdAt: '2026-03-15T06:00:00Z',
    items: [],
    activityTitle: 'Catamaran Cruise',
    startsAt: null,
    guests: 2,
    netPaidEur: 115,
    grossPaidEur: 115,
    refundedEur: 0,
    customItinerary: null,
    pickupLocation: null,
    dropoffLocation: null,
    pickupPending: false,
    childSeats: 0,
    transfer: null,
    ...over,
  };
}

describe('computeReports', () => {
  const rows: BookingRow[] = [
    // March: two Catamaran bookings, one partially refunded
    booking({
      id: 'a',
      createdAt: '2026-03-15T06:00:00Z',
      grossPaidEur: 115,
      refundedEur: 0,
      netPaidEur: 115,
    }),
    booking({
      id: 'b',
      createdAt: '2026-03-20T06:00:00Z',
      grossPaidEur: 230,
      refundedEur: 115,
      netPaidEur: 115,
    }),
    // July: a Tea Tasting
    booking({
      id: 'c',
      createdAt: '2026-07-10T06:00:00Z',
      grossPaidEur: 90,
      refundedEur: 0,
      netPaidEur: 90,
      activityTitle: 'Tea Tasting',
    }),
    // Boundary: created 2025-12-31 20:30 UTC = 2026-01-01 00:30 Mauritius → belongs to Jan 2026
    booking({
      id: 'd',
      createdAt: '2025-12-31T20:30:00Z',
      grossPaidEur: 50,
      refundedEur: 0,
      netPaidEur: 50,
    }),
    // A never-paid booking in the year → contributes nothing, not counted
    booking({
      id: 'e',
      createdAt: '2026-05-01T06:00:00Z',
      status: 'payment_pending',
      paymentState: 'pending',
      grossPaidEur: 0,
      refundedEur: 0,
      netPaidEur: 0,
    }),
  ];

  const r = computeReports(rows, 2026);

  it('lays out 12 months and a monthly net series', () => {
    expect(r.months).toHaveLength(12);
    expect(r.netSeries).toHaveLength(12);
    expect(r.months[0]!.label).toBe('Jan');
    expect(r.months[11]!.label).toBe('Dec');
  });

  it('buckets cash by Mauritius month, including the UTC year boundary', () => {
    const jan = r.months[0]!;
    const mar = r.months[2]!;
    const jul = r.months[6]!;
    expect(jan.netEur).toBe(50); // the 2025-12-31T20:30Z booking lands in Jan Mauritius time
    expect(mar.grossPaidEur).toBe(345);
    expect(mar.refundedEur).toBe(115);
    expect(mar.netEur).toBe(230);
    expect(mar.bookings).toBe(2); // the never-paid May booking is not here anyway
    expect(jul.netEur).toBe(90);
  });

  it('computes VAT as the 15/115 inclusive portion of net, with ex-VAT the remainder', () => {
    const mar = r.months[2]!;
    expect(mar.vatEur).toBe(30); // 230 × 15/115
    expect(mar.exVatEur).toBe(200);
    const jul = r.months[6]!;
    expect(jul.vatEur).toBeCloseTo((90 * VAT_RATE) / (1 + VAT_RATE), 2); // ≈ 11.74
    expect(jul.vatEur + jul.exVatEur).toBeCloseTo(jul.netEur, 2);
  });

  it('year totals equal the sum of the displayed monthly rows and reconcile', () => {
    expect(r.totals.grossPaidEur).toBe(485); // 345 + 90 + 50
    expect(r.totals.refundedEur).toBe(115);
    expect(r.totals.netEur).toBe(370); // 230 + 90 + 50
    expect(r.totals.bookings).toBe(4); // a,b,c,d paid; e not
    expect(r.totals.vatEur + r.totals.exVatEur).toBeCloseTo(r.totals.netEur, 2);
  });

  it('tallies per-tour and per-source by net cash, sorted desc, paid-only counts', () => {
    expect(r.byTour[0]).toEqual({ name: 'Catamaran Cruise', bookings: 3, netEur: 280 }); // a+b+d
    expect(r.byTour[1]).toEqual({ name: 'Tea Tasting', bookings: 1, netEur: 90 });
    expect(r.bySource).toHaveLength(1);
    expect(r.bySource[0]).toEqual({ name: 'web', bookings: 4, netEur: 370 });
  });

  it('handles an empty year without throwing', () => {
    const empty = computeReports([], 2025);
    expect(empty.months).toHaveLength(12);
    expect(empty.totals.netEur).toBe(0);
    expect(empty.totals.vatEur).toBe(0);
    expect(empty.byTour).toEqual([]);
    expect(empty.bySource).toEqual([]);
  });
});

describe('mauYearRangeUtc', () => {
  it('bounds a Mauritius calendar year in UTC (GMT+4 → year starts 20:00 the prior day)', () => {
    expect(mauYearRangeUtc(2026)).toEqual(['2025-12-31T20:00:00.000Z', '2026-12-31T20:00:00.000Z']);
  });
});
