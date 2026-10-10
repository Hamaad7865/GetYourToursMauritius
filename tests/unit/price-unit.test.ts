import { describe, expect, it } from 'vitest';
import { durationLabel, priceUnit } from '@/lib/catalogue/price-unit';

/**
 * The line under a card's "From" price. Two cards read it now (the grid card and the homepage's
 * "Continue planning" card), and the failure it guards against is a quiet one: a per-vehicle or
 * per-group figure captioned "per person" understates the price by the size of the party.
 */

const t = (key: string, vars?: Record<string, string | number>) =>
  Object.entries(vars ?? {}).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), key);

const base = {
  type: 'activity',
  pricingMode: 'per_person',
  fromPriceIncluded: null,
  fromPriceMaxGuests: null,
} as const;

describe('priceUnit', () => {
  it('reads "per person" for an ordinary per-person tour', () => {
    expect(priceUnit(base, t)).toBe('per person');
  });

  it('reads a transfer as per vehicle, whatever its pricing mode', () => {
    expect(priceUnit({ ...base, type: 'transport' }, t)).toBe('per vehicle');
  });

  it('reads a vehicle-priced sightseeing tour as a group of up to four (the entry sedan)', () => {
    expect(priceUnit({ ...base, pricingMode: 'vehicle' }, t)).toBe('per group up to 4 people');
  });

  it('reads a per-group tour as a group price, with the size when it is known', () => {
    expect(priceUnit({ ...base, pricingMode: 'per_group', fromPriceMaxGuests: 6 }, t)).toBe(
      'per group up to 6 people',
    );
  });

  it('never falls back to "per person" for a per-group tour whose size is missing', () => {
    expect(priceUnit({ ...base, pricingMode: 'per_group' }, t)).toBe('per group');
  });

  it('reads a private charter by how many guests the flat base covers', () => {
    expect(priceUnit({ ...base, pricingMode: 'per_group', fromPriceIncluded: 8 }, t)).toBe(
      'up to 8 people',
    );
  });
});

describe('durationLabel', () => {
  it('is null when the tour has no duration', () => {
    expect(durationLabel(null, t)).toBeNull();
  });

  it('uses minutes under an hour and hours from there', () => {
    expect(durationLabel(45, t)).toBe('45 min');
    expect(durationLabel(60, t)).toBe('1 hour');
    expect(durationLabel(420, t)).toBe('7 hours');
    expect(durationLabel(210, t)).toBe('3.5 hours');
  });
});
