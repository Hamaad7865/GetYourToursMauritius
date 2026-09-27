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
import {
  PHOTOGRAPHY_ADD_ON_PRESETS,
  PHOTOGRAPHY_OCCASIONS,
  photographyLocations,
  photographyOccasions,
  photographySlots,
} from '@/lib/catalogue/photography';
import type { PhotographyShoot } from '@/lib/catalogue/photography-shoots';
import { IconChevron, IconPlus, IconX } from '@/components/ui/icons';
import {
  P_BTN,
  P_BTN_GHOST,
  PField,
  PNotice,
  PPill,
  PSection,
  P_INPUT,
  P_SELECT,
  P_TEXTAREA,
} from '@/components/admin/photo-kit';

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
  locations: photographyLocations(null),
  slots: photographySlots(null, 'shoots').map((s) => ({ ...s })),
  occasions: photographyOccasions({ title: '', summary: '' }, null),
};

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The package form — "New package" (the template) and "Edit package" (`packageId` set). It asks only what a photography package needs and writes an ordinary
 * activity: a private option (base price for N guests + per extra guest, capped), one supplement per
 * add-on, and the shoots-per-day capacity that makes dates bookable. In the studio (`embedded`),
 * the dates editor and the full tour editor sit one tab away — same save path throughout.
 */
