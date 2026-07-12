'use client';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { deleteActivity } from '@/lib/admin/activity-write';
import { reorderActivities } from '@/lib/admin/activity-order';
import {
  IconPlus,
  IconCalendar,
  IconSearch,
  IconTag,
  IconMenu,
  IconChevron,
} from '@/components/ui/icons';

interface Row {
  id: string;
  slug: string;
  title: string;
  category: string;
  type: string;
  status: string;
  /** Display order within the category (drives the public card order; admin drag-reorders it). */
  sort: number;
  /** The tour's first gallery photo (lowest `position`), or null if it has none yet. */
  imageUrl: string | null;
}

/** A deterministic teal→ink gradient per card, so the grid reads like the mockup even before
 *  photos load. Hue is derived from the category so a category's cards share a family. */
function grad(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = seed.charCodeAt(i) + ((h << 5) - h);
  const hue = 165 + (Math.abs(h) % 40); // teal-ish band
  return `linear-gradient(150deg, hsl(${hue} 55% 42%), hsl(${hue + 18} 60% 26%))`;
}

export function AdminActivities() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'staff';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'published' | 'draft'>('all');
  const [category, setCategory] = useState('all');

  const load = useCallback(async () => {
    // Pull each tour's gallery photos alongside the row so the card can show the first one as its
    // thumbnail. We only need url + position; the lowest position is the gallery's lead image.
    const { data, error } = await getBrowserSupabase()
      .from('activities')
      .select('id, slug, title, category, type, status, sort, activity_images(url, position)')
      // Show cards in their public order (sort within a category) so drag-reorder is WYSIWYG.
      .order('sort', { ascending: true })
      .order('created_at', { ascending: false })
      .returns<
        Array<
          Omit<Row, 'imageUrl'> & { activity_images: { url: string; position: number }[] | null }
        >
      >();
    if (error) setError(error.message);
    else
      setRows(
        (data ?? []).map(({ activity_images, ...rest }) => ({
          ...rest,
          imageUrl:
            (activity_images ?? []).slice().sort((a, b) => a.position - b.position)[0]?.url ?? null,
        })),
      );
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function remove(row: Row) {
    if (
      !window.confirm(
        `Delete "${row.title}"? This permanently removes the activity and its photos, options and prices.`,
      )
    )
      return;
    setBusy(row.id);
    setError(null);
    try {
      await deleteActivity(row.id);
      await load();
    } catch (err) {
      // Supabase errors are plain PostgrestError objects (not Error instances), so read the fields
      // directly. A foreign-key violation (23503) means the tour has bookings/availability and can't be
      // deleted — guide the user to Draft instead of showing the opaque DB message.
      const e = err as { code?: string; message?: string } | null;
      setError(
        e?.code === '23503'
          ? 'This tour has bookings or availability, so it can’t be deleted. Set it to Draft instead to hide it from the site.'
          : e?.message || (err instanceof Error ? err.message : 'Could not delete.'),
      );
    } finally {
      setBusy(null);
    }
  }

  const published = (rows ?? []).filter((r) => r.status === 'published').length;
  const drafts = (rows ?? []).length - published;
  const categories = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.category).filter(Boolean))).sort(),
    [rows],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (status === 'published' && r.status !== 'published') return false;
      if (status === 'draft' && r.status === 'published') return false;
      if (category !== 'all' && r.category !== category) return false;
      if (q && !`${r.title} ${r.slug} ${r.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, status, category]);
  const filtering = query.trim() !== '' || status !== 'all' || category !== 'all';

  // Drag-reorder only when the visible list == a WHOLE category (no other filter narrowing it), so the
  // persisted order covers exactly that category's cards. Cross-category drag is meaningless (sort is
  // per-category), so it's off in the "all" view.
  const canReorder = category !== 'all' && status === 'all' && query.trim() === '';
  const rowsRef = useRef<Row[] | null>(null);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const [dragId, setDragId] = useState<string | null>(null);
  // Announced to screen readers after a keyboard reorder (drag-drop gives its own visual feedback).
  const [announce, setAnnounce] = useState('');

  function onDragOverRow(e: React.DragEvent, overId: string) {
    if (!canReorder || !dragId || dragId === overId) return;
    e.preventDefault(); // allow the drop + live-reorder as you hover
    setRows((cur) => {
      if (!cur) return cur;
      const from = cur.findIndex((r) => r.id === dragId);
      const to = cur.findIndex((r) => r.id === overId);
      if (from < 0 || to < 0) return cur;
      const next = cur.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }
  async function onDragEndRow() {
    const id = dragId;
    setDragId(null);
    if (!id || !canReorder) return;
    // Persist THIS category's ids in their new order (server sets sort = array index).
    const ids = (rowsRef.current ?? []).filter((r) => r.category === category).map((r) => r.id);
    try {
      setError(null);
      await reorderActivities(ids, category);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the new order.');
      await load(); // revert to the server's truth
    }
  }

  // Keyboard-accessible reorder (drag-and-drop is mouse-only): the per-card ▲/▼ buttons move a card one
  // slot and persist, so staff on a keyboard / screen reader can reorder too. Same persist path as DnD.
  async function moveRow(id: string, dir: -1 | 1) {
    if (!canReorder) return;
    const cur = rowsRef.current ?? [];
    const inCat = cur.filter((r) => r.category === category);
    const from = inCat.findIndex((r) => r.id === id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= inCat.length) return;
    const next = cur.slice();
    const gFrom = next.findIndex((r) => r.id === id);
    const [moved] = next.splice(gFrom, 1);
    // Re-insert before the row currently at the target in-category position.
    const targetId = inCat[to]!.id;
    const gTo = next.findIndex((r) => r.id === targetId);
    next.splice(dir === 1 ? gTo + 1 : gTo, 0, moved!);
    setRows(next);
    setAnnounce(`Moved ${moved!.title} to position ${to + 1} of ${inCat.length}.`);
    const ids = next.filter((r) => r.category === category).map((r) => r.id);
    try {
      setError(null);
      await reorderActivities(ids, category);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the new order.');
      await load();
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[30px] font-medium tracking-tight text-ink">Tours</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {rows
              ? filtering
                ? `${filtered.length} of ${rows.length} shown`
                : `${published} published · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`
              : 'Loading…'}
          </p>
        </div>
        <Link
          href="/admin/activities/new"
          className="flex items-center gap-1.5 rounded-xl bg-teal px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-teal-dark"
        >
          <IconPlus width={16} height={16} /> Add tour
        </Link>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral"
        >
          {error}
        </p>
      )}

      {rows === null ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-[18px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[260px] animate-pulse rounded-2xl border border-[#EAEEF0] bg-white"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-[#EAEEF0] bg-white px-6 py-16 text-center">
          <div className="text-[15px] font-bold text-ink">No tours yet</div>
          <p className="mx-auto mt-1 max-w-sm text-[13.5px] text-ink-muted">
            Add your first tour to start taking bookings.
          </p>
          <Link
            href="/admin/activities/new"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-teal px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-teal-dark"
          >
            <IconPlus width={16} height={16} /> Add tour
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <IconSearch
                width={16}
                height={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tours by name or slug…"
                className="w-full rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] py-2.5 pl-9 pr-3 text-sm text-ink outline-none focus:border-teal focus:bg-white"
              />
            </div>
            <div className="flex overflow-hidden rounded-xl border border-[#E2E7EA]">
              {(['all', 'published', 'draft'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`px-3.5 py-2 text-[12.5px] font-bold capitalize ${
                    status === s
                      ? 'bg-teal text-white'
                      : 'bg-white text-ink-muted hover:bg-[#F7F8FA]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
              className="rounded-xl border border-[#E2E7EA] bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-teal"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-[#EAEEF0] bg-white px-6 py-16 text-center">
              <div className="text-[15px] font-bold text-ink">No tours match your filters</div>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setStatus('all');
                  setCategory('all');
                }}
                className="mt-3 text-[13.5px] font-bold text-teal hover:text-teal-dark"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              {canReorder ? (
                <p className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-teal">
                  <IconMenu width={14} height={14} /> Drag the cards to set their order — it shows
                  on the site for this category.
                </p>
              ) : category !== 'all' ? (
                <p className="mb-3 text-[12.5px] text-ink-muted">
                  Clear the search &amp; status filters to drag-reorder this category.
                </p>
              ) : (
                <p className="mb-3 text-[12.5px] text-ink-muted">
                  Pick a single category (and clear other filters) to drag-reorder its cards.
                </p>
              )}
              <div aria-live="polite" className="sr-only">
                {announce}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-[18px]">
                {filtered.map((row, i) => (
                  <div
                    key={row.id}
                    draggable={canReorder}
                    onDragStart={() => canReorder && setDragId(row.id)}
                    onDragOver={(e) => onDragOverRow(e, row.id)}
                    onDrop={(e) => e.preventDefault()}
                    onDragEnd={onDragEndRow}
                    className={`flex flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(10,46,54,.04)] transition-shadow hover:shadow-[0_18px_34px_-20px_rgba(10,46,54,.34)] ${
                      canReorder ? 'cursor-move border-teal/30' : 'border-[#EAEEF0]'
                    } ${dragId === row.id ? 'opacity-40 ring-2 ring-teal' : ''}`}
                  >
                    <div
                      className="relative aspect-[16/10] overflow-hidden"
                      style={{ background: grad(row.category) }}
                    >
                      {canReorder && (
                        // Keyboard reorder controls (parallel to drag-and-drop).
                        <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
                          <button
                            type="button"
                            aria-label={`Move ${row.title} up`}
                            disabled={i === 0}
                            onClick={() => void moveRow(row.id, -1)}
                            className="grid h-7 w-7 place-items-center rounded-md bg-white/95 text-ink shadow-sm hover:bg-white disabled:cursor-default disabled:opacity-40"
                          >
                            <IconChevron width={14} height={14} className="rotate-180" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${row.title} down`}
                            disabled={i === filtered.length - 1}
                            onClick={() => void moveRow(row.id, 1)}
                            className="grid h-7 w-7 place-items-center rounded-md bg-white/95 text-ink shadow-sm hover:bg-white disabled:cursor-default disabled:opacity-40"
                          >
                            <IconChevron width={14} height={14} />
                          </button>
                        </div>
                      )}
                      {row.imageUrl ? (
                        <img
                          src={row.imageUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        // No photo yet — keep the branded gradient + icon placeholder.
                        <div className="flex h-full w-full items-center justify-center">
                          <IconTag width={30} height={30} className="text-white/90" />
                        </div>
                      )}
                      <span
                        className={`absolute left-3 top-3 rounded-md px-2 py-1 text-[11px] font-bold ${
                          row.status === 'published'
                            ? 'bg-white/95 text-emerald-700'
                            : 'bg-white/95 text-amber-700'
                        }`}
                      >
                        {row.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <div className="text-[11.5px] font-bold uppercase tracking-wide text-teal">
                        {row.category}
                      </div>
                      <h3 className="mt-1.5 line-clamp-2 min-h-[40px] text-[15px] font-bold leading-snug text-ink">
                        {row.title}
                      </h3>
                      <div className="mt-2.5 flex items-center justify-between border-t border-[#F2F4F6] pt-2.5 text-[12.5px] text-ink-muted">
                        <span className="capitalize">{row.type}</span>
                        <span className="truncate">/{row.slug}</span>
                      </div>
                      <Link
                        href={`/admin/activities/${row.id}/edit`}
                        className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] py-2.5 text-[13px] font-bold text-ink hover:border-teal hover:bg-white hover:text-teal"
                      >
                        Edit tour
                      </Link>
                      <div className="mt-2 flex items-center justify-between">
                        <Link
                          href={`/admin/activities/${row.id}/availability`}
                          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-bold text-ink-muted hover:text-teal"
                        >
                          <IconCalendar width={14} height={14} /> Availability
                        </Link>
                        <button
                          type="button"
                          disabled={busy === row.id}
                          onClick={() => remove(row)}
                          className="rounded-lg px-2 py-1.5 text-[12.5px] font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
                        >
                          {busy === row.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
