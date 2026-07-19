import { describe, expect, it } from 'vitest';
import {
  detailsHash,
  isBookingPayable,
  selectionHash,
  shouldRehydrateBooking,
  type DetailsInput,
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

  it('scopes the age-band mix: same qty + total, different band split → different hash', () => {
    const twoAdults: SelectionInput = { ...base, party: { Adult: 2 } };
    const adultChild: SelectionInput = { ...base, party: { Adult: 1, Child: 1 } };
    // Same qty (2) and same total, but a different manifest — must NOT collide (a different booking).
    expect(selectionHash(twoAdults)).not.toBe(selectionHash(adultChild));
    // Band mix is order-independent (normalized by sorted keys) and drops zero counts.
    expect(selectionHash({ ...base, party: { Child: 1, Adult: 1 } })).toBe(
      selectionHash(adultChild),
    );
    expect(selectionHash({ ...base, party: { Adult: 2, Infant: 0 } })).toBe(
      selectionHash(twoAdults),
    );
    // An absent party (simple selections) is stable and distinct from a set mix.
    expect(selectionHash({ ...base, party: null })).toBe(selectionHash({ ...base }));
    expect(selectionHash({ ...base, party: null })).not.toBe(selectionHash(twoAdults));
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

// The OPERATIONAL (run-sheet) twin of selectionHash — review item 3. The stash survives a reload on
// purpose (double-charge guard) but the form does not, so pay() compares this hash before reusing a
// rehydrated ref: changed details → fresh booking carrying what the customer actually typed.
describe('detailsHash', () => {
  const base: DetailsInput = {
    customerName: 'Amina Peerbocus',
    customerPhone: '+230 5123 4567',
    customerCountry: 'MU',
    pickupLocation: 'LUX* Belle Mare',
    dropoffLocation: null,
    pickupPending: false,
    flightNumber: 'MK015',
    arrivalTime: '14:30',
    roomOrCabin: '212',
    luggageDetails: '2 large cases',
    childSeatAge: 3,
  };

  it('is deterministic for identical details', () => {
    expect(detailsHash({ ...base })).toBe(detailsHash({ ...base }));
  });

  it('changes when any run-sheet fact changes (flight, hotel, phone, room)', () => {
    expect(detailsHash({ ...base, flightNumber: 'MK043' })).not.toBe(detailsHash(base));
    expect(detailsHash({ ...base, pickupLocation: 'Constance Prince Maurice' })).not.toBe(
      detailsHash(base),
    );
    expect(detailsHash({ ...base, customerPhone: '+230 5999 0000' })).not.toBe(detailsHash(base));
    expect(detailsHash({ ...base, roomOrCabin: '318' })).not.toBe(detailsHash(base));
    expect(detailsHash({ ...base, childSeatAge: null })).not.toBe(detailsHash(base));
  });

  it("normalizes undefined / null / '' identically — a product's absent fields hash stably", () => {
    // The airport payload sets sightseeing-only fields to undefined and vice-versa; a remount must
    // not read a legit same-details replay as drift because '' became undefined.
    expect(detailsHash({ ...base, gender: undefined, company: null, specialNotes: '' })).toBe(
      detailsHash({ ...base, gender: null, company: undefined, specialNotes: null }),
    );
  });

  it('a details change never disturbs selectionHash (the two gates are independent)', () => {
    const sel: SelectionInput = {
      priceLabel: 'Adult',
      qty: 2,
      suv: false,
      childSeats: 0,
      pickupText: '',
      pickupLat: null,
      pickupLng: null,
      pickupTbd: false,
      dropoffText: '',
      itinerary: null,
      total: '90.00',
    };
    const before = selectionHash(sel);
    void detailsHash({ ...base, flightNumber: 'MK043' });
    expect(selectionHash(sel)).toBe(before);
  });
});

// The drift gate's safety interlock: the remedy for drifted details (abandon the ref, mint a fresh
// PAYABLE booking) may only run against a booking the server would still let the customer pay. This
// predicate mirrors api_create_payment's booking_not_payable guard — abandoning a PAID booking would
// route around that refusal and produce a second live charge for the same trip.
describe('isBookingPayable', () => {
  it('allows the pre-payment states the server allows through', () => {
    for (const status of ['draft', 'held', 'payment_pending']) {
      expect(isBookingPayable({ status, paymentState: 'pending' })).toBe(true);
      // A failed earlier attempt is retryable server-side, so the drift remedy stays available.
      expect(isBookingPayable({ status, paymentState: 'failed' })).toBe(true);
    }
  });

  it('refuses every paid payment state regardless of status (the double-charge case)', () => {
    for (const paymentState of ['paid', 'partially_refunded', 'refunded']) {
      expect(isBookingPayable({ status: 'payment_pending', paymentState })).toBe(false);
      expect(isBookingPayable({ status: 'confirmed', paymentState })).toBe(false);
    }
  });

  it('refuses every terminal/confirmed status the server refuses', () => {
    for (const status of [
      'confirmed',
      'completed',
      'cancelled',
      'expired',
      'refund_pending',
      'refunded',
      'failed',
    ]) {
      expect(isBookingPayable({ status, paymentState: 'pending' })).toBe(false);
    }
  });

  it('fails SAFE on missing or unrecognised values (allow-list, not block-list)', () => {
    expect(isBookingPayable({})).toBe(false);
    expect(isBookingPayable({ status: null, paymentState: null })).toBe(false);
    expect(isBookingPayable({ status: 'payment_pending' })).toBe(false);
    expect(isBookingPayable({ paymentState: 'pending' })).toBe(false);
    // A status/state added server-side later must not silently re-enable the risky remedy.
    expect(isBookingPayable({ status: 'some_future_state', paymentState: 'pending' })).toBe(false);
    expect(isBookingPayable({ status: 'held', paymentState: 'some_future_state' })).toBe(false);
  });
});
