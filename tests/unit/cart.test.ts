import { describe, expect, it } from 'vitest';
import { itemTotal, lineCap, type CartItem } from '@/lib/cart/useCart';

// itemTotal is a pure export; importing useCart.ts is safe in the node env (React core imports fine,
// the hooks are never invoked). The localStorage-backed setGuests hook itself is not node-testable, so
// its child-seat clamp is covered below via the same pure arithmetic it now uses.

const base: CartItem = {
  id: 'occ#Adult',
  slug: 's',
  title: 'T',
  image: null,
  occurrenceId: 'occ',
  dateLabel: 'Mon',
  lang: 'English',
  priceLabel: 'Adult',
  guests: 3,
  unitEur: 50,
  pricingMode: 'per_person',
  maxGuests: null,
  seatsLeft: 10,
  unit: 'per person',
  childSeats: 3,
  addedAt: 0,
  status: 'saved',
  idemKey: 'test-key',
};

describe('itemTotal — child-seat add-on never exceeds the party', () => {
  it('charges per the party when childSeats <= guests (first free, €6 each extra)', () => {
    expect(itemTotal({ ...base, guests: 3, childSeats: 3 })).toBe(162); // 3×€50 + childSeatsCost(3)=€12
  });
  it('caps the child-seat fee to a lowered party size (no stale inflation)', () => {
    expect(itemTotal({ ...base, guests: 1, childSeats: 3 })).toBe(50); // seats capped to 1 → €0 extra
  });
  it('per_group: caps child seats to guests, not the group count', () => {
    expect(
      itemTotal({
        ...base,
        pricingMode: 'per_group',
        unitEur: 110,
        maxGuests: 4,
        guests: 1,
        childSeats: 4,
      }),
    ).toBe(110); // 1 group flat, child capped to 1 → €0 extra
  });
});

describe('lineCap — a full slot caps the stepper (no falsy-zero → Infinity)', () => {
  it('caps at seatsLeft when the slot has room', () => {
    expect(
      lineCap({ ...base, pricingMode: 'per_person', maxGuests: null, guests: 2, seatsLeft: 5 }),
    ).toBe(5);
  });
  it('seatsLeft=0 (slot filled after add) holds at the current size, never widens to Infinity', () => {
    expect(
      lineCap({ ...base, pricingMode: 'per_person', maxGuests: null, guests: 3, seatsLeft: 0 }),
    ).toBe(3);
  });
  it('still honours the per-person tier cap', () => {
    expect(
      lineCap({ ...base, pricingMode: 'per_person', maxGuests: 4, guests: 2, seatsLeft: 10 }),
    ).toBe(4);
  });
});

describe("setGuests clamp logic (pure mirror — the localStorage-backed hook isn't node-testable)", () => {
  const clamp = (i: CartItem, guests: number) => {
    const next = Math.max(1, Math.min(lineCap(i), guests));
    return { guests: next, childSeats: Math.min(i.childSeats ?? 0, next) };
  };
  it('lowering guests pulls childSeats down with it', () => {
    expect(clamp({ ...base, guests: 3, childSeats: 3 }, 1)).toEqual({ guests: 1, childSeats: 1 });
  });
  it('raising guests leaves the smaller childSeats untouched', () => {
    expect(clamp({ ...base, guests: 1, childSeats: 1 }, 4)).toEqual({ guests: 4, childSeats: 1 });
  });
});

describe('private cart line (party map, trips-counted seatsLeft)', () => {
  it('lineCap keeps a private line at its own size — never clamped by the 1-trip seatsLeft', () => {
    const line = {
      id: 'p1',
      slug: 's',
      title: 'T',
      image: null,
      occurrenceId: 'o',
      dateLabel: 'd',
      lang: 'English',
      priceLabel: 'Private charter',
      guests: 6,
      unitEur: 140, // whole flat price (base €90 + 2 × €25)
      pricingMode: 'per_person',
      party: { 'Private charter': 6 },
      childSeats: 0,
      maxGuests: null,
      seatsLeft: 1, // 1 TRIP left — not 1 person
      unit: 'per private trip',
      status: 'held',
      addedAt: 0,
      idemKey: 'k',
    } as unknown as Parameters<typeof lineCap>[0];
    expect(lineCap(line)).toBe(6);
    // …and the flat price is never re-multiplied by the guest count.
    expect(itemTotal(line)).toBe(140);
  });
});
