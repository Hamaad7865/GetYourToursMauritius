import { describe, expect, it } from 'vitest';
import {
  BOOKING_VIEWS,
  bookingViewCounts,
  inBookingView,
  isAwaitingPayment,
  parseBookingView,
  sortSentence,
  viewSort,
} from '@/lib/admin/booking-views';
import { computeDashboard } from '@/lib/admin/dashboard';
import { bookingRow } from '../helpers/admin-day';

/* The Bookings screen's saved views (phase 2 of the back-office redesign): which booking sits under
 * which tab, the counts, and the order each tab opens in. */

const TODAY = '2026-11-14';
const at = (day: string) => `${day}T08:00:00Z`; // a noon day-slot

describe('booking views', () => {
  it('lists the seven tabs in the mock-up’s order', () => {
    expect(BOOKING_VIEWS.map((v) => v.label)).toEqual([
      'All',
      'Awaiting payment',
      'Today',
      'Next 7 days',
      'Part paid',
      'Completed',
      'Cancelled',
    ]);
  });

  it('reads ?view= strictly, falling back to All', () => {
    expect(parseBookingView('part_paid')).toBe('part_paid');
    expect(parseBookingView('awaiting')).toBe('awaiting');
    expect(parseBookingView('nonsense')).toBe('all');
    expect(parseBookingView(null)).toBe('all');
  });

  it('awaiting payment is money still expected on a LIVE booking only', () => {
    expect(isAwaitingPayment({ paymentState: 'pending', status: 'payment_pending' })).toBe(true);
    expect(isAwaitingPayment({ paymentState: 'pending', status: 'held' })).toBe(true);
    // Never paid and never going to be: these read "Not paid", not "awaiting".
    expect(isAwaitingPayment({ paymentState: 'pending', status: 'expired' })).toBe(false);
    expect(isAwaitingPayment({ paymentState: 'pending', status: 'cancelled' })).toBe(false);
    expect(isAwaitingPayment({ paymentState: 'paid', status: 'confirmed' })).toBe(false);
    expect(isAwaitingPayment({ paymentState: 'failed', status: 'payment_pending' })).toBe(false);
  });

  it('files Today and Next 7 days by the Mauritius trip day, every status kept', () => {
    const today = bookingRow({ startsAt: at(TODAY), status: 'cancelled' });
    const in6 = bookingRow({ startsAt: at('2026-11-20') });
    const in7 = bookingRow({ startsAt: at('2026-11-21') });
    const past = bookingRow({ startsAt: at('2026-11-13') });
    const undated = bookingRow({ startsAt: null });
    expect(inBookingView(today, 'today', TODAY)).toBe(true);
    expect(inBookingView(today, 'next7', TODAY)).toBe(true);
    expect(inBookingView(in6, 'next7', TODAY)).toBe(true);
    expect(inBookingView(in7, 'next7', TODAY)).toBe(false);
    expect(inBookingView(past, 'today', TODAY)).toBe(false);
    expect(inBookingView(undated, 'today', TODAY)).toBe(false);
    expect(inBookingView(undated, 'next7', TODAY)).toBe(false);
  });

  it('a tour departing at 23:30 UTC the day before is still TODAY in Mauritius', () => {
    // 2026-11-13T23:30Z is 03:30 on the 14th in Mauritius (GMT+4).
    const b = bookingRow({ startsAt: '2026-11-13T23:30:00Z' });
    expect(inBookingView(b, 'today', TODAY)).toBe(true);
  });

  it('Part paid is paymentView’s part_paid, never a stored balance alone', () => {
    const deposit = bookingRow({ depositEur: 18, balanceDueEur: 162, totalEur: 180 });
    // An ordinary booking whose card was declined also carries balance = total: not part paid.
    const declined = bookingRow({
      paymentState: 'paid',
      depositEur: 0,
      balanceDueEur: 90,
      totalEur: 90,
    });
    expect(inBookingView(deposit, 'part_paid', TODAY)).toBe(true);
    expect(inBookingView(declined, 'part_paid', TODAY)).toBe(false);
  });

  it('Cancelled holds every way a booking ends without the trip; expired stays under All', () => {
    for (const status of ['cancelled', 'refund_pending', 'refunded'] as const) {
      expect(inBookingView(bookingRow({ status }), 'cancelled', TODAY)).toBe(true);
    }
    for (const status of ['expired', 'failed', 'confirmed', 'completed'] as const) {
      expect(inBookingView(bookingRow({ status }), 'cancelled', TODAY)).toBe(false);
    }
    expect(inBookingView(bookingRow({ status: 'completed' }), 'completed', TODAY)).toBe(true);
    expect(inBookingView(bookingRow({ status: 'expired' }), 'all', TODAY)).toBe(true);
  });

  it('counts every view over the full list', () => {
    const rows = [
      bookingRow({ id: '1', startsAt: at(TODAY) }),
      bookingRow({ id: '2', paymentState: 'pending', status: 'payment_pending' }),
      bookingRow({ id: '3', status: 'completed' }),
      bookingRow({ id: '4', status: 'refunded', paymentState: 'refunded' }),
      bookingRow({ id: '5', depositEur: 10, balanceDueEur: 90, totalEur: 100 }),
      bookingRow({ id: '6', paymentState: 'pending', status: 'expired' }),
    ];
    expect(bookingViewCounts(rows, TODAY)).toEqual({
      all: 6,
      awaiting: 1,
      today: 1,
      next7: 1,
      part_paid: 1,
      completed: 1,
      cancelled: 1,
    });
  });

  it('the Awaiting payment tab and Today’s card count the same bookings', () => {
    const rows = [
      bookingRow({ id: '1', paymentState: 'pending', status: 'payment_pending' }),
      bookingRow({ id: '2', paymentState: 'pending', status: 'held' }),
      bookingRow({ id: '3', paymentState: 'pending', status: 'expired' }),
      bookingRow({ id: '4', paymentState: 'pending', status: 'cancelled' }),
      bookingRow({ id: '5', paymentState: 'paid' }),
    ];
    const dash = computeDashboard(rows, new Date('2026-11-14T06:00:00Z'));
    expect(bookingViewCounts(rows, TODAY).awaiting).toBe(dash.pendingCount);
    expect(dash.pendingCount).toBe(2);
  });

  it('opens All newest-booked first and the date views soonest trip first', () => {
    expect(viewSort('all')).toEqual({ key: 'booked', dir: 'desc' });
    expect(viewSort('awaiting')).toEqual({ key: 'booked', dir: 'desc' });
    expect(viewSort('completed')).toEqual({ key: 'booked', dir: 'desc' });
    expect(viewSort('cancelled')).toEqual({ key: 'booked', dir: 'desc' });
    expect(viewSort('today')).toEqual({ key: 'date', dir: 'asc' });
    expect(viewSort('next7')).toEqual({ key: 'date', dir: 'asc' });
    expect(viewSort('part_paid')).toEqual({ key: 'date', dir: 'asc' });
  });

  it('says the order on screen in words', () => {
    expect(sortSentence('date', 'asc')).toBe('Sorted by trip date, soonest first');
    expect(sortSentence('date', 'desc')).toBe('Sorted by trip date, latest first');
    expect(sortSentence('booked', 'desc')).toBe('Newest booking first');
    expect(sortSentence('booked', 'asc')).toBe('Oldest booking first');
    expect(sortSentence('total', 'desc')).toBe('Highest total first');
    expect(sortSentence('total', 'asc')).toBe('Lowest total first');
    expect(sortSentence('customer', 'asc')).toBe('Sorted by guest name, A to Z');
    expect(sortSentence('customer', 'desc')).toBe('Sorted by guest name, Z to A');
    expect(sortSentence('ref', 'asc')).toBe('Sorted by reference, A to Z');
    expect(sortSentence('ref', 'desc')).toBe('Sorted by reference, Z to A');
  });
});
