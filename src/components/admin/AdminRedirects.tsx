'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { redirectFromPathError } from '@/lib/validation/seo';
import { SEO_PAGES } from '@/lib/seo/page-registry';
import {
  deleteRedirect,
  loadRedirects,
  saveRedirect,
  type RedirectRow,
} from '@/lib/admin/seo-content';
import { AdminHeading, AdminError, BTN_PRIMARY, INPUT_CLS } from '@/components/admin/ui';

const LIVE_PATHS = new Set(SEO_PAGES.map((p) => p.path));

export function AdminRedirects() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'staff' || profile?.role === 'seo';
  const [rows, setRows] = useState<RedirectRow[] | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await loadRedirects());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load redirects.');
    }
  }, []);

  useEffect(() => {
    if (canEdit) void load();
  }, [canEdit, load]);

  if (!canEdit) return <p className="text-sm text-coral">Access denied.</p>;

  async function add() {
    setError(null);
    setSaved(false);
    const f = from.trim();
    const t = to.trim();
    const invalid = redirectFromPathError(f, t);
    if (invalid) return setError(invalid);
    if (LIVE_PATHS.has(f))
      return setError(`${f} is a live page on this site — redirecting it would hide the page.`);
    // No chains: the destination must not itself be redirected somewhere else.
    if (rows?.some((r) => r.fromPath === t))
      return setError(`${t} is itself redirected — point the old URL straight at the final page.`);
    setBusy(true);
    try {
      await saveRedirect(f, t);
      setFrom('');
      setTo('');
      setSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the redirect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <AdminHeading
        title="Redirects"
        subtitle="Send an old or retired URL permanently to a live page (a 301 for search engines). Applies only to addresses that would otherwise be a 404 — it can never break a real page."
      />
      {error && <AdminError>{error}</AdminError>}

      <section className="mb-5 rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">Add a redirect</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block text-[13px] font-semibold text-ink">
            Old URL (the one that 404s)
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="/old-tour-page"
              className={`mt-1 w-full ${INPUT_CLS}`}
            />
          </label>
          <label className="block text-[13px] font-semibold text-ink">
            Send visitors to
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="/mauritius-tours"
              className={`mt-1 w-full ${INPUT_CLS}`}
            />
          </label>
          <button type="button" disabled={busy} onClick={() => void add()} className={BTN_PRIMARY}>
            Add
          </button>
        </div>
        {saved && <p className="mt-2 text-sm font-semibold text-emerald-700">Saved ✓</p>}
      </section>

      {!rows ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-[#EAEEF0] bg-white p-5 text-sm text-ink-muted">
          No redirects yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white">
          {rows.map((r) => (
            <div
              key={r.fromPath}
              className="flex flex-wrap items-center gap-3 border-b border-[#EAEEF0] px-4 py-3 last:border-b-0"
            >
              <code className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {r.fromPath} <span className="text-ink-muted">→</span> {r.toPath}
              </code>
              <button
                type="button"
                onClick={() => {
                  deleteRedirect(r.fromPath)
                    .then(load)
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : 'Could not delete.'),
                    );
                }}
                className="text-sm font-bold text-coral-dark hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
