import { describe, expect, it } from 'vitest';
import { lineSubtotalMinor, quoteTotalMinor } from '@/lib/quotes/totals';
import { ValidationError } from '@/lib/services/errors';

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

  /**
   * The guards below mirror the CHECK constraints in 20260909000000_quotes.sql
   * (`quantity int not null check (quantity > 0)`,
   * `unit_amount_minor bigint not null check (unit_amount_minor >= 0)`,
   * `subtotal_minor bigint not null check (subtotal_minor >= 0)`). Until the Zod layer lands there is
   * nothing between a request body and this function, so a single negative line must not be allowed
   * to quietly SUBTRACT from a quote total.
   */
  it('rejects a negative quantity so one line cannot reduce the quote total', () => {
    expect(() => lineSubtotalMinor({ quantity: -2, unitAmountMinor: 50000 })).toThrow(
      /at least 1/i,
    );
  });

  it('rejects a zero quantity, matching the quantity > 0 check constraint', () => {
    expect(() => lineSubtotalMinor({ quantity: 0, unitAmountMinor: 50000 })).toThrow(/at least 1/i);
  });

  it('rejects a negative unit amount, matching the unit_amount_minor >= 0 check constraint', () => {
    expect(() => lineSubtotalMinor({ quantity: 2, unitAmountMinor: -50000 })).toThrow(
      /unit amount/i,
    );
  });

  it('never lets a bad line sum into a total', () => {
    expect(() =>
      quoteTotalMinor([
        { quantity: 1, unitAmountMinor: 120000 },
        { quantity: -2, unitAmountMinor: 50000 },
      ]),
    ).toThrow(ValidationError);
  });

  /**
   * A 500 for a mistyped quantity would hide the field error from the owner AND write a row into
   * error_logs — the table operators read to answer "what broke?" — for ordinary user input.
   * src/lib/http/envelope.ts only preserves the message and returns 400 for a ServiceError.
   */
  it('throws ValidationError so the API answers 400 with the message intact', () => {
    for (const line of [
      { quantity: 1.5, unitAmountMinor: 1000 },
      { quantity: 0, unitAmountMinor: 1000 },
      { quantity: -1, unitAmountMinor: 1000 },
      { quantity: 1, unitAmountMinor: -1 },
      { quantity: 1, unitAmountMinor: 10.5 },
    ]) {
      let thrown: unknown;
      try {
        lineSubtotalMinor(line);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `expected ${JSON.stringify(line)} to throw`).toBeInstanceOf(ValidationError);
      expect((thrown as ValidationError).status).toBe(400);
      expect((thrown as ValidationError).code).toBe('validation_error');
    }
  });
});
