import { ValidationError } from '@/lib/services/errors';

/**
 * NOTE: there is no Zod layer above this yet — `src/lib/quotes/types.ts` is deferred, so at present
 * a request body can reach `quoteTotalMinor` unparsed. Until it lands, these guards ARE the only
 * validation between a browser-supplied line and `quotes.total_minor`; keep them in step with the
 * CHECK constraints in supabase/migrations/20260909000000_quotes.sql and do not weaken them on the
 * assumption that something upstream already parsed the payload.
 */
export interface PricedLine {
  quantity: number;
  unitAmountMinor: number;
  /** Optional per-line TRANSPORT ADD-ON fare in minor units — a round-trip transfer attached to this
   *  tour/custom line, charged ON TOP of its own subtotal. Absent/null ⇒ no transfer. Mirrors
   *  `transport_fare_minor bigint check (… is null or >= 0)`. */
  transportFareMinor?: number | null;
}

/** int4, per `quantity int not null check (quantity > 0)` in quote_items / booking_custom_items. */
const MAX_LINE_QUANTITY = 2_147_483_647;

/**
 * Minor units only — never floats. A fractional quantity is a caller bug, not something to round.
 *
 * `quantity` mirrors quote_items / booking_custom_items on BOTH ends: `> 0` and `<= MAX_LINE_QUANTITY`,
 * because the column is int4 and a larger figure dies in Postgres with 22003 `integer out of range` —
 * not a ServiceError, so src/lib/http/envelope.ts would answer an opaque 500 and file an error_logs
 * row for what is only a mistyped quantity. `unitAmountMinor` mirrors `unit_amount_minor >= 0` at the
 * bottom, but the top is TIGHTER than the column: it is `bigint`, whose range comfortably exceeds the
 * exact-integer range of a JS number, so `Number.isSafeInteger` binds first. Together these keep
 * `subtotal_minor >= 0` true by construction: a negative quantity would otherwise produce a negative
 * subtotal that SUBTRACTS from the quote total, silently discounting a quote.
 *
 * The product is checked as well as its operands. Two individually safe factors can multiply into a
 * number JS can no longer represent exactly, and since subtotal_minor / total_minor are `bigint`,
 * Postgres would store the silently-rounded figure without complaint — a wrong number on the money
 * path with no error anywhere.
 */
export function lineSubtotalMinor(line: PricedLine): number {
  if (
    !Number.isSafeInteger(line.quantity) ||
    line.quantity < 1 ||
    line.quantity > MAX_LINE_QUANTITY
  ) {
    throw new ValidationError(
      `Quote line quantity must be a whole number between 1 and ${MAX_LINE_QUANTITY}, got ${line.quantity}`,
    );
  }
  if (!Number.isSafeInteger(line.unitAmountMinor) || line.unitAmountMinor < 0) {
    throw new ValidationError(
      `Quote line unit amount must be a whole number of minor units, got ${line.unitAmountMinor}`,
    );
  }
  const subtotal = line.quantity * line.unitAmountMinor;
  if (!Number.isSafeInteger(subtotal)) {
    throw new ValidationError(`Quote line subtotal ${subtotal} exceeds the exact-integer range`);
  }
  return subtotal;
}

/**
 * The line's transport add-on fare in minor units — absent/null ⇒ 0, else a whole non-negative integer,
 * mirroring `transport_fare_minor bigint check (… is null or >= 0)`. Kept beside `lineSubtotalMinor`
 * because both feed `quoteTotalMinor` and both are the only validation between a browser-supplied figure
 * and the stored total. A negative fare would SUBTRACT from the quote total (a silent discount), so it is
 * refused here exactly as a negative unit amount is.
 */
export function transportFareMinorOf(line: PricedLine): number {
  const fare = line.transportFareMinor;
  if (fare == null) return 0;
  if (!Number.isSafeInteger(fare) || fare < 0) {
    throw new ValidationError(
      `Quote line transport fare must be a whole number of minor units at least 0, got ${fare}`,
    );
  }
  return fare;
}

export function quoteTotalMinor(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => {
    // Line price + its optional transport add-on. Both are validated; the add-on is 0 when absent, so a
    // quote with no transfers is byte-identical to before.
    const total = sum + lineSubtotalMinor(line) + transportFareMinorOf(line);
    if (!Number.isSafeInteger(total)) {
      throw new ValidationError('Quote total exceeds the exact-integer range');
    }
    return total;
  }, 0);
}
