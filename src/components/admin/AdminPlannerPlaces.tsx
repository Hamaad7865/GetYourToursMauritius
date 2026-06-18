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
import { IconChevron, IconPlus } from '@/components/ui/icons';
import { AdminHeading, Field, AdminError, INPUT_CLS, SELECT_CLS, BTN_PRIMARY, BTN_GHOST } from '@/components/admin/ui';

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
    <div>
      <AdminHeading
        title="Planner places"
        subtitle="Curated stops the AI Road Trip Planner builds days from."
        action={
          <button type="button" onClick={startNew} className={BTN_PRIMARY}>
            <IconPlus width={16} height={16} /> Add place
          </button>
        }
      />

      {error && <AdminError>{error}</AdminError>}

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return setError('Name is required.');
            void run(() => (editing === 'new' ? createPlannerPlace(form) : updatePlannerPlace(editing, form)));
          }}
          className="mb-5 rounded-2xl border border-[#EAEEF0] bg-white p-5"
        >
          <h2 className="mb-3.5 text-[15px] font-extrabold text-ink">{editing === 'new' ? 'New place' : 'Edit place'}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input className={INPUT_CLS} value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Category">
              <select className={SELECT_CLS} value={form.category} onChange={(e) => set('category', e.target.value)}>
                {PLACE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Region">
              <select className={SELECT_CLS} value={form.region} onChange={(e) => set('region', e.target.value)}>
                {PLACE_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ideal duration (min)">
              <input
                type="number"
                min={1}
                className={INPUT_CLS}
                value={form.durationMin}
                onChange={(e) => set('durationMin', e.target.value ? Number(e.target.value) : 0)}
              />
            </Field>
            <Field label="Latitude">
              <input
                type="number"
                step="0.000001"
                className={INPUT_CLS}
                value={form.lat}
                onChange={(e) => set('lat', e.target.value ? Number(e.target.value) : 0)}
              />
            </Field>
            <Field label="Longitude">
              <input
                type="number"
                step="0.000001"
                className={INPUT_CLS}
                value={form.lng}
                onChange={(e) => set('lng', e.target.value ? Number(e.target.value) : 0)}
              />
            </Field>
            <Field label="Closes at (HH:MM, blank = open)">
              <input
                className={INPUT_CLS}
                value={form.closesAt ?? ''}
                onChange={(e) => set('closesAt', e.target.value || null)}
                placeholder="17:00"
              />
            </Field>
            <Field label="Image URL">
              <input className={INPUT_CLS} value={form.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value || null)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Blurb">
                <input className={INPUT_CLS} value={form.blurb ?? ''} onChange={(e) => set('blurb', e.target.value || null)} />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={busy} className={BTN_PRIMARY}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(null)} className={BTN_GHOST}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white">
        {rows === null ? (
          <p className="p-5 text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-5 text-sm text-ink-muted">No places yet.</p>
        ) : (
          <ul>
            {rows.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 border-t border-[#F2F4F6] p-3 first:border-t-0 hover:bg-[#FAFBFC]">
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0 || busy}
                    onClick={() => void run(() => movePlannerPlace(rows, p.id, -1))}
                    className="grid h-5 w-5 place-items-center text-ink-muted hover:text-teal disabled:opacity-25"
                  >
                    <IconChevron width={14} height={14} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === rows.length - 1 || busy}
                    onClick={() => void run(() => movePlannerPlace(rows, p.id, 1))}
                    className="grid h-5 w-5 place-items-center text-ink-muted hover:text-teal disabled:opacity-25"
                  >
                    <IconChevron width={14} height={14} />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-ink">{p.name}</div>
                  <div className="text-[12px] text-ink-muted">
                    {p.category} · {p.region} · {p.durationMin} min{p.closesAt ? ` · till ${p.closesAt}` : ''}
                  </div>
                </div>
                <button type="button" onClick={() => startEdit(p)} className="rounded-lg px-3 py-1.5 text-sm font-bold text-teal hover:bg-cream">
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Delete ${p.name}?`)) void run(() => deletePlannerPlace(p.id));
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
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
