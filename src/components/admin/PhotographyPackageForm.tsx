'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createPhotographyPackage,
  loadPhotographyPackage,
  savePhotographyPackage,
  type LoadedPackage,
  type PhotographyPackageInput,
} from '@/lib/admin/photography';
import { PHOTOGRAPHY_ADD_ON_PRESETS } from '@/lib/catalogue/photography';
import { IconChevron, IconPlus, IconX } from '@/components/ui/icons';
import {
  AdminError,
  AdminHeading,
  BTN_GHOST,
  BTN_PRIMARY,
  Card,
  Field,
  INPUT_CLS,
  SELECT_CLS,
  TEXTAREA_CLS,
} from '@/components/admin/ui';

const START: PhotographyPackageInput = {
  title: '',
  kind: 'shoots',
  summary: '',
  durationHours: 1,
  baseEur: 150,
  included: 2,
  extraEur: 25,
  maxGuests: 8,
  shootsPerDay: 2,
  minAdvanceDays: 1,
  features: ['Edited high-resolution photos', 'Private online gallery', 'Location scouting'],
  addOns: PHOTOGRAPHY_ADD_ON_PRESETS.map((a) => ({ ...a })),
  imageUrl: '',
  status: 'published',
};

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The package form — "New package" (the template) and "Edit package" (`packageId` set). It asks only what a photography package needs and writes an ordinary
 * activity: a private option (base price for N guests + per extra guest, capped), one supplement per
 * add-on, and the shoots-per-day capacity that makes dates bookable. Everything is editable later in
 * the full tour editor, which is where this sends you once it is saved.
 */
