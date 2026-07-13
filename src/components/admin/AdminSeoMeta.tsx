'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { SEO_PAGES, type SeoPage } from '@/lib/seo/page-registry';
import {
  loadSeoMetaOverrides,
  saveSeoMeta,
  type SeoMetaInput,
} from '@/lib/admin/seo-content';
import { AdminHeading, AdminError, BTN_PRIMARY, BTN_GHOST, INPUT_CLS, TEXTAREA_CLS } from '@/components/admin/ui';

/** Google-recommended display budgets — counters turn coral past them (a hint, not a hard cap). */
const TITLE_BUDGET = 60;
const DESC_BUDGET = 160;

function Counter({ len, budget }: { len: number; budget: number }) {
  return (
    <span className={`text-[11.5px] font-semibold ${len > budget ? 'text-coral' : 'text-ink-muted'}`}>
      {len}/{budget}
    </span>
  );
}

/** One page's editor card: title/description/OG inputs + a live Google-style snippet preview. */
function PageCard({
  page,
  value,
  busy,
  onSave,
}: {
  page: SeoPage;
  value: SeoMetaInput | undefined;
  busy: boolean;
  onSave: (v: SeoMetaInput) => Promise<void>;
}) {
  const [v, setV] = useState<SeoMetaInput>(
    value ?? { path: page.path, title: '', description: '', ogImageUrl: '' },
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (value) setV(value);
  }, [value]);

  const overridden = Boolean(v.title.trim() || v.description.trim() || v.ogImageUrl.trim());
  const shownTitle = v.title.trim() || page.defaultTitle;
  const shownDesc = v.description.trim() || page.defaultDescription;

  async function save(next: SeoMetaInput) {
    setError(null);
    setSaved(false);
    try {
      await onSave(next);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  return (
    <section className="rounded-2xl border border-[#EAEEF0] bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-extrabold text-ink">{page.label}</h2>
        <span className="text-[12px] font-semibold text-ink-muted">
          {page.path}
          {overridden ? ' · overridden' : ' · using built-in default'}
        </span>
      </div>

      {/* Google-style snippet preview */}
      <div className="mt-3 rounded-xl border border-[#EAEEF0] bg-[#F7F8FA] px-4 py-3">
        <p className="truncate text-[13px] text-[#1a6f38]">bellemaretours.com{page.path === '/' ? '' : page.path}</p>
        <p className="mt-0.5 truncate text-[16.5px] font-medium text-[#1a0dab]">{shownTitle}</p>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-ink/70">{shownDesc}</p>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block text-[13px] font-semibold text-ink">
          <span className="flex items-center justify-between">
            Title tag <Counter len={v.title.trim().length || 0} budget={TITLE_BUDGET} />
          </span>
          <input
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
            placeholder={page.defaultTitle}
            className={`mt-1 w-full ${INPUT_CLS}`}
          />
        </label>
        <label className="block text-[13px] font-semibold text-ink">
          <span className="flex items-center justify-between">
            Meta description <Counter len={v.description.trim().length || 0} budget={DESC_BUDGET} />
          </span>
          <textarea
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
            placeholder={page.defaultDescription}
            rows={2}
            className={`mt-1 w-full ${TEXTAREA_CLS}`}
          />
        </label>
        <label className="block text-[13px] font-semibold text-ink">
          Social share image URL <span className="font-normal text-ink-muted">(optional)</span>
          <input
            value={v.ogImageUrl}
            onChange={(e) => setV({ ...v, ogImageUrl: e.target.value })}
            placeholder="https://…/photo.jpg (1200×630 works best)"
            className={`mt-1 w-full ${INPUT_CLS}`}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-coral-dark">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void save(v)} className={BTN_PRIMARY}>
          Save
        </button>
        {overridden && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const cleared = { path: page.path, title: '', description: '', ogImageUrl: '' };
              setV(cleared);
              void save(cleared);
            }}
            className={BTN_GHOST}
          >
            Reset to default
          </button>
        )}
        {saved && <span className="text-sm font-semibold text-emerald-700">Saved ✓</span>}
      </div>
    </section>
  );
}

export function AdminSeoMeta() {
  const { profile } = useAuth();
  const canEdit =
    profile?.role === 'admin' || profile?.role === 'staff' || profile?.role === 'seo';
  const [overrides, setOverrides] = useState<Map<string, SeoMetaInput> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverrides(await loadSeoMetaOverrides());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the SEO overrides.');
    }
  }, []);

  useEffect(() => {
    if (canEdit) void load();
  }, [canEdit, load]);

  if (!canEdit) return <p className="text-sm text-coral">Access denied.</p>;

  return (
    <div>
      <AdminHeading
        title="Page titles & descriptions"
        subtitle="Tune each public page's <title> tag, meta description and social share image. Empty fields fall back to the built-in default — Reset returns the page to it."
      />
      {error && <AdminError>{error}</AdminError>}
      {!overrides ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="grid gap-4">
          {SEO_PAGES.map((page) => (
            <PageCard
              key={page.path}
              page={page}
              value={overrides.get(page.path)}
              busy={busy}
              onSave={async (v) => {
                setBusy(true);
                try {
                  await saveSeoMeta(v);
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
