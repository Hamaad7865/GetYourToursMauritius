'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { deleteActivity } from '@/lib/admin/activity-write';

interface Row {
  id: string;
  slug: string;
  title: string;
  category: string;
  type: string;
  status: string;
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Activities</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Add, edit and remove the activities on the site.</p>
        </div>
        <Link
          href="/admin/activities/new"
          className="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
        >
          New activity
        </Link>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
          {error}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-ink/10 bg-white">
        {rows === null ? (
          <p className="p-6 text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">No activities yet. Click “New activity” to add your first one.</p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-ink">{row.title}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        row.status === 'published' ? 'bg-teal/10 text-teal-dark' : 'bg-gold-light/20 text-ink'
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p className="truncate text-[12.5px] text-ink-muted">
                    {row.category} · {row.type} · /{row.slug}
                  </p>
                </div>
                <Link
                  href={`/admin/activities/${row.id}/availability`}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold text-ink-muted hover:bg-cream hover:text-teal"
                >
                  Availability
                </Link>
                <Link
                  href={`/admin/activities/${row.id}/edit`}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold text-teal hover:bg-cream"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  disabled={busy === row.id}
                  onClick={() => remove(row)}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
                >
                  {busy === row.id ? '…' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