export function PhotographyPackageForm({ packageId }: { packageId?: string } = {}) {
  const router = useRouter();
  const editing = Boolean(packageId);
  const [v, setV] = useState<PhotographyPackageInput>(START);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edit mode: the saved package, loaded once. Everything the simple form does not show (slug,
  // description, more photos, French, itinerary…) rides through `loaded.values` unchanged on save.
  const [loaded, setLoaded] = useState<LoadedPackage | null>(null);
  const [loading, setLoading] = useState(editing);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!packageId) return;
    let active = true;
    loadPhotographyPackage(packageId)
      .then((pkg) => {
        if (!active) return;
        setLoaded(pkg);
        setV(pkg.input);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load the package.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [packageId]);

  function set<K extends keyof PhotographyPackageInput>(k: K, val: PhotographyPackageInput[K]) {
    setSaved(false);
    setV((cur) => ({ ...cur, [k]: val }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!v.title.trim()) return setError('Give the package a name.');
    if (v.baseEur <= 0) return setError('Set the package price (more than €0).');
    if (v.included < 1) return setError('The price must cover at least 1 guest.');
    if (v.maxGuests < v.included)
      return setError('Max guests can’t be below the guests the price covers.');
    setBusy(true);
    try {
      if (packageId && loaded) {
        await savePhotographyPackage(packageId, loaded, v);
        // Reload so new add-ons pick up their ids — the next save then updates them in place.
        const fresh = await loadPhotographyPackage(packageId);
        setLoaded(fresh);
        setV(fresh.input);
        setSaved(true);
        setBusy(false);
        router.refresh();
        return;
      }
      const id = await createPhotographyPackage(v);
      router.replace(`/admin/photography/${id}/edit`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : editing
            ? 'Could not save the package.'
            : 'Could not create the package.',
      );
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading the package…</p>;
  if (editing && !loaded) {
    return (
      <div>
        <AdminError>{error ?? 'Package not found.'}</AdminError>
        <Link href="/admin/photography" className={BTN_GHOST}>
          Back to photography
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="pb-16">
      <Link
        href="/admin/photography"
        className="mb-2 inline-flex items-center gap-1 text-[13.5px] font-semibold text-ink-muted hover:text-teal"
      >
        <IconChevron width={15} height={15} className="rotate-90" /> Back to photography
      </Link>
      <AdminHeading
        title={editing ? 'Edit package' : 'New photography package'}
        subtitle={
          editing
            ? 'Changes save straight to the live package. Photos, the long description, French and search settings are in the full editor.'
            : 'Creates a bookable package — dates, extra guests and add-ons included. You can fine-tune everything in the tour editor afterwards.'
        }
        action={
          editing && packageId && loaded ? (
            <div className="flex flex-wrap gap-2">
              <a
                href={`/activities/${loaded.values.slug}`}
                target="_blank"
                rel="noreferrer"
                className={BTN_GHOST}
              >
                View package
              </a>
              <Link href={`/admin/activities/${packageId}/edit`} className={BTN_GHOST}>
                Full editor (photos, French, SEO)
              </Link>
            </div>
          ) : undefined
        }
      />
      {editing && v.status === 'draft' && (
        <p className="mb-4 rounded-xl bg-amber-100/60 px-4 py-3 text-[13px] font-medium text-amber-800">
          This package is a draft — guests can’t see or book it. Check the price and add-ons, then
          set Status to “Published” and save.
        </p>
      )}
      {error && <AdminError>{error}</AdminError>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="The package">
          <div className="grid gap-3">
            <Field label="Name">
              <input
                className={INPUT_CLS}
                value={v.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Couples session on Belle Mare beach"
              />
            </Field>
            <Field
              label="Type"
              hint="Weddings and wedding films are listed first on the price list; everything else under holiday & family shoots."
            >
              <select
                className={SELECT_CLS}
                value={v.kind}
                onChange={(e) => set('kind', e.target.value as PhotographyPackageInput['kind'])}
              >
                <option value="weddings">Wedding / wedding film</option>
                <option value="shoots">Couples, holiday or family shoot</option>
              </select>
            </Field>
            <Field
              label="Short description"
              hint="Shown on the price-list card and the package page."
            >
              <textarea
                className={TEXTAREA_CLS}
                rows={3}
                value={v.summary}
                onChange={(e) => set('summary', e.target.value)}
                placeholder="Relaxed, romantic photos at golden hour — perfect for honeymoons."
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duration (hours)">
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  className={INPUT_CLS}
                  value={v.durationHours}
                  onChange={(e) => set('durationHours', num(e.target.value))}
                />
              </Field>
              <Field label="Book at least (days ahead)">
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLS}
                  value={v.minAdvanceDays}
                  onChange={(e) => set('minAdvanceDays', num(e.target.value))}
                />
              </Field>
            </div>
            <Field label="Cover photo URL (optional)" hint="Add more photos later in the editor.">
              <input
                className={INPUT_CLS}
                value={v.imageUrl}
                onChange={(e) => set('imageUrl', e.target.value)}
                placeholder="https://…"
              />
            </Field>
          </div>
        </Card>

        <Card title="Price, guests & dates">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Package price (€)">
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLS}
                  value={v.baseEur}
                  onChange={(e) => set('baseEur', num(e.target.value))}
                />
              </Field>
              <Field label="Price covers (guests)">
                <input
                  type="number"
                  min={1}
                  className={INPUT_CLS}
                  value={v.included}
                  onChange={(e) => set('included', num(e.target.value))}
                />
              </Field>
              <Field label="Each extra guest (€)" hint="0 = extra guests are free.">
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLS}
                  value={v.extraEur}
                  onChange={(e) => set('extraEur', num(e.target.value))}
                />
              </Field>
              <Field label="Max guests">
                <input
                  type="number"
                  min={1}
                  className={INPUT_CLS}
                  value={v.maxGuests}
                  onChange={(e) => set('maxGuests', num(e.target.value))}
                />
              </Field>
            </div>
            <Field
              label="Shoots you can do per day"
              hint="Each booking takes one. Close specific weekdays or stop sales later under Dates."
            >
              <input
                type="number"
                min={1}
                className={INPUT_CLS}
                value={v.shootsPerDay}
                onChange={(e) => set('shootsPerDay', num(e.target.value))}
              />
            </Field>
            <Field label="Status">
              <select
                className={SELECT_CLS}
                value={v.status}
                onChange={(e) => set('status', e.target.value as PhotographyPackageInput['status'])}
              >
                <option value="published">Published — bookable now</option>
                <option value="draft">Draft — hidden until you publish it</option>
              </select>
            </Field>
          </div>
        </Card>

        <Card title="Add-ons (charged once per shoot)">
          <div className="flex flex-col gap-2">
            {v.addOns.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_90px_auto] items-center gap-2">
                <input
                  aria-label="Add-on name"
                  className={INPUT_CLS}
                  value={a.name}
                  onChange={(e) =>
                    set(
                      'addOns',
                      v.addOns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  placeholder="Name"
                />
                <input
                  aria-label="French name"
                  className={INPUT_CLS}
                  value={a.nameFr}
                  onChange={(e) =>
                    set(
                      'addOns',
                      v.addOns.map((x, j) => (j === i ? { ...x, nameFr: e.target.value } : x)),
                    )
                  }
                  placeholder="French name"
                />
                <input
                  aria-label="Price (€)"
                  type="number"
                  min={0}
                  className={INPUT_CLS}
                  value={a.priceEur}
                  onChange={(e) =>
                    set(
                      'addOns',
                      v.addOns.map((x, j) =>
                        j === i ? { ...x, priceEur: num(e.target.value) } : x,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label="Remove add-on"
                  onClick={() =>
                    set(
                      'addOns',
                      v.addOns.filter((_, j) => j !== i),
                    )
                  }
                  className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-coral/10 hover:text-coral"
                >
                  <IconX width={15} height={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set('addOns', [...v.addOns, { name: '', nameFr: '', priceEur: 0 }])}
              className={`${BTN_GHOST} mt-1 w-fit`}
            >
              <IconPlus width={15} height={15} /> Add an add-on
            </button>
          </div>
        </Card>

        <Card title="What’s included">
          <div className="flex flex-col gap-2">
            {v.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  aria-label="Included item"
                  className={INPUT_CLS}
                  value={f}
                  onChange={(e) =>
                    set(
                      'features',
                      v.features.map((x, j) => (j === i ? e.target.value : x)),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label="Remove item"
                  onClick={() =>
                    set(
                      'features',
                      v.features.filter((_, j) => j !== i),
                    )
                  }
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-coral/10 hover:text-coral"
                >
                  <IconX width={15} height={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set('features', [...v.features, ''])}
              className={`${BTN_GHOST} mt-1 w-fit`}
            >
              <IconPlus width={15} height={15} /> Add an item
            </button>
          </div>
        </Card>
      </div>

      <div className="sticky bottom-0 mt-5 flex items-center gap-2 border-t border-[#EAEEF0] bg-white/95 py-4 backdrop-blur">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          {busy ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : 'Create package'}
        </button>
        <Link href="/admin/photography" className={BTN_GHOST}>
          {editing ? 'Back to photography' : 'Cancel'}
        </Link>
        {saved && (
          <span role="status" className="ml-auto text-[12.5px] font-bold text-teal">
            Saved ✓
          </span>
        )}
      </div>
    </form>
  );
}
