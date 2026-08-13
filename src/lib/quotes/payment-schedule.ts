import { formatMauritiusDate } from '@/lib/invoice/mauritius-time';

/**
 * The guest-facing per-date PAYMENT schedule, computed from a quote's lines — BEFORE the booking (and
 * its `booking_installments`) exists.
 *
 * Not to be confused with `./schedule.ts`'s `proposeSchedule`, which SPACES excursions across a stay
 * for the AI draft. This is about MONEY: when a quote is sent `payment_mode = 'per_date'`,
 * api_convert_quote (migration 20260930000000) splits the balance into ONE installment per activity
 * DATE — seq 0 is the earliest date and IS the deposit (it secures every seat), and each later date is
 * a dated balance link chased before it falls due. That grouping only runs at conversion, so the quote
 * email and the public quote page — which ask the guest to ACCEPT these terms — had no way to state
 * them, and fell back to the "% deposit + balance later" sentence, which for a per_date quote is simply
 * the wrong amount and the wrong plan (adversarial review finding).
 *
 * This is the ONE place the schedule is derived for those two surfaces plus the operator's preview, so
 * they cannot disagree. It mirrors the RPC's grouping byte-for-byte — the SAME expression, in the SAME
 * Mauritius-local timezone — and an integration parity test (tests/integration/payment-schedule.test.ts)
 * pins the two together: it converts a quote and asserts this function's output equals the rows
 * api_convert_quote wrote. Change one without the other and that test goes red.
 *
 * Pure: no I/O, no Date.now()/new Date(). Mauritius keeps a FIXED UTC+4 offset (no DST), so the local
 * date is an arithmetic shift — see {@link formatMauritiusDate}, which is why this is edge-safe where
 * `Intl` timeZone would not be.
 */

/** One priced quote line, in the only three fields the schedule needs. */
export interface QuoteScheduleLine {
  /** The activity instant (ISO), or null for a line with no date (folds into the earliest date). */
  startsAt: string | null;
  /** The line subtotal in minor units — quantity × unit, WITHOUT the transport add-on. */
  subtotalMinor: number;
  /** The per-line round-trip transfer fare in minor units, or 0. Part of the date's amount and the total. */
  transportFareMinor: number;
}

/** One installment as the guest is shown it: the date it covers and what is collected for it. */
export interface QuoteInstallmentPreview {
  /** 0-based, in date order. seq 0 is the deposit (earliest date), collected at confirmation. */
  seq: number;
  /** The Mauritius-local calendar day, `yyyy-mm-dd` — the same `due_on` api_convert_quote stores. */
  dueOn: string;
  /** Σ(subtotal + transport) of every line on this date, in minor units. */
  amountMinor: number;
}

/**
 * Group a quote's lines into one installment per Mauritius-local activity date.
 *
 * Returns `[]` when NO line carries a date — exactly the case in which api_convert_quote leaves
 * `v_per_date` false and falls back to the percentage deposit, so an empty result is the signal to the
 * caller to render the ordinary deposit terms. A single dated date yields one installment whose amount
 * is the whole chargeable total (all activities fall on it), i.e. an effective pay-in-full-that-date.
 *
 * Zero-amount dates are EXCLUDED (a complimentary activity is not an installment — nothing to collect),
 * mirroring the RPC's `having Σ > 0`: keeping a €0 seq-0 row would collide with create_payment's
 * "no deposit" sentinel and bill the whole total. seq 0 is therefore the first date with a POSITIVE
 * amount, the exact figure the deposit charges.
 *
 * The amount for a date is Σ(subtotal + transport) over its lines — the identical expression the RPC's
 * `quote_total_mismatch` check pins the stored `total_minor` to, so the installments always sum to the
 * total with no cent lost or invented.
 */
export function computeQuoteSchedule(lines: QuoteScheduleLine[]): QuoteInstallmentPreview[] {
  // The earliest dated day, Mauritius-local. A quote with no dated line has no schedule to build.
  let minDate: string | null = null;
  for (const line of lines) {
    const day = formatMauritiusDate(line.startsAt);
    if (day && (minDate === null || day < minDate)) minDate = day;
  }
  if (minDate === null) return [];

  // Sum each date's chargeable amount. A null-dated line folds into the earliest date, exactly as the
  // RPC's `coalesce((starts_at at time zone 'Indian/Mauritius')::date, v_min_date)` does.
  const byDate = new Map<string, number>();
  for (const line of lines) {
    const day = formatMauritiusDate(line.startsAt) || minDate;
    const add = (line.subtotalMinor || 0) + (line.transportFareMinor || 0);
    byDate.set(day, (byDate.get(day) ?? 0) + add);
  }

  return [...byDate.entries()]
    .filter(([, amountMinor]) => amountMinor > 0) // zero dates are not installments — matches `having Σ > 0`
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dueOn, amountMinor], seq) => ({ seq, dueOn, amountMinor }));
}

/**
 * What an installment's pay link — and its reminder email — collects NOW: the running total up to and
 * including `seq`, minus what is already settled, clamped to `[0, balanceDueMinor]`. This is the EXACT
 * figure `api_create_payment` sizes the checkout to and `api_enqueue_installment_reminders` prints in the
 * email, so the manual "send reminder now" route can display the same amount without a second source of
 * truth. `installments` is the booking's schedule (each `{ seq, amountMinor }`); order does not matter.
 *
 * 0 means this installment (and everything before it) is already covered by settlement — nothing to
 * charge, and the reason a caller refuses to send a reminder for it.
 */
export function installmentChargeMinor(
  installments: Array<{ seq: number; amountMinor: number }>,
  seq: number,
  totalMinor: number,
  balanceDueMinor: number,
): number {
  const settled = totalMinor - balanceDueMinor;
  const cumulative = installments
    .filter((i) => i.seq <= seq)
    .reduce((sum, i) => sum + i.amountMinor, 0);
  return Math.max(0, Math.min(balanceDueMinor, cumulative - settled));
}

/**
 * A schedule date as the guest reads it — "5 Sep 2026", matching the `to_char(due_on, 'FMDD Mon YYYY')`
 * label api_convert_quote stores on `booking_installments`. Edge-safe: parses the `yyyy-mm-dd` directly
 * rather than through `Intl`, so no ICU timezone data is needed and the day never shifts.
 */
export function formatScheduleDate(dueOn: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueOn);
  if (!m) return dueOn;
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${Number(m[3])} ${month} ${m[1]}`;
}
