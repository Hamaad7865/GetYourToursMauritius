'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createPhotographyPackage,
  loadPhotographyPackage,
  savePhotographyPackage,
  uploadPhotographyPhoto,
  type LoadedPackage,
  type PhotographyPackageInput,
} from '@/lib/admin/photography';
import { PHOTOGRAPHY_ADD_ON_PRESETS } from '@/lib/catalogue/photography';
import type { PhotographyShoot } from '@/lib/catalogue/photography-shoots';
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
  bestSeller: false,
  photoCount: 0,
  locationLine: '',
  deliveryLine: '',
  showDuration: true,
  showGuests: true,
  showAddOns: true,
  showDeposit: true,
  showDetails: true,
  inspiration: [],
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
export function PhotographyPackageForm({
  packageId,
  template,
}: { packageId?: string; template?: PhotographyShoot } = {}) {
  const router = useRouter();
  const editing = Boolean(packageId);
  const [v, setV] = useState<PhotographyPackageInput>(() =>
    template
      ? {
          ...START,
          title: template.title,
          summary: template.summary,
          imageUrl: template.image,
          baseEur: 0,
          extraEur: 0,
          status: 'draft',
        }
      : START,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edit mode: the saved package, loaded once. Everything the simple form does not show (slug,
  // description, more photos, French, itinerary…) rides through `loaded.values` unchanged on save.
  const [loaded, setLoaded] = useState<LoadedPackage | null>(null);
  const [loading, setLoading] = useState(editing);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

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

  async function uploadCover(file: File | undefined) {
    if (!file || uploadingCover) return;
    setUploadingCover(true);
    setError(null);
    try {
      set('imageUrl', await uploadPhotographyPhoto(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the cover photo.');
    } finally {
      setUploadingCover(false);
    }
  }

  function removeInspiration(url: string) {
    set(
      'inspiration',
      v.inspiration.filter((x) => x !== url),
    );
  }

  async function uploadInspiration(files: FileList | null) {
    if (!files?.length || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        urls.push(await uploadPhotographyPhoto(file));
      }
      set('inspiration', [...v.inspiration, ...urls]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the photo.');
    } finally {
      setUploading(false);
    }
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
            <Field
              label="Cover photo (optional)"
              hint="Upload, or paste a URL. Add more photos later in the editor."
            >
              {v.imageUrl.trim() && (
                <span className="mb-2 block overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={v.imageUrl}
                    alt=""
                    loading="lazy"
                    className="aspect-[16/10] w-full object-cover"
                  />
                </span>
              )}
              <div className="flex gap-2">
                <input
                  className={INPUT_CLS}
                  value={v.imageUrl}
                  onChange={(e) => set('imageUrl', e.target.value)}
                  placeholder="https://…"
                />
                <label
                  className={`${BTN_GHOST} shrink-0 cursor-pointer ${uploadingCover ? 'opacity-50' : ''}`}
                >
                  {uploadingCover ? 'Uploading…' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingCover}
                    className="sr-only"
                    onChange={(e) => {
                      void uploadCover(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
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

        <Card title="Price-card specs">
          <div className="grid gap-3">
            <label className="flex items-start gap-2.5 text-sm font-medium text-ink">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-teal"
                checked={v.bestSeller}
                onChange={(e) => set('bestSeller', e.target.checked)}
              />
              <span>
                Best seller
                <span className="mt-0.5 block text-[12px] font-normal text-ink-muted">
                  Shows a “Best seller” badge on this package’s page. Tick only one package.
                </span>
              </span>
            </label>
            <Field
              label="Edited photos included"
              hint="0 hides the tick. Shown as “Up to N edited photos”."
            >
              <input
                type="number"
                min={0}
                className={INPUT_CLS}
                value={v.photoCount}
                onChange={(e) => set('photoCount', num(e.target.value))}
              />
            </Field>
            <Field
              label="Location line (optional)"
              hint="e.g. Beach of your choice. Empty hides the tick."
            >
              <input
                className={INPUT_CLS}
                value={v.locationLine}
                onChange={(e) => set('locationLine', e.target.value)}
                placeholder="Beach of your choice"
              />
            </Field>
            <Field
              label="Delivery line (optional)"
              hint="e.g. Delivery in 3 weeks. Empty hides the tick."
            >
              <input
                className={INPUT_CLS}
                value={v.deliveryLine}
                onChange={(e) => set('deliveryLine', e.target.value)}
                placeholder="Delivery in 3 weeks"
              />
            </Field>
            <div className="flex flex-col gap-2 border-t border-[#EAEEF0] pt-3">
              <p className="text-sm font-bold text-ink">Show on the price card</p>
              {(
                [
                  ['showDuration', 'Duration'],
                  ['showGuests', 'Guest count'],
                  ['showAddOns', 'Add-ons line'],
                  ['showDeposit', 'Deposit line'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-teal"
                    checked={v[key]}
                    onChange={(e) => set(key, e.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="flex items-start gap-2.5 text-sm font-medium text-ink">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-teal"
                checked={v.showDetails}
                onChange={(e) => set('showDetails', e.target.checked)}
              />
              <span>
                Package details section
                <span className="mt-0.5 block text-[12px] font-normal text-ink-muted">
                  The “Package details” collapsible on the package’s page. Untick to remove it.
                </span>
              </span>
            </label>
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

        <Card title="Inspiration photos">
          <p className="-mt-1 mb-3 text-[12px] leading-snug text-ink-muted">
            The package’s own photos for “Get inspired by these shots”, in order. Upload here — they
            live on this package, not the shared gallery. Empty = automatic by shoot type.
          </p>
          {v.inspiration.length > 0 && (
            <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {v.inspiration.map((url, i) => (
                <span
                  key={`${url}-${i}`}
                  className="relative overflow-hidden rounded-lg ring-2 ring-teal"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                  <span className="absolute left-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-teal px-1 text-[11px] font-extrabold text-white">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => removeInspiration(url)}
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/70 text-white hover:bg-coral"
                  >
                    <IconX width={12} height={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <label className={`${BTN_GHOST} w-fit cursor-pointer`}>
            <IconPlus width={15} height={15} /> {uploading ? 'Uploading…' : 'Upload photos'}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading}
              className="sr-only"
              onChange={(e) => {
                void uploadInspiration(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {v.inspiration.length > 0 && (
            <button
              type="button"
              onClick={() => set('inspiration', [])}
              className="mt-2 block text-[12.5px] font-bold text-ink-muted hover:text-coral"
            >
              Clear photos ({v.inspiration.length} added — back to automatic)
            </button>
          )}
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
