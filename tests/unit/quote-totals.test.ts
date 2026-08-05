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
      /between 1 and/i,
    );
  });

  it('rejects a zero quantity, matching the quantity > 0 check constraint', () => {
    expect(() => lineSubtotalMinor({ quantity: 0, unitAmountMinor: 50000 })).toThrow(
      /between 1 and/i,
    );
  });

  it('rejects a negative unit amount, matching the unit_amount_minor >= 0 check constraint', () => {
    expect(() => lineSubtotalMinor({ quantity: 2, unitAmountMinor: -50000 })).toThrow(
      /unit amount/i,
    );
  });

  /**
   * The accepting side of the same boundaries. Without these, a later "tightening" to
   * `unitAmountMinor < 1` or `quantity <= 1` would leave this file green while making a
   * complimentary line and a single-unit line un-quotable — both of which the CHECK constraints
   * (`unit_amount_minor >= 0`, `quantity > 0`) allow on purpose.
   */
  it('accepts a zero-priced line, matching unit_amount_minor >= 0', () => {
    expect(lineSubtotalMinor({ quantity: 2, unitAmountMinor: 0 })).toBe(0);
  });

  it('accepts a single unit, the lowest quantity the check constraint allows', () => {
    expect(lineSubtotalMinor({ quantity: 1, unitAmountMinor: 4500 })).toBe(4500);
  });

  /**
   * `quantity` is `int` (int4) in BOTH quote_items and booking_custom_items, so anything above
   * 2,147,483,647 is rejected by Postgres with SQLSTATE 22003 `integer out of range` — which is not a
   * ServiceError, so src/lib/http/envelope.ts falls through to `unhandled_api_error`: an opaque 500
   * plus an error_logs row for what is only a fat-fingered quantity in the line editor.
   */
  it('rejects a quantity above int4, which Postgres would reject as an opaque 500', () => {
    expect(() => lineSubtotalMinor({ quantity: 3_000_000_000, unitAmountMinor: 100 })).toThrow(
      ValidationError,
    );
    expect(lineSubtotalMinor({ quantity: 2_147_483_647, unitAmountMinor: 0 })).toBe(0);
  });

  /**
   * Guarding the operands is not the same as guarding the money. subtotal_minor and total_minor are
   * `bigint`, so Postgres accepts a silently-rounded product without complaint, and total_minor is
   * "copied straight into bookings.total_minor at conversion" (migration line 66). A wrong figure
   * must not reach the money path just because both factors were individually safe.
   */
  it('rejects a line whose subtotal loses integer precision', () => {
    // 3 * 9007199254740991 is exactly 27021597764222973; JS computes 27021597764222972.
    expect(() =>
      lineSubtotalMinor({ quantity: 3, unitAmountMinor: Number.MAX_SAFE_INTEGER }),
    ).toThrow(ValidationError);
  });

  it('rejects a total that overflows even though every line is individually exact', () => {
    expect(() =>
      quoteTotalMinor([
        { quantity: 1, unitAmountMinor: Number.MAX_SAFE_INTEGER },
        { quantity: 1, unitAmountMinor: 2 },
      ]),
    ).toThrow(ValidationError);
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
      { quantity: 3_000_000_000, unitAmountMinor: 1000 },
      { quantity: 3, unitAmountMinor: Number.MAX_SAFE_INTEGER },
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
