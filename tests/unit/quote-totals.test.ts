import { describe, expect, it } from 'vitest';
import { lineSubtotalMinor, quoteTotalMinor, transportFareMinorOf } from '@/lib/quotes/totals';
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

/**
 * The per-line transport add-on (20260924000000): a round-trip transfer attached to a tour/custom line is
 * charged ON TOP of the line's own subtotal, so `quoteTotalMinor` must add it. It mirrors
 * `transport_fare_minor bigint check (… is null or >= 0)`: absent/null is 0, and a negative fare must be
 * refused exactly like a negative unit amount — otherwise an attached transfer could SUBTRACT from a quote.
 */
describe('quote totals — the transport add-on', () => {
  it('treats an absent or null fare as zero', () => {
    expect(transportFareMinorOf({ quantity: 1, unitAmountMinor: 5000 })).toBe(0);
    expect(
      transportFareMinorOf({ quantity: 1, unitAmountMinor: 5000, transportFareMinor: null }),
    ).toBe(0);
  });

  it('adds the fare to the line, on top of its own subtotal', () => {
    // Dolphin swim (2 × €60 = €120) with a €60 round-trip transfer attached → €180.
    expect(
      quoteTotalMinor([{ quantity: 2, unitAmountMinor: 6000, transportFareMinor: 6000 }]),
    ).toBe(18000);
  });

  it('sums line prices AND their transfers across the whole quote', () => {
    expect(
      quoteTotalMinor([
        { quantity: 2, unitAmountMinor: 6000, transportFareMinor: 6000 }, // 120 + 60
        { quantity: 2, unitAmountMinor: 5500, transportFareMinor: 3000 }, // 110 + 30
        { quantity: 1, unitAmountMinor: 9000 }, // 90, no transfer
      ]),
    ).toBe(41000);
  });

  it('leaves a quote with no transfers byte-identical to before', () => {
    expect(
      quoteTotalMinor([
        { quantity: 2, unitAmountMinor: 5500 },
        { quantity: 1, unitAmountMinor: 12000 },
      ]),
    ).toBe(23000);
  });

  it('refuses a negative fare so an add-on cannot discount the quote', () => {
    expect(() =>
      transportFareMinorOf({ quantity: 1, unitAmountMinor: 5000, transportFareMinor: -100 }),
    ).toThrow(/transport fare/i);
    expect(() =>
      quoteTotalMinor([{ quantity: 1, unitAmountMinor: 12000, transportFareMinor: -100 }]),
    ).toThrow(ValidationError);
  });

  it('refuses a fractional fare instead of rounding money nobody typed', () => {
    expect(() =>
      transportFareMinorOf({ quantity: 1, unitAmountMinor: 5000, transportFareMinor: 60.5 }),
    ).toThrow(ValidationError);
  });
});
