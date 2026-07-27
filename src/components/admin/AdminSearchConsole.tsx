'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { loadSearchConsoleReport, SearchConsoleNotConnected } from '@/lib/admin/search-console';
import type { SearchConsoleReport, SearchRow } from '@/lib/seo/search-console';

/**
 * What Google actually shows people — impressions, clicks, average position, and the queries the
 * site surfaces for.
 *
 * This is the feedback loop the SEO module was missing: the editors elsewhere on this page change
 * what we *say*, and this panel is the only way to see whether it changed anything. Empty numbers
 * are a real answer too (a young domain with little indexed), so an empty report renders as "no
 * data yet", never as a failure.
 */
const WINDOWS = [7, 28, 90] as const;

export function AdminSearchConsole() {
  const [days, setDays] = useState<number>(28);
  const [report, setReport] = useState<SearchConsoleReport | null>(null);
  const [notConnected, setNotConnected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    setNotConnected(null);
    try {
      setReport(await loadSearchConsoleReport(d));
    } catch (e) {
      setReport(null);
      if (e instanceof SearchConsoleNotConnected) setNotConnected(e.message);
      else setError(e instanceof Error ? e.message : 'Could not load Search Console data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  return (
    <section className="mb-6 rounded-2xl border border-[#EAEEF0] bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-extrabold text-ink">Search performance</h2>
        {report && (
          <span className="text-[12px] font-semibold text-ink-muted">
            {report.startDate} → {report.endDate}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setDays(w)}
            aria-pressed={days === w}
            className={`rounded-full border px-3 py-1 text-[12.5px] font-bold transition ${
              days === w
                ? 'border-teal bg-teal text-white'
                : 'border-[#EAEEF0] bg-white text-ink hover:border-teal/40'
            }`}
          >
            Last {w} days
          </button>
        ))}
      </div>

      {loading && <p className="mt-4 text-sm text-ink-muted">Loading Search Console…</p>}

      {notConnected && !loading && <NotConnected message={notConnected} />}

      {error && !loading && (
        <p role="alert" className="mt-4 text-[13px] font-medium text-coral-dark">
          {error}
        </p>
      )}

      {report && !loading && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Clicks" value={report.totals.clicks.toLocaleString()} />
            <Stat label="Impressions" value={report.totals.impressions.toLocaleString()} />
            <Stat label="Click rate" value={`${(report.totals.ctr * 100).toFixed(1)}%`} />
            <Stat
              label="Avg position"
              value={report.totals.position ? report.totals.position.toFixed(1) : '—'}
            />
          </div>

          {report.topPages.length === 0 && report.topQueries.length === 0 ? (
            <p className="mt-4 text-[13px] text-ink-muted">
              No impressions in this window yet. That is expected while the site is still being
              indexed — it is not a fault in the setup.
            </p>
          ) : (
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <RowTable title="Top pages" rows={report.topPages} linkPaths />
              <RowTable title="Top queries" rows={report.topQueries} />
            </div>
          )}

          <p className="mt-4 text-[12px] text-ink-muted">
            Totals cover the pages listed here (Search Console reports with a ~3-day lag, so the
            window ends before today).
          </p>
        </>
      )}
    </section>
  );
}

function NotConnected({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-xl border border-[#EAEEF0] bg-[#F7F8FA] px-4 py-3">
      <p className="text-[13px] font-bold text-ink">Not connected yet</p>
      <p className="mt-1 text-[13px] text-ink/75">{message}</p>
      <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-ink/75">
        <li>
          Create a Google Cloud service account, enable the Search Console API, and download its key
          JSON.
        </li>
        <li>
          In Search Console → Settings → Users and permissions, add the service account&rsquo;s
          email as a <strong>Full</strong> or <strong>Restricted</strong> user on the property.
        </li>
        <li>
          In Cloudflare Pages, set <code>GSC_SERVICE_ACCOUNT_JSON</code> to the key JSON and{' '}
          <code>GSC_SITE_URL</code> to <code>sc-domain:bellemaretours.com</code>, then redeploy.
        </li>
      </ol>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#EAEEF0] bg-[#F7F8FA] px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-extrabold text-ink">{value}</div>
    </div>
  );
}

function RowTable({
  title,
  rows,
  linkPaths,
}: {
  title: string;
  rows: SearchRow[];
  linkPaths?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="m-0 mb-2 text-[13px] font-extrabold text-ink">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              <th className="pb-1.5 pr-2 font-bold">{linkPaths ? 'Page' : 'Query'}</th>
              <th className="pb-1.5 pr-2 text-right font-bold">Clicks</th>
              <th className="pb-1.5 pr-2 text-right font-bold">Impr.</th>
              <th className="pb-1.5 text-right font-bold">Pos.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-[#EAEEF0]">
                <td className="max-w-[22ch] truncate py-1.5 pr-2 text-ink">
                  {linkPaths ? (
                    <Link
                      href={r.key}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {r.key}
                    </Link>
                  ) : (
                    r.key
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right font-semibold text-ink">{r.clicks}</td>
                <td className="py-1.5 pr-2 text-right text-ink-muted">{r.impressions}</td>
                <td className="py-1.5 text-right text-ink-muted">{r.position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
