import { describe, expect, it } from 'vitest';
import {
  NEW_BOOKING_PARAM,
  newBookingPayPath,
  newBookingReturnPath,
  purchaseEvent,
  type PurchaseView,
} from '@/lib/analytics/purchase';
import { safeReturnPath } from '@/lib/checkout/return-path';

/** A new website booking, back from the card form and read back confirmed: the one case that reports. */
const paid: PurchaseView = {
  ref: 'BMT9448E88DD2C43',
  status: 'confirmed',
  paymentState: 'paid',
  totalEur: 185,
  newBooking: true,
  staffView: false,
};

describe('purchaseEvent', () => {
  it('reports a paid, confirmed new booking with its reference and euro total', () => {
    expect(purchaseEvent(paid)).toEqual({
      event: 'purchase',
      ecommerce: { transaction_id: 'BMT9448E88DD2C43', value: 185, currency: 'EUR' },
    });
  });

  it('rounds the value to cents', () => {
    expect(purchaseEvent({ ...paid, totalEur: 90.005 })?.ecommerce.value).toBe(90.01);
    expect(purchaseEvent({ ...paid, totalEur: 0.1 + 0.2 })?.ecommerce.value).toBe(0.3);
  });

  it('never reports an unmarked visit: the email link, a bookmark, a balance or add-on payment', () => {
    expect(purchaseEvent({ ...paid, newBooking: false })).toBeNull();
  });

  it('treats the marker as a hint, not proof: the booking must read back paid and confirmed', () => {
    expect(
      purchaseEvent({ ...paid, status: 'payment_pending', paymentState: 'pending' }),
    ).toBeNull();
    expect(purchaseEvent({ ...paid, paymentState: 'failed' })).toBeNull();
    expect(purchaseEvent({ ...paid, status: 'cancelled' })).toBeNull();
    expect(purchaseEvent({ ...paid, status: 'refund_pending' })).toBeNull();
  });

  it('counts a completed trip like a confirmed one, matching the confirmation page', () => {
    expect(purchaseEvent({ ...paid, status: 'completed' })).not.toBeNull();
  });

  it('never reports when staff open a guest’s booking', () => {
    expect(purchaseEvent({ ...paid, staffView: true })).toBeNull();
  });

  it('sends nothing GA4 would mis-count: an empty reference or a zero total', () => {
    // GA4 merges every purchase with an empty transaction ID into one.
    expect(purchaseEvent({ ...paid, ref: '' })).toBeNull();
    expect(purchaseEvent({ ...paid, totalEur: 0 })).toBeNull();
    expect(purchaseEvent({ ...paid, totalEur: Number.NaN })).toBeNull();
  });

  it('carries no personal data', () => {
    const keys = Object.keys(purchaseEvent(paid)?.ecommerce ?? {}).sort();
    expect(keys).toEqual(['currency', 'transaction_id', 'value']);
  });
});

describe('newBookingPayPath', () => {
  const url = new URL(newBookingPayPath('BMT9448E88DD2C43', 'abc/123=='), 'https://x.test');

  it('opens the booking’s pay page with its checkout session', () => {
    expect(url.pathname).toBe('/bookings/BMT9448E88DD2C43/pay');
    expect(url.searchParams.get('cid')).toBe('abc/123==');
  });

  it('returns to the booking page, marked, through the pay page’s validated ?return=', () => {
    const back = url.searchParams.get('return') ?? undefined;
    expect(back).toBe(newBookingReturnPath('BMT9448E88DD2C43'));
    // The pay page runs it through safeReturnPath: a rejection would silently drop the marker.
    expect(safeReturnPath(back, '/fallback')).toBe(back);
  });

  it('keeps the marker when EmbeddedCheckout adds just_paid for a return it has to poll', () => {
    const polled = new URL(`${newBookingReturnPath('BMT1')}&just_paid=1`, 'https://x.test');
    expect(polled.pathname).toBe('/bookings/BMT1');
    expect(polled.searchParams.get(NEW_BOOKING_PARAM)).toBe('1');
    expect(polled.searchParams.get('just_paid')).toBe('1');
  });
});
