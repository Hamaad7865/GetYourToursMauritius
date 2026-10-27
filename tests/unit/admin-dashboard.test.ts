import { describe, expect, it } from 'vitest';
import { computeDashboard, statsFor, type DashViewer } from '@/lib/admin/dashboard';
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
    grossPaidEur: 100,
    refundedEur: 0,
    customItinerary: null,
    pickupLocation: null,
    dropoffLocation: null,
    pickupPending: false,
    transportPickup: null,
    transportDropoff: null,
    childSeats: 0,
    transportEur: 0,
    supplements: [],
    customItems: [],
    balanceDueEur: 0,
    depositEur: 0,
    installments: [],
    transfer: null,
    pickupTime: null,
    departureTime: null,
    ...over,
  };
}

// 10:00 Mauritius (GMT+4) on 2026-07-18
const NOW = new Date('2026-07-18T06:00:00Z');

describe('computeDashboard', () => {
  it('buckets departures, upcoming, pending and weekly revenue in Mauritius local time', () => {
    const rows: BookingRow[] = [
      // today's departure (a noon day-slot; the tour leaves at 09:00), paid 100
      booking({
        id: 'b1',
        ref: 'BMT-1',
        startsAt: '2026-07-18T08:00:00Z',
        departureTime: '09:00',
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

  it("lists today's departures at the tour's start time, earliest first, untimed last", () => {
    const NOON_TODAY = '2026-07-18T08:00:00Z'; // where materialize_availability puts every slot
    const rows: BookingRow[] = [
      booking({ id: 'late', ref: 'BMT-L', startsAt: NOON_TODAY, departureTime: '16:00' }),
      booking({ id: 'none', ref: 'BMT-N', startsAt: NOON_TODAY, departureTime: null }),
      // A slot made before the July timezone fix sits at 16:00 Mauritius, not noon.
      booking({
        id: 'early',
        ref: 'BMT-E',
        startsAt: '2026-07-18T12:00:00Z',
        departureTime: '07:15',
      }),
      // An airport transfer: the guest's landing time, never the slot's noon.
      booking({
        id: 'xfer',
        ref: 'BMT-X',
        startsAt: NOON_TODAY,
        transfer: {
          direction: 'arrival',
          roomOrCabin: null,
          flightNumber: null,
          arrivalTime: '10:40',
          returnDate: null,
          returnTime: null,
          departureFlightNumber: null,
          luggageDetails: null,
          childSeatAge: null,
          travellerCountry: null,
          travellerCompany: null,
          travellerGender: null,
          specialNotes: null,
        },
      }),
    ];

    const d = computeDashboard(rows, NOW);

    expect(d.departures.map((r) => [r.ref, r.time])).toEqual([
      ['BMT-E', '07:15'],
      ['BMT-X', '10:40'],
      ['BMT-L', '16:00'],
      ['BMT-N', null],
    ]);
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
    // The switchable series still exist, zeroed, with null (not NaN/Infinity) deltas.
    expect(d.revenue['7d'].points).toHaveLength(7);
    expect(d.revenue['4w'].points).toHaveLength(4);
    expect(d.revenue['12m'].points).toHaveLength(12);
    expect(d.revenue['7d'].totalEur).toBe(0);
    expect(d.revenue['7d'].deltaPct).toBeNull();
    expect(d.revenue['12m'].deltaPct).toBeNull();
  });

  it('buckets revenue into 7d/4w/12m series with an honest vs-previous-period delta', () => {
    const rows: BookingRow[] = [
      // this week (today), net cash 100 → in 7d, 4w (week 4) and this month
      booking({ id: 'r1', createdAt: '2026-07-18T06:00:00Z', netPaidEur: 100 }),
      // previous 7-day window (2026-07-08), net cash 50 → NOT in 7d, but IS in the 4w window
      booking({ id: 'r2', createdAt: '2026-07-08T06:00:00Z', netPaidEur: 50 }),
    ];
    const d = computeDashboard(rows, NOW);

    expect(d.revenue['7d'].points).toHaveLength(7);
    expect(d.revenue['4w'].points).toHaveLength(4);
    expect(d.revenue['12m'].points).toHaveLength(12);

    // 7d mirrors the weekly KPI exactly.
    expect(d.revenue['7d'].totalEur).toBe(100);
    expect(d.revenue['7d'].totalEur).toBe(d.revenueWeekEur);
    // this window 100 vs previous window 50 → +100%
    expect(d.revenue['7d'].deltaPct).toBe(100);

    // Both bookings land inside the last 28 days; the prior 28 days earned nothing → null delta.
    expect(d.revenue['4w'].totalEur).toBe(150);
    expect(d.revenue['4w'].deltaPct).toBeNull();

    // Both are in July 2026 → this month has 150; the prior 12 months earned nothing → null delta.
    expect(d.revenue['12m'].totalEur).toBe(150);
    expect(d.revenue['12m'].deltaPct).toBeNull();
    const july = d.revenue['12m'].points[11]!;
    expect(july.label).toBe('Jul');
    expect(july.value).toBe(150);
  });
});

describe('statsFor — the cards each role may see', () => {
  // One pending booking (total 200) so the pending card has a euro value AND a count.
  const stats = computeDashboard(
    [
      booking({
        id: 'p1',
        ref: 'BMT-P1',
        startsAt: '2026-07-20T05:00:00Z',
        paymentState: 'pending',
        status: 'payment_pending',
        totalEur: 200,
        netPaidEur: 0,
      }),
    ],
    NOW,
  ).stats;

  const none: DashViewer = { showMoney: false, showBookings: false, showDepartures: false };
  const keys = (v: Partial<DashViewer>) => statsFor(stats, { ...none, ...v }).map((s) => s.key);
  const pending = (v: Partial<DashViewer>) =>
    statsFor(stats, { ...none, ...v }).find((s) => s.key === 'pending');

  it('gives the Owner (money + bookings + departures) all four cards, each a link', () => {
    const all = statsFor(stats, { showMoney: true, showBookings: true, showDepartures: true });
    expect(all.map((s) => s.key)).toEqual(['today', 'revenue', 'pending', 'upcoming']);
    expect(all.every((s) => s.linked)).toBe(true);
    // The euro figures are untouched.
    expect(all.find((s) => s.key === 'pending')?.value).toBe('€200');
    expect(all.find((s) => s.key === 'revenue')?.value).toBe(
      stats.find((s) => s.key === 'revenue')?.value,
    );
  });

  it('shows nothing to a role with no Bookings, Calendar or money', () => {
    expect(statsFor(stats, none)).toEqual([]);
  });

  it('shows Bookings-only the departure counts and the pending COUNT, never euros', () => {
    expect(keys({ showBookings: true, showDepartures: true })).toEqual([
      'today',
      'pending',
      'upcoming',
    ]);
    const p = pending({ showBookings: true, showDepartures: true })!;
    expect(p.value).toBe('1');
    expect(p.hint).toBe('open');
    expect(p.linked).toBe(true);
  });

  it('shows Calendar-only the two departure counts as plain, unlinked cards', () => {
    const cards = statsFor(stats, { ...none, showDepartures: true });
    expect(cards.map((s) => s.key)).toEqual(['today', 'upcoming']);
    expect(cards.some((s) => s.linked)).toBe(false);
  });

  it('shows a money-only role revenue and the pending euros, unlinked', () => {
    const cards = statsFor(stats, { ...none, showMoney: true });
    expect(cards.map((s) => s.key)).toEqual(['revenue', 'pending']);
    expect(cards.find((s) => s.key === 'pending')?.value).toBe('€200');
    expect(cards.some((s) => s.linked)).toBe(false);
  });

  it('keeps euros for money + Calendar, and links nothing without Bookings', () => {
    const cards = statsFor(stats, { showMoney: true, showBookings: false, showDepartures: true });
    expect(cards.map((s) => s.key)).toEqual(['today', 'revenue', 'pending', 'upcoming']);
    expect(cards.some((s) => s.linked)).toBe(false);
  });

  it('hides pending from Calendar-only and from a role with no money and no Bookings', () => {
    expect(pending({ showDepartures: true })).toBeUndefined();
    expect(pending(none)).toBeUndefined();
  });

  it('hides revenue unless money.revenue, whatever else the role holds', () => {
    expect(keys({ showBookings: true, showDepartures: true })).not.toContain('revenue');
    expect(keys({ showMoney: true })).toContain('revenue');
  });

  it('hides a card it was not told about, and does not mutate its input', () => {
    const before = JSON.stringify(stats);
    const extra = [
      ...stats,
      { key: 'mystery', label: 'X', value: '1', hint: '', tone: 'ink' as const },
    ];
    expect(
      statsFor(extra, { showMoney: true, showBookings: true, showDepartures: true }).map(
        (s) => s.key,
      ),
    ).toEqual(['today', 'revenue', 'pending', 'upcoming']);
    expect(JSON.stringify(stats)).toBe(before);
  });
});