export function PhotographyPackageForm({
  packageId,
  template,
  embedded = false,
}: { packageId?: string; template?: PhotographyShoot; embedded?: boolean } = {}) {
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

  if (loading)
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-56 animate-pulse rounded-card border border-ink/10 bg-teal-tint/40"
          />
        ))}
      </div>
    );
  if (editing && !loaded) {
    return (
      <div className="space-y-4">
        <PNotice tone="error">{error ?? 'Package not found.'}</PNotice>
        <Link href="/admin/photography" className={P_BTN_GHOST}>
          Back to photography
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={save} className={embedded ? '' : 'pb-16'}>
      {!embedded && (
        <>
          <Link
            href="/admin/photography"
            className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted transition hover:text-teal-dark"
          >
            <IconChevron width={15} height={15} className="rotate-90" /> Photography studio
          </Link>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-extrabold tracking-tight text-ink">
                {editing ? 'Edit package' : 'New photography package'}
              </h1>
              <p className="mt-1 max-w-[64ch] text-sm text-ink-muted">
                {editing
                  ? 'Changes save straight to the live package. Dates, photos, French and search settings are the other tabs above.'
                  : 'Creates a bookable package — dates, extra guests and add-ons included. The dates and full editors unlock once it exists.'}
              </p>
            </div>
            {editing && packageId && loaded && (
              <a
                href={`/activities/${loaded.values.slug}`}
                target="_blank"
                rel="noreferrer"
                className={P_BTN_GHOST}
              >
                View package
              </a>
            )}
          </div>
        </>
      )}
      {embedded && editing && loaded && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            <b className="text-ink">{loaded.values.title}</b>
            <span className="ml-2 text-xs">/activities/{loaded.values.slug}</span>
          </p>
          <a
            href={`/activities/${loaded.values.slug}`}
            target="_blank"
            rel="noreferrer"
            className={P_BTN_GHOST}
          >
            View package
          </a>
        </div>
      )}
      {editing && v.status === 'draft' && (
        <div className="mb-4">
          <PNotice tone="warn">
            This package is a draft — guests can’t see or book it. Check the price and add-ons, then
            set Status to “Published” and save.
          </PNotice>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <PNotice tone="error">{error}</PNotice>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <PSection title="The package">
          <div className="grid gap-3">
            <PField label="Name">
              <input
                className={P_INPUT}
                value={v.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Couples session on Belle Mare beach"
              />
            </PField>
            <PField
              label="Type"
              hint="Weddings and wedding films are listed first on the price list; everything else under holiday & family shoots."
            >
              <select
                className={P_SELECT}
                value={v.kind}
                onChange={(e) => {
                  const kind = e.target.value as PhotographyPackageInput['kind'];
                  // The slots are per group — switching re-derives them from the new group's
                  // defaults (any unsaved slot edits are lost).
                  setSaved(false);
                  setV((cur) => ({
                    ...cur,
                    kind,
                    slots: photographySlots(null, kind).map((s) => ({ ...s })),
                  }));
                }}
              >
                <option value="weddings">Wedding / wedding film</option>
                <option value="shoots">Couples, holiday or family shoot</option>
              </select>
            </PField>
            <PField
              label="Short description"
              hint="Shown on the price-list card and the package page."
            >
              <textarea
                className={P_TEXTAREA}
                rows={3}
                value={v.summary}
                onChange={(e) => set('summary', e.target.value)}
                placeholder="Relaxed, romantic photos at golden hour — perfect for honeymoons."
              />
            </PField>
            <div className="grid grid-cols-2 gap-3">
              <PField label="Duration (hours)">
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  className={P_INPUT}
                  value={v.durationHours}
                  onChange={(e) => set('durationHours', num(e.target.value))}
                />
              </PField>
              <PField label="Book at least (days ahead)">
                <input
                  type="number"
                  min={0}
                  className={P_INPUT}
                  value={v.minAdvanceDays}
                  onChange={(e) => set('minAdvanceDays', num(e.target.value))}
                />
              </PField>
            </div>
            <PField
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
                  className={P_INPUT}
                  value={v.imageUrl}
                  onChange={(e) => set('imageUrl', e.target.value)}
                  placeholder="https://…"
                />
                <label
                  className={`${P_BTN_GHOST} shrink-0 cursor-pointer ${uploadingCover ? 'opacity-50' : ''}`}
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
            </PField>
          </div>
        </PSection>

        <PSection title="Price, guests & dates">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <PField label="Package price (€)">
                <input
                  type="number"
                  min={0}
                  className={P_INPUT}
                  value={v.baseEur}
                  onChange={(e) => set('baseEur', num(e.target.value))}
                />
              </PField>
              <PField label="Price covers (guests)">
                <input
                  type="number"
                  min={1}
                  className={P_INPUT}
                  value={v.included}
                  onChange={(e) => set('included', num(e.target.value))}
                />
              </PField>
              <PField label="Each extra guest (€)" hint="0 = extra guests are free.">
                <input
                  type="number"
                  min={0}
                  className={P_INPUT}
                  value={v.extraEur}
                  onChange={(e) => set('extraEur', num(e.target.value))}
                />
              </PField>
              <PField label="Max guests">
                <input
                  type="number"
                  min={1}
                  className={P_INPUT}
                  value={v.maxGuests}
                  onChange={(e) => set('maxGuests', num(e.target.value))}
                />
              </PField>
            </div>
            <PField
              label="Shoots you can do per day"
              hint="Each booking takes one. Close specific weekdays or stop sales later under Dates."
            >
              <input
                type="number"
                min={1}
                className={P_INPUT}
                value={v.shootsPerDay}
                onChange={(e) => set('shootsPerDay', num(e.target.value))}
              />
            </PField>
            <PField label="Status">
              <select
                className={P_SELECT}
                value={v.status}
                onChange={(e) => set('status', e.target.value as PhotographyPackageInput['status'])}
              >
                <option value="published">Published — bookable now</option>
                <option value="draft">Draft — hidden until you publish it</option>
              </select>
            </PField>
          </div>
        </PSection>

        <PSection title="Price-card specs">
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
            <PField
              label="Edited photos included"
              hint="0 hides the tick. Shown as “Up to N edited photos”."
            >
              <input
                type="number"
                min={0}
                className={P_INPUT}
                value={v.photoCount}
                onChange={(e) => set('photoCount', num(e.target.value))}
              />
            </PField>
            <PField
              label="Location line (optional)"
              hint="e.g. Beach of your choice. Empty hides the tick."
            >
              <input
                className={P_INPUT}
                value={v.locationLine}
                onChange={(e) => set('locationLine', e.target.value)}
                placeholder="Beach of your choice"
              />
            </PField>
            <PField
              label="Delivery line (optional)"
              hint="e.g. Delivery in 3 weeks. Empty hides the tick."
            >
              <input
                className={P_INPUT}
                value={v.deliveryLine}
                onChange={(e) => set('deliveryLine', e.target.value)}
                placeholder="Delivery in 3 weeks"
              />
            </PField>
            <div className="flex flex-col gap-2 border-t border-ink/10 pt-3">
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
        </PSection>

        <PSection
          title="Locations"
          description="Locations with a surcharge are charged automatically at checkout (they become a Location: … add-on). Coast drives the sunrise/sunset light tip."
        >
          <div className="flex flex-col gap-3">
            {v.locations.map((loc, i) => (
              <div key={i} className="rounded-xl border border-ink/10 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <PField label="Name">
                    <input
                      aria-label="Location name"
                      className={P_INPUT}
                      value={loc.name}
                      onChange={(e) =>
                        set(
                          'locations',
                          v.locations.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        )
                      }
                      placeholder="Le Morne"
                    />
                  </PField>
                  <PField label="Region">
                    <input
                      aria-label="Location region"
                      className={P_INPUT}
                      value={loc.region}
                      onChange={(e) =>
                        set(
                          'locations',
                          v.locations.map((x, j) =>
                            j === i ? { ...x, region: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="South-west · mountain and lagoon"
                    />
                  </PField>
                  <PField label="Coast">
                    <select
                      aria-label="Location coast"
                      className={P_SELECT}
                      value={loc.coast}
                      onChange={(e) =>
                        set(
                          'locations',
                          v.locations.map((x, j) =>
                            j === i ? { ...x, coast: e.target.value as typeof loc.coast } : x,
                          ),
                        )
                      }
                    >
                      <option value="east">East coast</option>
                      <option value="west">West coast</option>
                      <option value="any">Anywhere</option>
                    </select>
                  </PField>
                  <PField label="Surcharge (€)" hint="0 = included in the package price.">
                    <input
                      aria-label="Location surcharge"
                      type="number"
                      min={0}
                      className={P_INPUT}
                      value={loc.extraEur}
                      onChange={(e) =>
                        set(
                          'locations',
                          v.locations.map((x, j) =>
                            j === i ? { ...x, extraEur: num(e.target.value) } : x,
                          ),
                        )
                      }
                    />
                  </PField>
                  <PField label="Best at (chip)">
                    <input
                      aria-label="Location best-at chip"
                      className={P_INPUT}
                      value={loc.best}
                      onChange={(e) =>
                        set(
                          'locations',
                          v.locations.map((x, j) => (j === i ? { ...x, best: e.target.value } : x)),
                        )
                      }
                      placeholder="Best at sunset"
                    />
                  </PField>
                  <PField label="Map query">
                    <input
                      aria-label="Location map query"
                      className={P_INPUT}
                      value={loc.mapQuery}
                      onChange={(e) =>
                        set(
                          'locations',
                          v.locations.map((x, j) =>
                            j === i ? { ...x, mapQuery: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Google Maps place, e.g. Le Morne Brabant, Mauritius"
                    />
                  </PField>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  {loc.extraEur > 0 ? (
                    <PPill tone="teal">Location: add-on · €{loc.extraEur}</PPill>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        'locations',
                        v.locations.filter((_, j) => j !== i),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] font-bold text-ink-muted hover:bg-coral/10 hover:text-coral"
                  >
                    <IconX width={13} height={13} /> Remove location
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                set('locations', [
                  ...v.locations,
                  { name: '', region: '', extraEur: 0, coast: 'any', best: '', mapQuery: '' },
                ])
              }
              className={`${P_BTN_GHOST} mt-1 w-fit`}
            >
              <IconPlus width={15} height={15} /> Add a location
            </button>
          </div>
        </PSection>

        <PSection
          title="Light slots"
          description="Times are computed per date from the season’s sunrise/sunset. Switching the package type resets these to that type’s defaults — unsaved slot edits are lost."
        >
          <div className="flex flex-col gap-2">
            {v.slots.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Offer the ${s.label} slot`}
                  className="h-4 w-4 shrink-0 accent-teal"
                  checked={s.enabled}
                  onChange={(e) =>
                    set(
                      'slots',
                      v.slots.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)),
                    )
                  }
                />
                <input
                  aria-label="Slot label"
                  className={P_INPUT}
                  value={s.label}
                  onChange={(e) =>
                    set(
                      'slots',
                      v.slots.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                />
                <input
                  aria-label="Slot note"
                  className={P_INPUT}
                  value={s.note}
                  onChange={(e) =>
                    set(
                      'slots',
                      v.slots.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)),
                    )
                  }
                />
              </div>
            ))}
          </div>
        </PSection>

        {v.kind === 'shoots' && (
          <PSection
            title="Occasions"
            description="Which filter chips this shoot appears under on the photography page."
          >
            <div className="flex flex-col gap-2">
              {PHOTOGRAPHY_OCCASIONS.map(([id, label]) => (
                <label key={id} className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-teal"
                    checked={v.occasions.includes(id)}
                    onChange={(e) =>
                      set(
                        'occasions',
                        e.target.checked
                          ? [...v.occasions, id]
                          : v.occasions.filter((o) => o !== id),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </PSection>
        )}

        <PSection
          title="Add-ons (charged once per shoot)"
          description="Priced locations are not listed here — they are managed by the Locations editor above and charged automatically at checkout."
        >
          <div className="flex flex-col gap-2">
            {v.addOns.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_90px_auto] items-center gap-2">
                <input
                  aria-label="Add-on name"
                  className={P_INPUT}
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
                  className={P_INPUT}
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
                  className={P_INPUT}
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
              className={`${P_BTN_GHOST} mt-1 w-fit`}
            >
              <IconPlus width={15} height={15} /> Add an add-on
            </button>
          </div>
        </PSection>

        <PSection title="What’s included">
          <div className="flex flex-col gap-2">
            {v.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  aria-label="Included item"
                  className={P_INPUT}
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
              className={`${P_BTN_GHOST} mt-1 w-fit`}
            >
              <IconPlus width={15} height={15} /> Add an item
            </button>
          </div>
        </PSection>

        <PSection title="Inspiration photos">
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
          <label className={`${P_BTN_GHOST} w-fit cursor-pointer`}>
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
        </PSection>
      </div>

      <div className="sticky bottom-3 z-10 mt-6 flex items-center gap-2 rounded-full border border-ink/10 bg-white/95 px-4 py-3 shadow-[0_18px_40px_-20px_rgba(10,46,54,0.45)] backdrop-blur">
        <button type="submit" disabled={busy} className={P_BTN}>
          {busy ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : 'Create package'}
        </button>
        <Link href="/admin/photography" className={P_BTN_GHOST}>
          {editing ? 'Back to photography' : 'Cancel'}
        </Link>
        {saved && (
          <span role="status" className="ml-auto pr-2 text-[12.5px] font-bold text-teal-dark">
            Saved ✓
          </span>
        )}
      </div>
    </form>
  );
}
