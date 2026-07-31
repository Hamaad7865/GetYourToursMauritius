import { describe, expect, it } from 'vitest';
import { checkoutHref } from '@/lib/cart/checkout-href';
import type { CartItem } from '@/lib/cart/useCart';

function line(over: Partial<CartItem> = {}): CartItem {
  return {
    id: 'occ1:Adult',
    slug: 'airport-transfer',
    title: 'Return airport transfer · Hotel Ambre',
    image: null,
    occurrenceId: 'occ1',
    dateLabel: '18 Aug 2026 (+ return)',
    lang: 'en',
    priceLabel: 'Transfer',
    guests: 4,
    unitEur: 90,
    pricingMode: 'vehicle',
    maxGuests: null,
    seatsLeft: 4,
    unit: 'per transfer',
    addedAt: 0,
    status: 'held',
    idemKey: 'idem-1',
    ...over,
  };
}

function params(item: CartItem): URLSearchParams {
  return new URL(checkoutHref(item), 'https://example.test').searchParams;
}

describe('checkoutHref', () => {
  it('carries the core line identity', () => {
    const q = params(line());
    expect(q.get('occ')).toBe('occ1');
    expect(q.get('slug')).toBe('airport-transfer');
    expect(q.get('qty')).toBe('4');
    expect(q.get('from')).toBe('cart');
  });

  /**
   * The bug: an airport transfer mirrored into the cart lost every transfer-defining param, and
   * api_book derives "is an airport transfer" from the ACTIVITY rather than the payload — so it
   * still overrode the total, falling back to zone 1 and a single leg. A return trip to a far hotel
   * was re-priced as a one-way short hop on the way through the cart.
   */
  it('carries the transfer params that decide the fare', () => {
    const q = params(
      line({
        checkoutParams: {
          transfer: '1',
          dropoffSlug: 'hotel-ambre-belle-mare',
          dropoff: 'Hotel Ambre',
          region: 'east',
          tripType: 'return',
          arrDate: '2026-08-18',
          arr: '14:30',
        },
      }),
    );
    expect(q.get('transfer')).toBe('1');
    expect(q.get('dropoffSlug')).toBe('hotel-ambre-belle-mare');
    expect(q.get('tripType')).toBe('return');
    expect(q.get('region')).toBe('east');
    expect(q.get('arrDate')).toBe('2026-08-18');
    expect(q.get('arr')).toBe('14:30');
  });

  // The cart is the authority on the line's own identity: a stale or hand-edited stash must not be
  // able to redirect the checkout at a different occurrence or party.
  it('never lets the stashed extras override the cart’s own values', () => {
    const q = params(
      line({
        checkoutParams: { occ: 'evil-occurrence', qty: '99', from: 'widget', total: '1' },
      }),
    );
    expect(q.get('occ')).toBe('occ1');
    expect(q.get('qty')).toBe('4');
    expect(q.get('from')).toBe('cart');
    expect(q.get('total')).not.toBe('1');
  });

  it('omits the extras block entirely for an ordinary tour line', () => {
    const q = params(line({ slug: 'catamaran', checkoutParams: undefined }));
    expect(q.get('transfer')).toBeNull();
    expect(q.get('dropoffSlug')).toBeNull();
  });

  it('still carries the SUV upgrade, child seats and the age-band map', () => {
    const q = params(line({ suv: true, childSeats: 2, party: { Adult: 2, Child: 1 } }));
    expect(q.get('suv')).toBe('1');
    expect(q.get('childSeats')).toBe('2');
    expect(q.get('party')).toBeTruthy();
  });
});
