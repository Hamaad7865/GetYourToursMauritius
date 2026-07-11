import { describe, expect, it } from 'vitest';
import {
  selectionHash,
  shouldRehydrateBooking,
  type SelectionInput,
} from '@/lib/checkout/selection';

// A representative price-relevant selection. Every field here changes the amount the customer pays
// (or the booking the server creates), so a change to ANY of them must produce a different hash —
// otherwise a persisted bookingRef could rehydrate against a different (cheaper) selection and charge
// the wrong amount. This is the P0 the hash exists to prevent.
const base: SelectionInput = {
  priceLabel: 'Adult',
  qty: 2,
  suv: false,
  childSeats: 1,
  pickupText: 'Hotel Le Morne',
  pickupLat: -20.45,
  pickupLng: 57.31,
  pickupTbd: false,
  dropoffText: 'Airport',
  itinerary: [
    { title: 'Black River Gorges', lat: -20.4, lng: 57.4 },
    { title: 'Chamarel', lat: -20.43, lng: 57.39 },
  ],
  total: '120.00',
};

describe('selectionHash', () => {
  it('is stable for the same selection (deterministic, order-independent of object keys)', () => {
    expect(selectionHash(base)).toBe(selectionHash({ ...base }));
    // Re-ordering the input object keys must not change the hash.
    const reordered: SelectionInput = {
      total: '120.00',
      itinerary: base.itinerary,
      dropoffText: 'Airport',
      pickupTbd: false,
      pickupLng: 57.31,
      pickupLat: -20.45,
      pickupText: 'Hotel Le Morne',
      childSeats: 1,
      suv: false,
      qty: 2,
      priceLabel: 'Adult',
    };
    expect(selectionHash(reordered)).toBe(selectionHash(base));
  });

  it('differs when the party / qty changes (the core P0 case)', () => {
    expect(selectionHash({ ...base, qty: 4 })).not.toBe(selectionHash(base));
  });

  it('differs when the price label changes', () => {
    expect(selectionHash({ ...base, priceLabel: 'Child' })).not.toBe(selectionHash(base));
  });

  it('differs when childSeats changes', () => {
    expect(selectionHash({ ...base, childSeats: 0 })).not.toBe(selectionHash(base));
  });

  it('differs when the SUV upgrade flag changes', () => {
    expect(selectionHash({ ...base, suv: true })).not.toBe(selectionHash(base));
  });

  it('differs when the pickup text changes', () => {
    expect(selectionHash({ ...base, pickupText: 'Hotel Trou aux Biches' })).not.toBe(
      selectionHash(base),
    );
  });

  it('differs when the pickup coordinates change', () => {
    expect(selectionHash({ ...base, pickupLat: -20.99 })).not.toBe(selectionHash(base));
    expect(selectionHash({ ...base, pickupLng: 57.99 })).not.toBe(selectionHash(base));
  });

  it('differs when the pickup TBD flag changes (no address vs an address → different fee)', () => {
    expect(selectionHash({ ...base, pickupTbd: true })).not.toBe(selectionHash(base));
  });

  it('differs when the dropoff changes', () => {
    expect(selectionHash({ ...base, dropoffText: 'Port Louis' })).not.toBe(selectionHash(base));
  });

  it('differs when the itinerary stops change (added, removed, reordered)', () => {
    // A different stop.
    expect(
      selectionHash({ ...base, itinerary: [{ title: 'Grand Bassin', lat: -20.42, lng: 57.49 }] }),
    ).not.toBe(selectionHash(base));
    // Reordering the stops is a different route (different drive distance → different fee).
    expect(
      selectionHash({ ...base, itinerary: [base.itinerary![1]!, base.itinerary![0]!] }),
    ).not.toBe(selectionHash(base));
    // No itinerary at all.
    expect(selectionHash({ ...base, itinerary: null })).not.toBe(selectionHash(base));
  });

  it('differs when the displayed total changes', () => {
    expect(selectionHash({ ...base, total: '999.00' })).not.toBe(selectionHash(base));
  });

  it('returns a non-empty string', () => {
    expect(typeof selectionHash(base)).toBe('string');
    expect(selectionHash(base).length).toBeGreaterThan(0);
  });
});

describe('shouldRehydrateBooking', () => {
  const sel = selectionHash(base);

  it('rehydrates only when the stored hash matches AND entry is widget or cart', () => {
    expect(shouldRehydrateBooking({ storedSel: sel, currentSel: sel, from: 'widget' })).toBe(true);
    expect(shouldRehydrateBooking({ storedSel: sel, currentSel: sel, from: 'cart' })).toBe(true);
  });

  it('does NOT rehydrate when the selection hash differs (different party/config, same occurrence)', () => {
    const other = selectionHash({ ...base, qty: 4 });
    expect(shouldRehydrateBooking({ storedSel: sel, currentSel: other, from: 'widget' })).toBe(
      false,
    );
    expect(shouldRehydrateBooking({ storedSel: sel, currentSel: other, from: 'cart' })).toBe(false);
  });

  it('does NOT rehydrate on a cold / cross-entry load (from is neither widget nor cart)', () => {
    expect(shouldRehydrateBooking({ storedSel: sel, currentSel: sel, from: 'none' })).toBe(false);
    expect(shouldRehydrateBooking({ storedSel: sel, currentSel: sel, from: '' })).toBe(false);
  });

  it('does NOT rehydrate when there is no stored hash (nothing persisted yet)', () => {
    expect(shouldRehydrateBooking({ storedSel: '', currentSel: sel, from: 'widget' })).toBe(false);
    expect(shouldRehydrateBooking({ storedSel: null, currentSel: sel, from: 'cart' })).toBe(false);
  });
});
