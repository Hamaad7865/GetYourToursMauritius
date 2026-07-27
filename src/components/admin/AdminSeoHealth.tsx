'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  applyOverrides,
  auditPages,
  summarize,
  tourAuditPages,
  ISSUE_LABELS,
  type AuditPage,
  type SeoIssue,
} from '@/lib/seo/audit';
import { loadSeoMetaOverrides, loadTourSeoRows } from '@/lib/admin/seo-content';
import { SITE } from '@/lib/seo/site';

/**
 * "Which pages are obviously wrong?" — a triage list computed entirely from our own data.
 *
 * Deliberately NOT a ranking report: with a young domain and almost nothing indexed, ranking data
 * is empty and misleading. This finds the things that are broken regardless of rankings — missing
 * titles, snippets Google will truncate, two pages fighting over the same title.
 *
 * `basePages` arrives from the server with BUILT-IN titles; the overrides and the tour rows are
 * fetched here so the panel reflects edits made on this screen without a reload.
 */
export function AdminSeoHealth({ basePages }: { basePages: AuditPage[] }) {
  const [pages, setPages] = useState<AuditPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSeoMetaOverrides(), loadTourSeoRows()])
      .then(([overrides, tours]) => {
        if (cancelled) return;
        setPages([
          ...applyOverrides(basePages, overrides),
          ...tourAuditPages(tours, SITE.operator, SITE.description),
        ]);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not run the check.');
      });
    return () => {
      cancelled = true;
    };
  }, [basePages]);

  const { issues, summary, groups } = useMemo(() => {
    const list = pages ?? [];
    const found = auditPages(list);
    return {
      issues: found,
      summary: summarize(list, found),
      groups: [...new Set(list.map((p) => p.group))],
    };
  }, [pages]);

  const visible = useMemo(
    () => (groupFilter === 'all' ? issues : issues.filter((i) => i.group === groupFilter)),
    [issues, groupFilter],
  );

  if (error) {
    return (
      <section className="mb-6 rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <p className="text-[13px] text-ink-muted">Health check unavailable: {error}</p>
      </section>
    );
  }

  if (!pages) {
    return (
      <section className="mb-6 rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <p className="text-sm text-ink-muted">Checking every page…</p>
      </section>
    );
  }

  const clean = summary.pages - summary.pagesWithIssues;

  return (
    <section className="mb-6 rounded-2xl border border-[#EAEEF0] bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-extrabold text-ink">Health check</h2>
        <span className="text-[12px] font-semibold text-ink-muted">
          {summary.pages} pages checked
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Stat label="Clean" value={clean} tone="good" />
        <Stat label="Needs fixing" value={summary.errors} tone="bad" />
        <Stat label="Could be better" value={summary.warnings} tone="warn" />
      </div>

      {summary.byCode.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 p-0">
          {summary.byCode.map(({ code, count }) => (
            <li
              key={code}
              className="list-none rounded-full border border-[#EAEEF0] bg-[#F7F8FA] px-3 py-1 text-[12.5px] font-semibold text-ink"
            >
              {ISSUE_LABELS[code]} <span className="text-ink-muted">{count}</span>
            </li>
          ))}
        </ul>
      )}

      {issues.length === 0 ? (
        <p className="mt-4 text-[13px] font-semibold text-emerald-700">
          Every page has a title and description within budget, and none of them collide. ✓
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-4 text-[13px] font-bold text-teal-dark underline underline-offset-2"
          >
            {open ? 'Hide' : `Show all ${issues.length}`}
          </button>

          {open && (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <FilterChip
                  active={groupFilter === 'all'}
                  onClick={() => setGroupFilter('all')}
                  label={`All (${issues.length})`}
                />
                {groups.map((g) => {
                  const n = issues.filter((i) => i.group === g).length;
                  if (!n) return null;
                  return (
                    <FilterChip
                      key={g}
                      active={groupFilter === g}
                      onClick={() => setGroupFilter(g)}
                      label={`${g} (${n})`}
                    />
                  );
                })}
              </div>
              <ul className="mt-3 flex flex-col gap-2 p-0">
                {visible.map((issue) => (
                  <IssueRow key={`${issue.path}:${issue.code}`} issue={issue} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const colour =
    tone === 'bad' ? 'text-coral-dark' : tone === 'warn' ? 'text-amber-700' : 'text-emerald-700';
  return (
    <div className="rounded-xl border border-[#EAEEF0] bg-[#F7F8FA] px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-0.5 text-[22px] font-extrabold ${colour}`}>{value}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-[12.5px] font-bold transition ${
        active
          ? 'border-teal bg-teal text-white'
          : 'border-[#EAEEF0] bg-white text-ink hover:border-teal/40'
      }`}
    >
      {label}
    </button>
  );
}

function IssueRow({ issue }: { issue: SeoIssue }) {
  return (
    <li className="list-none rounded-xl border border-[#EAEEF0] bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
            issue.level === 'error' ? 'bg-coral/10 text-coral-dark' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {ISSUE_LABELS[issue.code]}
        </span>
        <span className="text-[13.5px] font-bold text-ink">{issue.label}</span>
        <Link
          href={issue.path}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] font-semibold text-ink-muted underline underline-offset-2"
        >
          {issue.path}
        </Link>
      </div>
      <p className="mt-1 text-[13px] text-ink/75">{issue.message}</p>
      <Link
        href={issue.editorPath}
        className="mt-1.5 inline-block text-[12.5px] font-bold text-teal-dark underline underline-offset-2"
      >
        Fix it →
      </Link>
    </li>
  );
}
