import { loadBookingsInRange, type BookingRow } from './bookings';

/* Reports & tax view-model. Like dashboard.ts, all figures are DERIVED from the bookings staff can
 * already read — pure, unit-testable, Mauritius-local (GMT+4). Money basis is CASH: gross paid and
 * refunds come from the payments ledger (grossPaidEur / refundedEur), so refunds correctly reduce
 * revenue and the VAT owed on it.
 *
 * VAT: our prices are VAT-INCLUSIVE at 15%, so the VAT baked into net revenue is net × 15/115. This is
 * informational only — it does not assert Belle Mare's VAT status; the owner/accountant decide what's
 * owed. Attribution: a booking's money is attributed to the month it was CREATED (bookings pay
 * immediately via checkout, so created ≈ the tax point). A booking refunded in a later month therefore
 * books that refund in its ORIGINAL month — a known simplification, noted in the UI. */

const TZ = 'Indian/Mauritius';
export const VAT_RATE = 0.15;

export interface MonthRow {
  key: string; // "YYYY-MM"
  label: string; // "Jan"
  grossPaidEur: number; // money in (Σ paid)
  refundedEur: number; // money out (Σ refunded)
  netEur: number; // net kept = gross − refunds
  vatEur: number; // VAT portion of net (net × 15/115)
  exVatEur: number; // net − VAT
  bookings: number; // paid bookings that month
}
export type ReportTotals = Omit<MonthRow, 'key' | 'label'>;
export interface TallyRow {
  name: string;
  bookings: number;
  netEur: number;
}
export interface ReportData {
  year: number;
  months: MonthRow[]; // 12 rows, Jan..Dec
  totals: ReportTotals; // year totals (= Σ of the displayed monthly rows, so columns reconcile)
  byTour: TallyRow[]; // net-desc
  bySource: TallyRow[]; // net-desc
  netSeries: { label: string; value: number }[]; // monthly net kept, for the chart
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** "YYYY-MM" for an instant, in Mauritius local time. */
function mauMonthKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
}
function monthShort(monthIndex0: number): string {
  return new Date(Date.UTC(2000, monthIndex0, 1)).toLocaleDateString('en-GB', { month: 'short' });
}

/** The UTC [from, to) instants bounding a full Mauritius calendar year (UTC+4, no DST). */
export function mauYearRangeUtc(year: number): [string, string] {
  const offsetMs = 4 * 3600 * 1000;
  const from = new Date(Date.UTC(year, 0, 1) - offsetMs);
  const to = new Date(Date.UTC(year + 1, 0, 1) - offsetMs);
  return [from.toISOString(), to.toISOString()];
}

/** Money formatter for reports — 2 decimals (VAT precision matters), thousands-separated. */
export function eur2(n: number): string {
  return `€${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Pure: aggregate the year's bookings into the reports view-model. */
export function computeReports(bookings: BookingRow[], year: number): ReportData {
  const months: MonthRow[] = [];
  const byMonth = new Map<string, MonthRow>();
  for (let m = 0; m < 12; m += 1) {
    const key = `${year}-${String(m + 1).padStart(2, '0')}`;
    const row: MonthRow = {
      key,
      label: monthShort(m),
      grossPaidEur: 0,
      refundedEur: 0,
      netEur: 0,
      vatEur: 0,
      exVatEur: 0,
      bookings: 0,
    };
    months.push(row);
    byMonth.set(key, row);
  }

  const tourMap = new Map<string, TallyRow>();
  const sourceMap = new Map<string, TallyRow>();

  for (const b of bookings) {
    const row = byMonth.get(mauMonthKey(b.createdAt));
    if (!row) continue; // a boundary booking outside the target Mauritius year — ignore
    row.grossPaidEur += b.grossPaidEur;
    row.refundedEur += b.refundedEur;
    row.netEur += b.netPaidEur;
    const paid = b.grossPaidEur > 0;
    if (paid) row.bookings += 1;
    // Per-tour / per-source, by net cash. Only bookings that actually took money are interesting here.
    if (paid || b.netPaidEur !== 0) {
      const t = tourMap.get(b.activityTitle) ?? { name: b.activityTitle, bookings: 0, netEur: 0 };
      t.netEur += b.netPaidEur;
      if (paid) t.bookings += 1;
      tourMap.set(b.activityTitle, t);
      const s = sourceMap.get(b.source) ?? { name: b.source, bookings: 0, netEur: 0 };
      s.netEur += b.netPaidEur;
      if (paid) s.bookings += 1;
      sourceMap.set(b.source, s);
    }
  }

  // Round each month for display, then derive VAT from the rounded net so the columns reconcile
  // (ex-VAT = net − VAT exactly). Year totals are the sum of the displayed monthly rows.
  for (const row of months) {
    row.grossPaidEur = round2(row.grossPaidEur);
    row.refundedEur = round2(row.refundedEur);
    row.netEur = round2(row.netEur);
    row.vatEur = round2((row.netEur * VAT_RATE) / (1 + VAT_RATE));
    row.exVatEur = round2(row.netEur - row.vatEur);
  }
  const totals = months.reduce<ReportTotals>(
    (acc, m) => ({
      grossPaidEur: round2(acc.grossPaidEur + m.grossPaidEur),
      refundedEur: round2(acc.refundedEur + m.refundedEur),
      netEur: round2(acc.netEur + m.netEur),
      vatEur: round2(acc.vatEur + m.vatEur),
      exVatEur: round2(acc.exVatEur + m.exVatEur),
      bookings: acc.bookings + m.bookings,
    }),
    { grossPaidEur: 0, refundedEur: 0, netEur: 0, vatEur: 0, exVatEur: 0, bookings: 0 },
  );

  const roundTally = (t: TallyRow): TallyRow => ({ ...t, netEur: round2(t.netEur) });
  const byTour = [...tourMap.values()].map(roundTally).sort((a, b) => b.netEur - a.netEur);
  const bySource = [...sourceMap.values()].map(roundTally).sort((a, b) => b.netEur - a.netEur);
  const netSeries = months.map((m) => ({ label: m.label, value: m.netEur }));

  return { year, months, totals, byTour, bySource, netSeries };
}

/** Load one year's bookings (Mauritius calendar year) and compute the report. */
export async function loadReport(year: number): Promise<ReportData> {
  const [from, to] = mauYearRangeUtc(year);
  const bookings = await loadBookingsInRange(from, to);
  return computeReports(bookings, year);
}
