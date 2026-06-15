'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  loadCategories,
  createCategory,
  updateCategory,
  moveCategory,
  deleteCategory,
  type CategoryRow,
  type CategoryInput,
  type CategoryStatus,
} from '@/lib/admin/categories';
import { IconChevron } from '@/components/ui/icons';

const EMPTY: CategoryInput = { name: '', imageUrl: '', status: 'active' };

export function AdminCategories() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'staff';

  const [rows, setRows] = useState<CategoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<CategoryInput>(EMPTY);

  const load = useCallback(async () => {
    try {
      setRows(await loadCategories());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load categories.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  function startNew() {
    setForm(EMPTY);
    setEditing('new');
  }
  function startEdit(row: CategoryRow) {
    setForm({ name: row.name, imageUrl: row.imageUrl ?? '', status: row.status });
    setEditing(row.id);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form.name.trim()) return;
    await run(async () => {
      if (editing === 'new') await createCategory(form);
      else if (editing) await updateCategory(editing, form);
      setEditing(null);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Categories</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Create the categories activities are grouped into across the site.
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
        >
          New category
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
          {error}
        </p>
      )}

      {editing && (
        <div className="mt-5 rounded-2xl border border-ink/10 bg-white p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            {editing === 'new' ? 'New category' : 'Edit category'}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold text-ink">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Sunset tours"
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold text-ink">Image URL (optional)</span>
              <input
                value={form.imageUrl ?? ''}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                placeholder="https://…"
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold text-ink">Visibility</span>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as CategoryStatus })}
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
              >
                <option value="active">Active (shown on the site)</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy || !form.name.trim()}
              onClick={() => void save()}
              className="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save category'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:border-ink/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-ink/10 bg-white">
        {rows === null ? (
          <p className="p-6 text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">No categories yet. Click “New category” to add one.</p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {rows.map((row, i) => (
              <li key={row.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={busy || i === 0}
                    onClick={() => void run(() => moveCategory(rows, row.id, -1))}
                    className="grid h-5 w-5 place-items-center text-ink-muted hover:text-teal disabled:opacity-25"
                  >
                    <IconChevron width={14} height={14} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={busy || i === rows.length - 1}
                    onClick={() => void run(() => moveCategory(rows, row.id, 1))}
                    className="grid h-5 w-5 place-items-center text-ink-muted hover:text-teal disabled:opacity-25"
                  >
                    <IconChevron width={14} height={14} />
                  </button>
                </div>
                {row.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded-lg bg-teal/10" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-ink">{row.name}</span>
                    {row.status === 'hidden' && (
                      <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-bold text-ink-muted">
                        Hidden
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[12.5px] text-ink-muted">/{row.slug}</p>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold text-teal hover:bg-cream"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete "${row.name}"? Activities in this category keep their data but the category will disappear from menus.`,
                      )
                    )
                      void run(() => deleteCategory(row.id));
                  }}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
