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
}

/**
 * Minor units only — never floats. A fractional quantity is a caller bug, not something to round.
 *
 * The accepted range mirrors quote_items / booking_custom_items exactly: `quantity > 0` and
 * `unit_amount_minor >= 0`, so `subtotal_minor >= 0` holds by construction. A negative quantity would
 * otherwise produce a negative subtotal that SUBTRACTS from the quote total — silently discounting a
 * quote — and would then be rejected by the database anyway, long after the figure had been shown.
 */
export function lineSubtotalMinor(line: PricedLine): number {
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new ValidationError(
      `Quote line quantity must be a whole number of at least 1, got ${line.quantity}`,
    );
  }
  if (!Number.isSafeInteger(line.unitAmountMinor) || line.unitAmountMinor < 0) {
    throw new ValidationError(
      `Quote line unit amount must be a whole number of minor units, got ${line.unitAmountMinor}`,
    );
  }
  return line.quantity * line.unitAmountMinor;
}

export function quoteTotalMinor(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => sum + lineSubtotalMinor(line), 0);
}
