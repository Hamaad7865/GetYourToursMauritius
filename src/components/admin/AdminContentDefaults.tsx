'use client';

import { useEffect, useState } from 'react';
import { useCategories } from '@/lib/categories/useCategories';
import { Section, StringList } from '@/components/admin/fields';
import {
  loadContentDefaults,
  saveContentDefaults,
  EMPTY_CONTENT_DEFAULTS,
} from '@/lib/admin/content-defaults';
import type { ContentDefaults } from '@/lib/catalogue/content-defaults';

/**
 * Standard content per CATEGORY — the admin-editable replacement for the two hardcoded files that
 * used to live in src/lib/content/{sightseeing,catamaran}.ts.
 *
 * Spec: docs/superpowers/specs/2026-07-16-activity-content-defaults-design.md
 *
 * Every activity in a category inherits its set. Highlights REPLACE the activity's own; the other four
 * lists merge shared-first and dedupe — the copy below says so, because that asymmetry is invisible
 * otherwise and it is exactly what confuses people.
 */
export function AdminContentDefaults() {
  const categories = useCategories();
  const [all, setAll] = useState<Record<string, ContentDefaults>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContentDefaults>(EMPTY_CONTENT_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadContentDefaults();
        if (!cancelled) setAll(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Could not load standard content.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function open(category: string) {
    setSelected(category);
    setDraft(all[category] ?? EMPTY_CONTENT_DEFAULTS);
    setSaved(false);
    setError(null);
  }

  const set = <K extends keyof ContentDefaults>(key: K, value: ContentDefaults[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await saveContentDefaults(selected, draft);
      const isEmpty = Object.values(draft).every(
        (list: string[]) => list.filter((s: string) => s.trim()).length === 0,
      );
      setAll((prev) => {
        const next = { ...prev };
        // Mirror the write: an all-empty save deletes the row, so drop it from the list state too.
        if (isEmpty) delete next[selected];
        else next[selected] = draft;
        return next;
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const count = (c: ContentDefaults | undefined) =>
    c
      ? c.highlights.length +
        c.inclusions.length +
        c.exclusions.length +
        c.whatToBring.length +
        c.importantInfo.length
      : 0;

  if (loading) return <p className="text-sm text-ink-muted">Loading standard content…</p>;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Standard content</h1>
        <p className="mt-1 max-w-3xl text-[13.5px] text-ink-muted">
          Set the includes, not-included, what-to-bring and know-before-you-go that apply to{' '}
          <b>every tour in a category</b>, so you write them once instead of on all 46 activities. A
          tour&rsquo;s own lists are added on top and duplicates are removed. Highlights are the
          exception: a category&rsquo;s standard highlights <b>replace</b> each tour&rsquo;s own.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl bg-coral/10 px-4 py-3 text-[13.5px] text-coral-dark">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Categories" className="flex flex-col gap-1.5">
          {categories.map((c) => {
            const n = count(all[c.name]);
            const active = selected === c.name;
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => open(c.name)}
                aria-current={active ? 'true' : undefined}
                className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-[13.5px] transition ${
                  active
                    ? 'border-teal bg-teal/[0.06] font-bold text-teal-dark'
                    : 'border-ink/12 text-ink hover:border-teal/60'
                }`}
              >
                <span>{c.name}</span>
                <span
                  className={
                    n > 0 ? 'text-[12px] font-bold text-teal' : 'text-[12px] text-ink-muted'
                  }
                >
                  {n > 0 ? `${n} line${n === 1 ? '' : 's'}` : 'none'}
                </span>
              </button>
            );
          })}
        </nav>

        {selected ? (
          <div className="flex flex-col gap-5">
            <Section
              title={`${selected} — standard content`}
              hint="Applies to every tour in this category. Leave a list empty to add nothing for that field."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <StringList
                  label="Highlights"
                  items={draft.highlights}
                  onChange={(x) => set('highlights', x)}
                  hint={
                    <span className="text-[12px] text-ink-muted">
                      Replaces each tour&rsquo;s own highlights (it does not merge).
                    </span>
                  }
                />
                <StringList
                  label="What's included"
                  items={draft.inclusions}
                  onChange={(x) => set('inclusions', x)}
                />
                <StringList
                  label="Not included"
                  items={draft.exclusions}
                  onChange={(x) => set('exclusions', x)}
                />
                <StringList
                  label="What to bring"
                  items={draft.whatToBring}
                  onChange={(x) => set('whatToBring', x)}
                />
                <StringList
                  label="Know before you go"
                  items={draft.importantInfo}
                  onChange={(x) => set('importantInfo', x)}
                />
              </div>
            </Section>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-full bg-teal-dark px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <span aria-live="polite" className="text-[13px] text-ink-muted">
                {saved && !saving ? 'Saved.' : ''}
              </span>
            </div>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-ink/15 px-5 py-8 text-center text-[13.5px] text-ink-muted">
            Pick a category to edit its standard content.
          </p>
        )}
      </div>
    </div>
  );
}
