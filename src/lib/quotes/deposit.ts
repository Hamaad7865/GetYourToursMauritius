/**
 * THE ONE DEFINITION OF WHAT THE GUEST PAYS NOW.
 *
 * `quotes.deposit_bps` is the share of the total that confirms the booking, in BASIS POINTS (1000 =
 * 10.00%, the schema default; 10000 = pay-in-full). api_convert_quote sizes the first `payments` row
 * from it as `round(total_minor * deposit_bps / 10000)` and leaves the rest on
 * `bookings.balance_due_minor` for the balance link.
 *
 * That arithmetic now has three readers — the editor's preview, the guest's quote email and the
 * guest's quote page — and the figure they print is the figure a card is charged. So it lives here,
 * once, rather than being restated next to each of them: a template that did its own `Math.floor` or
 * its own `× 0.1` would quote a deposit the money path never takes, and nothing would fail.
 *
 * Basis points, never a float percent: 12.5% is 1250 exactly, where 0.125 invites a `total * 0.125`
 * that lands a cent out on totals the fixed-point path handles exactly.
 *
 * Pure — no I/O, no clock. Mirrors the SQL cent-for-cent, `Math.round` against Postgres's half-up
 * `round()` on a positive numeric.
 */

/** The product default: a 10% deposit, in basis points. Mirrors `quotes.deposit_bps`'s schema default. */
export const DEFAULT_DEPOSIT_BPS = 1000;

/** Pay-in-full, in basis points — the single-charge path api_convert_quote leaves unchanged. */
export const PAY_IN_FULL_BPS = 10000;

/** Whether this quote takes the whole total up front, i.e. leaves no balance to collect later. */
export function isPayInFull(bps: number): boolean {
  return bps >= PAY_IN_FULL_BPS;
}

/**
 * What the guest is charged to confirm, in MINOR units — `round(total × bps / 10000)`, matching
 * api_convert_quote's own sizing so what is quoted is what is taken.
 */
export function depositMinorOf(totalMinor: number, bps: number): number {
  return Math.round((totalMinor * bps) / 10000);
}

/**
 * What is left to collect afterwards, in MINOR units. Clamped at zero: a bps above 10000 is refused
 * by the column's CHECK and by saveQuote, but a negative "balance" printed in a guest email would be
 * a refund promise nobody made.
 */
export function balanceMinorOf(totalMinor: number, bps: number): number {
  return Math.max(0, totalMinor - depositMinorOf(totalMinor, bps));
}

/**
 * Basis points as the percentage a human reads — '10%', '12.5%'.
 *
 * Trailing zeros are trimmed so the common whole percentages stay clean, and the one decimal a
 * basis-point value can carry (1250 -> 12.5) survives. Formatted from integer arithmetic, so the
 * label cannot disagree with the amount beside it.
 */
export function depositPercentLabel(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = Math.abs(bps % 100);
  if (fraction === 0) return `${whole}%`;
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}%`;
}
