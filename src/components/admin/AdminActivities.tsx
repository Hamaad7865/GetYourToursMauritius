'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { deleteActivity } from '@/lib/admin/activity-write';
import { IconPlus, IconCalendar, IconTag } from '@/components/ui/icons';

interface Row {
  id: string;
  slug: string;
  title: string;
  category: string;
  type: string;
  status: string;
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

  const load = useCallback(async () => {
    const { data, error } = await getBrowserSupabase()
      .from('activities')
      .select('id, slug, title, category, type, status')
      .order('created_at', { ascending: false })
      .returns<Row[]>();
    if (error) setError(error.message);
    else setRows(data ?? []);
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function remove(row: Row) {
    if (!window.confirm(`Delete "${row.title}"? This permanently removes the activity and its photos, options and prices.`))
      return;
    setBusy(row.id);
    setError(null);
    try {
      await deleteActivity(row.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
    } finally {
      setBusy(null);
    }
  }

  const published = (rows ?? []).filter((r) => r.status === 'published').length;
  const drafts = (rows ?? []).length - published;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[30px] font-medium tracking-tight text-ink">Tours</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {rows ? `${published} published · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}` : 'Loading…'}
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
        <p role="alert" className="mb-4 rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
          {error}
        </p>
      )}

      {rows === null ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-[18px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[260px] animate-pulse rounded-2xl border border-[#EAEEF0] bg-white" />
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-[18px]">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white shadow-[0_1px_2px_rgba(10,46,54,.04)] transition-shadow hover:shadow-[0_18px_34px_-20px_rgba(10,46,54,.34)]"
            >
              <div className="relative flex aspect-[16/10] items-center justify-center" style={{ background: grad(row.category) }}>
                <IconTag width={30} height={30} className="text-white/90" />
                <span
                  className={`absolute left-3 top-3 rounded-md px-2 py-1 text-[11px] font-bold ${
                    row.status === 'published' ? 'bg-white/95 text-emerald-700' : 'bg-white/95 text-amber-700'
                  }`}
                >
                  {row.status === 'published' ? 'Published' : 'Draft'}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="text-[11.5px] font-bold uppercase tracking-wide text-teal">{row.category}</div>
                <h3 className="mt-1.5 line-clamp-2 min-h-[40px] text-[15px] font-bold leading-snug text-ink">{row.title}</h3>
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
      )}
    </div>
  );
}
