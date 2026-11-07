import { describe, expect, it } from 'vitest';
import { bookingProgress } from '@/lib/booking/booking-progress';

const states = (status: string, over: { isPast?: boolean; depositOnly?: boolean } = {}) =>
  bookingProgress({ status, isPast: false, depositOnly: false, ...over })?.map(
    (s) => `${s.label}:${s.state}`,
  ) ?? null;

describe('bookingProgress', () => {
  it('shows a refund still on its way as the current step', () => {
    expect(states('refund_pending')).toEqual([
      'Cancelled:done',
      'Refund processing:current',
      'Refunded:todo',
    ]);
  });

  it('ticks every step once the refund has gone out', () => {
    expect(states('refunded')).toEqual([
      'Cancelled:done',
      'Refund processing:done',
      'Refunded:done',
    ]);
  });

  it('waits on the trip day for a confirmed upcoming booking', () => {
    expect(states('confirmed')).toEqual(['Booked:done', 'Paid:done', 'Trip day:todo']);
  });

  it('never says "Paid" when only a deposit is in', () => {
    expect(states('confirmed', { depositOnly: true })).toEqual([
      'Booked:done',
      'Deposit paid:done',
      'Trip day:todo',
    ]);
  });

  it('ticks the trip day once it has gone by, or the trip is completed', () => {
    expect(states('confirmed', { isPast: true })?.[2]).toBe('Trip day:done');
    expect(states('completed')?.[2]).toBe('Trip day:done');
  });

  it('puts payment as the step in progress on an unpaid booking', () => {
    expect(states('payment_pending')).toEqual([
      'Reserved:done',
      'Payment:current',
      'Confirmed:todo',
    ]);
  });

  it('draws no tracker where there is nothing to track', () => {
    for (const status of ['cancelled', 'expired', 'failed', 'draft', 'something_new']) {
      expect(states(status)).toBeNull();
    }
  });
});
