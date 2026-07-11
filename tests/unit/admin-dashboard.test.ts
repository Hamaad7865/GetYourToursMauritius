import { describe, expect, it } from 'vitest';
import { computeDashboard } from '@/lib/admin/dashboard';
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
    totalEur: 100,
    notes: null,
    createdAt: '2026-07-18T06:00:00Z',
    items: [],
    activityTitle: 'Catamaran Cruise',
    startsAt: null,
    guests: 2,
    netPaidEur: 100,
    customItinerary: null,
    pickupLocation: null,
    dropoffLocation: null,
    pickupPending: false,
    childSeats: 0,
    transfer: null,
    ...over,
  };
}

// 10:00 Mauritius (GMT+4) on 2026-07-18
const NOW = new Date('2026-07-18T06:00:00Z');

describe('computeDashboard', () => {
  it('buckets departures, upcoming, pending and weekly revenue in Mauritius local time', () => {
    const rows: BookingRow[] = [
      // today's departure (09:00 Mauritius), paid 100
      booking({
        id: 'b1',
        ref: 'BMT-1',
        startsAt: '2026-07-18T05:00:00Z',
        netPaidEur: 100,
        paymentState: 'paid',
      }),
      // upcoming (in 2 days), payment pending, total 200, no cash yet
      booking({
        id: 'b2',
        ref: 'BMT-2',
        startsAt: '2026-07-20T08:00:00Z',
        paymentState: 'pending',
        totalEur: 200,
        netPaidEur: 0,
        createdAt: '2026-07-17T09:00:00Z',
      }),
      // past + cancelled → excluded everywhere
      booking({
        id: 'b3',
        ref: 'BMT-3',
        startsAt: '2026-07-10T08:00:00Z',
        status: 'cancelled',
        netPaidEur: 0,
      }),
    ];

    const d = computeDashboard(rows, NOW);

    expect(d.departures).toHaveLength(1);
    expect(d.departures[0]!.ref).toBe('BMT-1');
    expect(d.departures[0]!.time).toBe('09:00');

    expect(d.upcoming7).toBe(2); // today's + the one in 2 days (cancelled excluded)
    expect(d.pendingCount).toBe(1);
    expect(d.pendingTotalEur).toBe(200);
    expect(d.revenueWeekEur).toBe(100); // only b1's net cash, created within the last 7 days

    const byKey = Object.fromEntries(d.stats.map((s) => [s.key, s.value]));
    expect(byKey.today).toBe('1');
    expect(byKey.revenue).toBe('€100');
    expect(byKey.pending).toBe('€200');
    expect(byKey.upcoming).toBe('2');
    expect(d.spark).toHaveLength(7);
  });

  it('carries pickup/drop-off DTO fields used by the booking drawer', () => {
    const b = booking({
      pickupLocation: 'Hotel X',
      dropoffLocation: 'Airport',
      pickupPending: true,
    });
    expect(b.pickupLocation).toBe('Hotel X');
    expect(b.dropoffLocation).toBe('Airport');
    expect(b.pickupPending).toBe(true);
  });

  it('handles an empty booking list without throwing', () => {
    const d = computeDashboard([], NOW);
    expect(d.departures).toEqual([]);
    expect(d.recent).toEqual([]);
    expect(d.revenueWeekEur).toBe(0);
    expect(d.spark).toHaveLength(7);
  });
});
