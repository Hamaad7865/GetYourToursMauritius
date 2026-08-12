import { ValidationError } from '@/lib/services/errors';

/**
 * Money + currency helpers for the Documents module.
 *
 * Every amount is an integer count of MINOR units (cents). MUR, EUR and USD are all ISO exponent-2
 * currencies, so the conversion to and from major units is a uniform ×100 / ÷100 — the module never
 * holds a float major-unit amount on the money path. A float appears only in `formatMinor`, and only
 * to render two decimals for display.
 */

export type Currency = 'MUR' | 'EUR' | 'USD';

export const CURRENCIES: Currency[] = ['MUR', 'EUR', 'USD'];

/**
 * The symbol printed on the document, per currency. WinAnsi-safe by construction: the PDF renderer
 * draws these with Helvetica, whose encoding cannot represent the € glyph cleanly (see the note in
 * `src/lib/invoice/pdf.ts`), so EUR shows as its code and USD as the ASCII "US$".
 */
export const CURRENCY_SYMBOL: Record<Currency, string> = {
  MUR: 'Rs',
  EUR: 'EUR',
  USD: 'US$',
};

/** Human currency names for the editor's currency picker. */
export const CURRENCY_LABEL: Record<Currency, string> = {
  MUR: 'Mauritian Rupee (Rs)',
  EUR: 'Euro (EUR)',
  USD: 'US Dollar (US$)',
};

export function isCurrency(value: unknown): value is Currency {
  return value === 'MUR' || value === 'EUR' || value === 'USD';
}

/**
 * Parse a typed amount ("58,000", "58000.50", " 1 234.5 ") into MINOR units. Grouping commas and
 * whitespace are stripped; the result must be a finite, non-negative, safe integer number of cents.
 * Throws a {@link ValidationError} otherwise — the same fail-closed discipline the quote-total path
 * uses, because this figure is exactly what a client is billed.
 */
export function parseAmountToMinor(input: string): number {
  const cleaned = (input ?? '').trim().replace(/[,\s]/g, '');
  if (cleaned === '') throw new ValidationError('Enter an amount.');
  // At least one digit before an optional 1–2 decimal places. Rejects a leading dot, a trailing dot,
  // a sign, and any stray character — the string came from an operator's keyboard, not a validated form.
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new ValidationError(`"${input}" is not a valid amount.`);
  }
  const minor = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new ValidationError(`"${input}" is out of range.`);
  }
  return minor;
}

/** Minor units → major (e.g. 5800000 → 58000). For display/formatting only. */
export function minorToMajor(minor: number): number {
  return minor / 100;
}

/**
 * 2-decimal, comma-grouped amount from minor units (e.g. 5800000 → "58,000.00"). ASCII only, so it is
 * WinAnsi-safe and can be drawn straight into the PDF. Mirrors `formatGrouped` in the invoice renderer.
 */
export function formatMinor(minor: number): string {
  const [int, frac] = (minor / 100).toFixed(2).split('.');
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}
