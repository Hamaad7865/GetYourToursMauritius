'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  PLACE_CATEGORIES,
  PLACE_REGIONS,
  createPlannerPlace,
  deletePlannerPlace,
  loadPlannerPlaces,
  movePlannerPlace,
  updatePlannerPlace,
  type PlannerPlaceInput,
  type PlannerPlaceRow,
} from '@/lib/admin/planner-places';

const inputClass =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal';

const EMPTY: PlannerPlaceInput = {
  name: '',
  category: 'Beach',
  region: 'North',
  lat: 0,
  lng: 0,
  durationMin: 60,
  closesAt: null,
  blurb: null,
  imageUrl: null,
};

export function AdminPlannerPlaces() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'staff';
  const [rows, setRows] = useState<PlannerPlaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<PlannerPlaceInput>(EMPTY);

  const load = useCallback(async () => {
    try {
      setRows(await loadPlannerPlaces());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load places.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  function set<K extends keyof PlannerPlaceInput>(key: K, val: PlannerPlaceInput[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function startNew() {
    setForm(EMPTY);
    setEditing('new');
  }
  function startEdit(p: PlannerPlaceRow) {
    setForm({
      name: p.name,
      category: p.category,
      region: p.region,
      lat: p.lat,
      lng: p.lng,
      durationMin: p.durationMin,
      closesAt: p.closesAt,
      blurb: p.blurb,
      imageUrl: p.imageUrl,
    });
    setEditing(p.id);
  }

  if (!isAdmin) return <p className="text-sm text-coral">Access denied.</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Planner places</h1>
          <p className="mt-1 text-sm text-ink-muted">Curated stops the AI Road Trip Planner builds days from.</p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="rounded-full bg-teal px-4 py-2 text-sm font-bold text-white hover:bg-teal-dark"
        >
          + Add place
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
          {error}
        </p>
      )}

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return setError('Name is required.');
            void run(() =>
              editing === 'new' ? createPlannerPlace(form) : updatePlannerPlace(editing, form),
            );
          }}
          className="rounded-2xl border border-ink/10 bg-white p-5"
        >
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">
            {editing === 'new' ? 'New place' : 'Edit place'}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Name
              <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Category
              <select className={inputClass} value={form.category} onChange={(e) => set('category', e.target.value)}>
                {PLACE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Region
              <select className={inputClass} value={form.region} onChange={(e) => set('region', e.target.value)}>
                {PLACE_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Ideal duration (min)
              <input
                type="number"
                min={1}
                className={inputClass}
                value={form.durationMin}
                onChange={(e) => set('durationMin', e.target.value ? Number(e.target.value) : 0)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Latitude
              <input
                type="number"
                step="0.000001"
                className={inputClass}
                value={form.lat}
                onChange={(e) => set('lat', e.target.value ? Number(e.target.value) : 0)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Longitude
              <input
                type="number"
                step="0.000001"
                className={inputClass}
                value={form.lng}
                onChange={(e) => set('lng', e.target.value ? Number(e.target.value) : 0)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Closes at (HH:MM, blank = open)
              <input
                className={inputClass}
                value={form.closesAt ?? ''}
                onChange={(e) => set('closesAt', e.target.value || null)}
                placeholder="17:00"
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Image URL
              <input
                className={inputClass}
                value={form.imageUrl ?? ''}
                onChange={(e) => set('imageUrl', e.target.value || null)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink sm:col-span-2">
              Blurb
              <input
                className={inputClass}
                value={form.blurb ?? ''}
                onChange={(e) => set('blurb', e.target.value || null)}
              />
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-teal px-5 py-2 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-full px-4 py-2 text-sm font-bold text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="rounded-2xl border border-ink/10 bg-white">
        {rows === null ? (
          <p className="p-5 text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-5 text-sm text-ink-muted">No places yet.</p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {rows.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0 || busy}
                    onClick={() => void run(() => movePlannerPlace(rows, p.id, -1))}
                    className="text-ink-muted hover:text-teal disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === rows.length - 1 || busy}
                    onClick={() => void run(() => movePlannerPlace(rows, p.id, 1))}
                    className="text-ink-muted hover:text-teal disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{p.name}</div>
                  <div className="text-[12px] text-ink-muted">
                    {p.category} · {p.region} · {p.durationMin} min{p.closesAt ? ` · till ${p.closesAt}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(p)}
                  className="rounded-lg px-3 py-1.5 text-sm font-bold text-teal hover:bg-cream"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Delete ${p.name}?`)) void run(() => deletePlannerPlace(p.id));
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm font-bold text-coral hover:bg-coral/10 disabled:opacity-60"
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
