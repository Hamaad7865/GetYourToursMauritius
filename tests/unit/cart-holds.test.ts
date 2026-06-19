import { describe, expect, it } from 'vitest';
import { dropExpiredHolds, expiringSoon, markHeld, markUnavailable } from '@/lib/cart/cart-holds';
import type { CartItem } from '@/lib/cart/useCart';

const line = (over: Partial<CartItem> = {}): CartItem => ({
  id: 'occ#Adult', slug: 's', title: 'T', image: null, occurrenceId: 'occ',
  dateLabel: 'Mon', lang: 'English', priceLabel: 'Adult', guests: 2, unitEur: 50,
  pricingMode: 'per_person', maxGuests: null, seatsLeft: 10, unit: 'per person',
  addedAt: 0, status: 'saved', idemKey: 'k1', ...over,
});

const NOW = 1_000_000;

describe('dropExpiredHolds', () => {
  it('keeps saved lines regardless of age', () => {
    const items = [line({ status: 'saved', addedAt: 0 })];
    expect(dropExpiredHolds(items, NOW).kept).toHaveLength(1);
  });
  it('keeps held lines whose expiresAt is in the future', () => {
    const items = [line({ status: 'held', holdId: 'h1', expiresAt: new Date(NOW + 60_000).toISOString() })];
    const r = dropExpiredHolds(items, NOW);
    expect(r.kept).toHaveLength(1);
    expect(r.expired).toHaveLength(0);
  });
  it('drops held lines whose expiresAt has passed and reports them', () => {
    const items = [line({ status: 'held', holdId: 'h1', expiresAt: new Date(NOW - 1).toISOString() })];
    const r = dropExpiredHolds(items, NOW);
    expect(r.kept).toHaveLength(0);
    expect(r.expired.map((i) => i.id)).toEqual(['occ#Adult']);
  });
  it('drops unavailable lines and reports them', () => {
    const items = [line({ status: 'unavailable' })];
    const r = dropExpiredHolds(items, NOW);
    expect(r.kept).toHaveLength(0);
    expect(r.unavailable.map((i) => i.id)).toEqual(['occ#Adult']);
  });
});

describe('markHeld / markUnavailable', () => {
  it('markHeld stamps holdId + expiresAt and flips status', () => {
    const next = markHeld([line()], 'occ#Adult', { holdId: 'h9', expiresAt: 'iso' });
    expect(next[0]).toMatchObject({ status: 'held', holdId: 'h9', expiresAt: 'iso' });
  });
  it('markUnavailable flips status and clears any hold', () => {
    const next = markUnavailable([line({ status: 'held', holdId: 'h9' })], 'occ#Adult');
    expect(next[0]).toMatchObject({ status: 'unavailable', holdId: undefined });
  });
});

describe('expiringSoon', () => {
  it('flags a held line within the 5-minute window', () => {
    const soon = line({ status: 'held', holdId: 'h', expiresAt: new Date(NOW + 4 * 60_000).toISOString() });
    const far = line({ id: 'x', status: 'held', holdId: 'h', expiresAt: new Date(NOW + 10 * 60_000).toISOString() });
    expect(expiringSoon([soon, far], NOW).map((i) => i.id)).toEqual(['occ#Adult']);
  });
});
