import { describe, expect, it } from 'vitest';
import { lineSubtotalMinor, quoteTotalMinor } from '@/lib/quotes/totals';

/**
 * A quote total is money, so it is minor units and integers all the way down. An empty quote must be
 * 0 rather than NaN, and a fractional quantity is a caller bug that has to surface loudly — silently
 * rounding it would charge a guest a figure nobody ever quoted.
 */
describe('quote totals', () => {
  it('multiplies unit by quantity', () => {
    expect(lineSubtotalMinor({ quantity: 3, unitAmountMinor: 4500 })).toBe(13500);
  });

  it('sums every line', () => {
    expect(
      quoteTotalMinor([
        { quantity: 2, unitAmountMinor: 5500 },
        { quantity: 1, unitAmountMinor: 12000 },
      ]),
    ).toBe(23000);
  });

  it('is zero for an empty quote rather than NaN', () => {
    expect(quoteTotalMinor([])).toBe(0);
  });

  it('rejects a fractional quantity instead of silently rounding money', () => {
    expect(() => lineSubtotalMinor({ quantity: 1.5, unitAmountMinor: 1000 })).toThrow(
      /whole number/i,
    );
  });
});
