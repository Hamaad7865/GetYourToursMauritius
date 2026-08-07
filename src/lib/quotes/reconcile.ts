/**
 * Reading the figures a HUMAN already stated in a pasted enquiry thread, so a drafted quote can be
 * cross-checked against them (Phase 2 — the Christophe €536-vs-€616 case).
 *
 * This is a deterministic TEXT scan, deliberately kept off the AI path. The extraction schema carries
 * no price field on purpose — `quote-extraction.test.ts` asserts the model output never contains one —
 * because a number the model invents could become a charge. A figure read straight out of the pasted
 * correspondence is different in kind: it is what a person wrote, surfaced only to SHOW beside the
 * computed total. Nothing here prices a line or reaches the money path; it drives one banner.
 *
 * EUR only, because a quote is EUR only (see src/lib/admin/quotes.ts). Money in MINOR units, like the
 * rest of the module.
 */

export interface StatedAmount {
  /** The figure, in EUR minor units (cents). */
  amountMinor: number;
  /** A short slice of the line it was written on, for the operator to recognise it by. */
  label: string;
  /** True when a human called this a total ("total" / "montant" nearby), so the banner can lead with
   *  the grand totals rather than every per-line tariff. */
  isTotal: boolean;
}

// A number adjacent to €, EUR or euro(s) — on either side. The inner run allows spaces, dots and
// commas so "1 234,56" is one figure; it must start and end on a digit so a stray separator is not
// swallowed. `\b` before `eur` keeps the French "leur" from reading as a currency mark.
const AMOUNT_RE =
  /(?:€|\beur(?:os?)?\b)\s*(\d[\d .,]*\d|\d)|(\d[\d .,]*\d|\d)\s*(?:€|\beur(?:os?)?\b)/gi;

// "total" / "montant" (EN + FR) near the figure marks it as a stated total rather than a line price.
const TOTAL_HINT = /total|montant/i;

/**
 * A written figure like "1 234,56" as minor units, or null when it is not a number.
 *
 * The separators are ambiguous across locales, so the decimal point is decided by shape, never
 * assumed: with both `.` and `,` the rightmost is the decimal; a lone `,` (or `.`) is a decimal only
 * when 1–2 digits trail it, otherwise it is a thousands separator. This is the same care
 * `parseEurosToMinor` takes — money read wrong is money charged wrong — bounded to what a thread says.
 */
function toMinor(raw: string): number | null {
  let s = raw.replace(/\s/g, '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    s =
      s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
  } else if (hasComma) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hasDot && !/\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Every distinct EUR figure a human stated in `text`, largest first, each flagged if it was called a
 * total. Repeated figures collapse to one entry (a total mention wins, so "536" written as a line and
 * again as the total reads as a total).
 */
export function extractStatedAmounts(text: string): StatedAmount[] {
  const byAmount = new Map<number, StatedAmount>();
  for (const m of text.matchAll(AMOUNT_RE)) {
    const raw = m[1] ?? m[2] ?? '';
    const amountMinor = toMinor(raw);
    if (amountMinor === null) continue;

    // The text on this line up to the figure, for a readable label and the total test.
    const start = m.index ?? 0;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const before = text.slice(lineStart, start);
    const isTotal = TOTAL_HINT.test(before);
    const label = before.replace(/\s+/g, ' ').trim().slice(-48);

    const existing = byAmount.get(amountMinor);
    if (!existing) {
      byAmount.set(amountMinor, { amountMinor, label, isTotal });
    } else if (isTotal && !existing.isTotal) {
      existing.isTotal = true;
      if (label) existing.label = label;
    } else if (!existing.label && label) {
      existing.label = label;
    }
  }
  return [...byAmount.values()].sort((a, b) => b.amountMinor - a.amountMinor);
}

/**
 * Does the computed quote total match NONE of the figures the thread called a total — the signal that
 * the priced quote agrees with neither what was promised nor its correction, and should be looked at.
 *
 * False while there is nothing to check (no stated totals) or nothing priced yet (total ≤ 0), so the
 * banner informs rather than nags as the operator is still pricing lines.
 */
export function totalsMismatch(computedMinor: number, stated: StatedAmount[]): boolean {
  if (computedMinor <= 0) return false;
  const totals = stated.filter((s) => s.isTotal).map((s) => s.amountMinor);
  if (totals.length === 0) return false;
  return !totals.includes(computedMinor);
}
