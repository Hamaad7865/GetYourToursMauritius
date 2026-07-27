'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { effectiveDefaultTitle, type SeoPage } from '@/lib/seo/page-registry';
import type { SeoPageGroup } from '@/lib/seo/page-groups';
import { loadSeoMetaOverrides, saveSeoMeta, type SeoMetaInput } from '@/lib/admin/seo-content';
import {
  AdminHeading,
  AdminError,
  BTN_PRIMARY,
  BTN_GHOST,
  INPUT_CLS,
  TEXTAREA_CLS,
} from '@/components/admin/ui';
import { Counter, SerpPreview, TITLE_BUDGET, DESC_BUDGET } from '@/components/admin/SerpPreview';

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
  // An override ships ABSOLUTE — it replaces the brand suffix the root template would have added,
  // so the default must be shown branded or the preview lies about what changes.
  const shownTitle = v.title.trim() || effectiveDefaultTitle(page);
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

      <div className="mt-3">
        <SerpPreview path={page.path} title={shownTitle} description={shownDesc} />
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block text-[13px] font-semibold text-ink">
          <span className="flex items-center justify-between">
            Title tag <Counter len={v.title.trim().length || 0} budget={TITLE_BUDGET} />
          </span>
          <input
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
            placeholder={effectiveDefaultTitle(page)}
            className={`mt-1 w-full ${INPUT_CLS}`}
          />
          {page.templated && (
            <span className="mt-1 block text-[12px] font-normal text-ink-muted">
              This replaces the whole title — end it with “| Belle Mare Tours” yourself, or the page
              loses the brand.
            </span>
          )}
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

export function AdminSeoMeta({ groups }: { groups: SeoPageGroup[] }) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'staff' || profile?.role === 'seo';
  const [overrides, setOverrides] = useState<Map<string, SeoMetaInput> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupKey, setGroupKey] = useState(groups[0]?.key ?? 'core');
  const [query, setQuery] = useState('');
  const [onlyOverridden, setOnlyOverridden] = useState(false);

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

  const group = groups.find((g) => g.key === groupKey) ?? groups[0];

  // Cards are heavy (each holds its own draft state), and a group can be 40 pages long — filter
  // before rendering rather than hiding with CSS.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (group?.pages ?? []).filter((p) => {
      if (onlyOverridden && !overrides?.get(p.path)) return false;
      if (!q) return true;
      return p.label.toLowerCase().includes(q) || p.path.toLowerCase().includes(q);
    });
  }, [group, query, onlyOverridden, overrides]);

  if (!canEdit) return <p className="text-sm text-coral">Access denied.</p>;

  const overriddenCount = (g: SeoPageGroup) =>
    g.pages.reduce((n, p) => n + (overrides?.get(p.path) ? 1 : 0), 0);

  return (
    <div>
      <AdminHeading
        title="Page titles & descriptions"
        subtitle="Tune each public page's <title> tag, meta description and social share image. Empty fields fall back to the built-in default — Reset returns the page to it. Tours are edited on the tour itself (Search appearance), blog posts in the Blog editor."
      />
      {error && <AdminError>{error}</AdminError>}

      <div className="mb-4 flex flex-wrap gap-2">
        {groups.map((g) => {
          const n = overrides ? overriddenCount(g) : 0;
          const active = g.key === group?.key;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroupKey(g.key)}
              aria-pressed={active}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-bold transition ${
                active
                  ? 'border-teal bg-teal text-white'
                  : 'border-[#EAEEF0] bg-white text-ink hover:border-teal/40'
              }`}
            >
              {g.label}
              <span
                className={`ml-1.5 font-semibold ${active ? 'text-white/75' : 'text-ink-muted'}`}
              >
                {n ? `${n}/${g.pages.length}` : g.pages.length}
              </span>
            </button>
          );
        })}
      </div>

      {group && <p className="mb-3 text-[13px] text-ink-muted">{group.hint}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or URL…"
          aria-label="Filter pages"
          className={`max-w-xs flex-1 ${INPUT_CLS}`}
        />
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 accent-teal"
            checked={onlyOverridden}
            onChange={(e) => setOnlyOverridden(e.target.checked)}
          />
          Only pages I&rsquo;ve edited
        </label>
      </div>

      {!overrides ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-ink-muted">No pages match that filter.</p>
      ) : (
        <div className="grid gap-4">
          {visible.map((page) => (
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
