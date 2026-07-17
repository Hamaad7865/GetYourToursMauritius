'use client';

import { useEffect, useState } from 'react';
import { loadReport, eur2, type ReportData } from '@/lib/admin/reports';
import { csvCell } from '@/lib/admin/csv';
import { IconWallet, IconDownload, IconInfo } from '@/components/ui/icons';

function titleCaseSource(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Monthly VAT + P&L, plus per-tour / per-source, plus a CSV/print export — all derived client-side
 *  from the year's bookings (loadReport). No money-path or DB change. */
function exportCsv(data: ReportData): void {
  const lines: string[] = [];
  lines.push(
    [
      'Month',
      'Gross in EUR',
      'Refunds EUR',
      'Net EUR',
      'VAT 15% EUR',
      'Ex-VAT EUR',
      'Paid bookings',
    ]
      .map(csvCell)
      .join(','),
  );
  for (const m of data.months) {
    lines.push(
      [
        m.label,
        m.grossPaidEur.toFixed(2),
        m.refundedEur.toFixed(2),
        m.netEur.toFixed(2),
        m.vatEur.toFixed(2),
        m.exVatEur.toFixed(2),
        m.bookings,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  const t = data.totals;
  lines.push(
    [
      'Total',
      t.grossPaidEur.toFixed(2),
      t.refundedEur.toFixed(2),
      t.netEur.toFixed(2),
      t.vatEur.toFixed(2),
      t.exVatEur.toFixed(2),
      t.bookings,
    ]
      .map(csvCell)
      .join(','),
  );
  lines.push('');
  lines.push(['Tour', 'Paid bookings', 'Net EUR'].map(csvCell).join(','));
  for (const row of data.byTour) {
    lines.push([row.name, row.bookings, row.netEur.toFixed(2)].map(csvCell).join(','));
  }
  lines.push('');
  lines.push(['Channel', 'Paid bookings', 'Net EUR'].map(csvCell).join(','));
  for (const row of data.bySource) {
    lines.push(
      [titleCaseSource(row.name), row.bookings, row.netEur.toFixed(2)].map(csvCell).join(','),
    );
  }
  const csv = lines.join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `belle-mare-report-${data.year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function MonthlyBars({ series }: { series: { label: string; value: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.value));
  return (
    <div aria-hidden>
      <div className="flex h-[150px] items-end gap-1.5">
        {series.map((s, i) => (
          <div key={i} className="flex flex-1 items-end" style={{ height: '100%' }}>
            <div
              className="w-full rounded-t bg-teal/80"
              style={{ height: `${Math.max(2, (s.value / max) * 100)}%` }}
              title={`${s.label}: ${eur2(s.value)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {series.map((s, i) => (
          <span key={i} className="flex-1 text-center text-[10px] font-semibold text-ink-muted/70">
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'teal' | 'coral' | 'ink' | 'amber';
}) {
  const toneCls = {
    teal: 'bg-teal/10 text-teal',
    coral: 'bg-coral/10 text-coral',
    ink: 'bg-ink/[0.06] text-ink',
    amber: 'bg-amber-50 text-amber-700',
  }[tone];
  return (
    <div className="rounded-2xl border border-[#EAEEF0] bg-white p-[18px]">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneCls}`}>
        <IconWallet width={19} height={19} />
      </span>
      <div className="mt-3.5 text-[24px] font-extrabold leading-none tracking-tight text-ink">
        {value}
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-ink-muted">{label}</div>
    </div>
  );
}

const CELL = 'whitespace-nowrap px-3 py-2.5 text-right text-[13px] tabular-nums text-ink/80';
const HEAD = 'px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-ink-muted';

export function AdminReports() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadReport(year)
      .then((d) => {
        if (active) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Could not load the report.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [year]);

  const years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[30px] font-medium tracking-tight text-ink">Reports</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Revenue, refunds and VAT — Mauritius calendar year{' '}
            <span className="font-semibold text-ink">{year}</span>
          </p>
        </div>
        <div className="flex items-center gap-2.5 print:hidden">
          <label className="sr-only" htmlFor="report-year">
            Report year
          </label>
          <select
            id="report-year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-xl border border-[#E2E7EA] bg-white px-3 py-2.5 text-[13.5px] font-semibold text-ink outline-none focus:border-teal"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!data || data.totals.bookings === 0}
            onClick={() => data && exportCsv(data)}
            className="flex items-center gap-1.5 rounded-xl border border-[#E2E7EA] bg-white px-4 py-2.5 text-[13.5px] font-semibold text-ink hover:border-teal hover:text-teal disabled:opacity-50"
          >
            <IconDownload width={16} height={16} /> Export CSV
          </button>
          <button
            type="button"
            disabled={!data}
            onClick={() => window.print()}
            className="rounded-xl bg-teal px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Print-only title (the shell chrome is hidden when printing) */}
      <div className="mb-4 hidden print:block">
        <h2 className="font-display text-xl font-semibold text-ink">
          Belle Mare Tours — {year} revenue &amp; VAT report
        </h2>
      </div>

      <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/60 px-4 py-3 text-[13px] text-amber-900">
        <IconInfo width={17} height={17} className="mt-0.5 shrink-0" />
        <p>
          For your records — not tax advice. Belle Mare Tours&apos; prices include 15% VAT, so the
          VAT shown is that inclusive portion (net × 15⁄115). Figures are cash-basis (paid minus
          refunds), dated by when each booking was made. Confirm what&apos;s actually owed with your
          accountant.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral"
        >
          {error}
        </p>
      )}
      {loading && !data && <p className="py-16 text-center text-sm text-ink-muted">Loading…</p>}

      {data && (
        <div className="flex flex-col gap-5">
          {/* Year summary */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryCard
              label="Money in (gross)"
              value={eur2(data.totals.grossPaidEur)}
              tone="teal"
            />
            <SummaryCard label="Refunds" value={eur2(data.totals.refundedEur)} tone="coral" />
            <SummaryCard label="Net kept" value={eur2(data.totals.netEur)} tone="ink" />
            <SummaryCard label="VAT (15% incl.)" value={eur2(data.totals.vatEur)} tone="amber" />
          </div>

          {/* Monthly net chart */}
          <section className="rounded-2xl border border-[#EAEEF0] bg-white p-[18px]">
            <h2 className="mb-4 text-[15px] font-extrabold text-ink">Net revenue by month</h2>
            {data.totals.netEur === 0 ? (
              <p className="py-8 text-center text-sm text-ink-muted">
                No paid bookings in {year} yet.
              </p>
            ) : (
              <MonthlyBars series={data.netSeries} />
            )}
          </section>

          {/* Monthly VAT + P&L table */}
          <section className="overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white">
            <div className="border-b border-[#EEF1F3] px-[18px] py-4">
              <h2 className="text-[15px] font-extrabold text-ink">Monthly VAT &amp; profit</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr className="bg-[#FAFBFC]">
                    <th className={`${HEAD} text-left`}>Month</th>
                    <th className={HEAD}>Money in</th>
                    <th className={HEAD}>Refunds</th>
                    <th className={HEAD}>Net</th>
                    <th className={HEAD}>VAT 15%</th>
                    <th className={HEAD}>Ex-VAT</th>
                    <th className={HEAD}>Bookings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((m) => (
                    <tr key={m.key} className="border-t border-[#F2F4F6]">
                      <td className="whitespace-nowrap px-3 py-2.5 text-left text-[13px] font-semibold text-ink">
                        {m.label}
                      </td>
                      <td className={CELL}>{eur2(m.grossPaidEur)}</td>
                      <td className={`${CELL} ${m.refundedEur > 0 ? 'text-coral' : ''}`}>
                        {m.refundedEur > 0 ? `−${eur2(m.refundedEur)}` : eur2(0)}
                      </td>
                      <td className={`${CELL} font-bold text-ink`}>{eur2(m.netEur)}</td>
                      <td className={CELL}>{eur2(m.vatEur)}</td>
                      <td className={CELL}>{eur2(m.exVatEur)}</td>
                      <td className={CELL}>{m.bookings}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#E7EBEE] bg-[#FAFBFC] font-extrabold text-ink">
                    <td className="px-3 py-3 text-left text-[13px]">Total {year}</td>
                    <td className={`${CELL} font-extrabold text-ink`}>
                      {eur2(data.totals.grossPaidEur)}
                    </td>
                    <td
                      className={`${CELL} font-extrabold ${data.totals.refundedEur > 0 ? 'text-coral' : 'text-ink'}`}
                    >
                      {data.totals.refundedEur > 0 ? `−${eur2(data.totals.refundedEur)}` : eur2(0)}
                    </td>
                    <td className={`${CELL} font-extrabold text-ink`}>
                      {eur2(data.totals.netEur)}
                    </td>
                    <td className={`${CELL} font-extrabold text-ink`}>
                      {eur2(data.totals.vatEur)}
                    </td>
                    <td className={`${CELL} font-extrabold text-ink`}>
                      {eur2(data.totals.exVatEur)}
                    </td>
                    <td className={`${CELL} font-extrabold text-ink`}>{data.totals.bookings}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Top tours + by channel */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <TallyTable title="Top tours" head="Tour" rows={data.byTour} empty="No sales yet." />
            <TallyTable
              title="By channel"
              head="Channel"
              rows={data.bySource}
              empty="No sales yet."
              nameFmt={titleCaseSource}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TallyTable({
  title,
  head,
  rows,
  empty,
  nameFmt,
}: {
  title: string;
  head: string;
  rows: { name: string; bookings: number; netEur: number }[];
  empty: string;
  nameFmt?: (s: string) => string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white">
      <div className="border-b border-[#EEF1F3] px-[18px] py-4">
        <h2 className="text-[15px] font-extrabold text-ink">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-[18px] py-8 text-center text-sm text-ink-muted">{empty}</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#FAFBFC]">
              <th className={`${HEAD} text-left`}>{head}</th>
              <th className={HEAD}>Bookings</th>
              <th className={HEAD}>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-[#F2F4F6]">
                <td className="max-w-[220px] px-3 py-2.5 text-left text-[13px] font-semibold text-ink">
                  <span className="block truncate">{nameFmt ? nameFmt(r.name) : r.name}</span>
                </td>
                <td className={CELL}>{r.bookings}</td>
                <td className={`${CELL} font-bold text-ink`}>{eur2(r.netEur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
