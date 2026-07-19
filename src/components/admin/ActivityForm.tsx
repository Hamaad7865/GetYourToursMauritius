'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCategories } from '@/lib/categories/useCategories';
import { IconChevron, IconDocument, IconGrip, IconX } from '@/components/ui/icons';
import { BADGE_ICONS, badgeIcon } from '@/components/ui/badge-icons';
import { Section, StringList, inputClass } from '@/components/admin/fields';
import { loadContentDefaults as loadContentDefaultsMap } from '@/lib/admin/content-defaults';
import { highlightsAreOverridden, type ContentDefaults } from '@/lib/catalogue/content-defaults';
import type { BadgeInput } from '@/lib/catalogue/badges';
import { moveItem } from '@/lib/admin/reorder';
import {
  EMPTY_ACTIVITY,
  createActivity,
  loadActivityForEdit,
  slugify,
  updateActivity,
  uploadActivityImage,
  uploadActivityPdf,
  type ActivityFormValues,
  type ImageInput,
  type ItineraryStopInput,
  type OptionInput,
} from '@/lib/admin/activity-write';

export function ActivityForm({ mode, id }: { mode: 'new' | 'edit'; id?: string }) {
  const router = useRouter();
  const { profile } = useAuth();
  // The restricted 'seo' content role edits copy/photos/itinerary only: the pricing controls are
  // hidden and the save skips options/prices + the staff-gated materialize RPC (RLS blocks them).
  const contentOnly = profile?.role === 'seo';
  const categories = useCategories();
  const [values, setValues] = useState<ActivityFormValues | null>(
    mode === 'new' ? EMPTY_ACTIVITY : null,
  );
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugLocked, setSlugLocked] = useState(mode === 'edit');
  // Which categories have standard highlights — drives the notice on the Highlights field, since a
  // category's standard highlights REPLACE whatever is typed here. Best-effort: a failure just means
  // no notice, never a broken form.
  const [contentDefaults, setContentDefaults] = useState<Record<string, ContentDefaults>>({});

  useEffect(() => {
    let cancelled = false;
    loadContentDefaultsMap()
      .then((d) => {
        if (!cancelled) setContentDefaults(d);
      })
      .catch(() => {
        /* no notice is better than a broken editor */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    loadActivityForEdit(id)
      .then((v) => {
        if (v) setValues(v);
        else setError('Activity not found.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load.'))
      .finally(() => setLoading(false));
  }, [mode, id]);

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!values) return <p className="text-sm text-coral">{error ?? 'Not found.'}</p>;
  const v = values;
  const highlightsOverridden = highlightsAreOverridden(v.category, contentDefaults);

  function set<K extends keyof ActivityFormValues>(key: K, val: ActivityFormValues[K]) {
    setValues((prev) => (prev ? { ...prev, [key]: val } : prev));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!v.title.trim()) return setError('Title is required.');
    if (!v.slug.trim()) return setError('A URL slug is required.');
    setSaving(true);
    try {
      if (mode === 'new') await createActivity(v, { contentOnly });
      else if (id) await updateActivity(id, v, { contentOnly });
      router.push('/admin/activities');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the activity.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-8 pb-16">
      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required full>
            <input
              className={inputClass}
              value={v.title}
              onChange={(e) =>
                setValues((prev) =>
                  prev
                    ? {
                        ...prev,
                        title: e.target.value,
                        slug: slugLocked ? prev.slug : slugify(e.target.value),
                      }
                    : prev,
                )
              }
              placeholder="North Tour – Port Louis, Pamplemousses & Cap Malheureux"
            />
          </Field>
          <Field label="URL slug" required hint="The web address: /activities/your-slug">
            <input
              className={inputClass}
              value={v.slug}
              onChange={(e) => {
                setSlugLocked(true);
                set('slug', slugify(e.target.value));
              }}
              placeholder="north-tour"
            />
          </Field>
          <Field label="Category" required>
            <select
              className={inputClass}
              value={v.category}
              onChange={(e) => set('category', e.target.value)}
            >
              {/* Always include the current value so editing an activity in a removed/renamed
                  category still shows it. */}
              {[...new Set([...categories.map((c) => c.name), v.category].filter(Boolean))].map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Type">
            <select
              className={inputClass}
              value={v.type}
              onChange={(e) => set('type', e.target.value as ActivityFormValues['type'])}
            >
              <option value="activity">Activity</option>
              <option value="transport">Transport / transfer</option>
            </select>
          </Field>
          <Field label="Status">
            <select
              className={inputClass}
              value={v.status}
              onChange={(e) => set('status', e.target.value as ActivityFormValues['status'])}
            >
              <option value="published">Published (visible on the site)</option>
              <option value="draft">Draft (hidden)</option>
            </select>
          </Field>
          <Field label="Location">
            <input
              className={inputClass}
              value={v.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="North"
            />
          </Field>
          <Field label="Duration (minutes)">
            <input
              type="number"
              min={0}
              className={inputClass}
              value={v.durationMinutes ?? ''}
              onChange={(e) =>
                set('durationMinutes', e.target.value ? Number(e.target.value) : null)
              }
              placeholder="480"
            />
          </Field>
          <Field label="Minimum advance booking (days)">
            <input
              type="number"
              min={0}
              max={60}
              className={inputClass}
              value={v.minAdvanceDays}
              onChange={(e) =>
                set('minAdvanceDays', e.target.value ? Math.max(0, Number(e.target.value)) : 0)
              }
              placeholder="1"
            />
            <p className="mt-1.5 text-[12px] text-ink-muted">
              How many days ahead a customer must book. 1 = next day (the default — no same-day).
              Raise it for trips that need planning (e.g. 3); the date picker hides any sooner dates
              and the server rejects them.
            </p>
          </Field>
        </div>
      </Section>

      <Section title="Description & details">
        <div className="flex flex-col gap-4">
          <Field label="Short summary" full>
            <textarea
              className={inputClass}
              rows={2}
              value={v.summary}
              onChange={(e) => set('summary', e.target.value)}
              placeholder="A full day exploring the north…"
            />
          </Field>
          <Field label="Full description" full>
            <textarea
              className={inputClass}
              rows={6}
              value={v.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Meeting point">
              <input
                className={inputClass}
                value={v.meetingPoint}
                onChange={(e) => set('meetingPoint', e.target.value)}
              />
            </Field>
            <Field label="Cancellation policy">
              <input
                className={inputClass}
                value={v.cancellationPolicy}
                onChange={(e) => set('cancellationPolicy', e.target.value)}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal"
              checked={v.pickupAvailable}
              onChange={(e) => set('pickupAvailable', e.target.checked)}
            />
            Hotel pickup available
          </label>
          <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal"
              checked={v.isPrivate}
              onChange={(e) => set('isPrivate', e.target.checked)}
            />
            Private — exclusive to the booker’s party
          </label>
          <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal"
              checked={v.adultsOnly}
              onChange={(e) => set('adultsOnly', e.target.checked)}
            />
            Adults only (18+) — no children; hides the baby &amp; child seats add-on
          </label>
          <Field label="Start time / departure">
            <input
              className={inputClass}
              value={v.startWindow}
              onChange={(e) => set('startWindow', e.target.value)}
              placeholder="e.g. 09:00 or 07:30–09:30"
            />
            <p className="mt-1.5 text-[12px] text-ink-muted">
              Shown in the “at a glance” facts as the departure time. Leave blank to show “Check
              availability for start times”.
            </p>
          </Field>
          <Field label="Home region (transport add-on)">
            <select
              className={inputClass}
              value={v.region}
              onChange={(e) => set('region', e.target.value)}
            >
              <option value="">Auto (from map coordinates)</option>
              <option value="North">North</option>
              <option value="South">South</option>
              <option value="East">East</option>
              <option value="West">West</option>
              <option value="Central">Central</option>
            </select>
            <p className="mt-1.5 text-[12px] text-ink-muted">
              The activity’s boarding region. For per-person / per-group activities with hotel
              pickup, the door-to-door transport fee scales with how far the customer’s pickup is
              from this region. Fares live in Vehicle pricing → Activity transport add-on.
            </p>
          </Field>
          <Field label="Map location (AI trip planner)">
            <div className="flex gap-2.5">
              <input
                className={inputClass}
                type="number"
                step="any"
                value={v.lat ?? ''}
                onChange={(e) => set('lat', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="Latitude, e.g. -20.19"
                aria-label="Latitude"
              />
              <input
                className={inputClass}
                type="number"
                step="any"
                value={v.lng ?? ''}
                onChange={(e) => set('lng', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="Longitude, e.g. 57.77"
                aria-label="Longitude"
              />
            </div>
            <p className="mt-1.5 text-[12px] text-ink-muted">
              Where this activity’s branded marker sits on the AI trip planner’s map. Leave blank to
              place it automatically (itinerary coordinates, else a lookup of the location name).
            </p>
          </Field>
          <Field label="Price list (PDF)">
            <PriceListEditor
              url={v.priceListUrl}
              label={v.priceListLabel}
              slug={v.slug}
              onUrl={(u) => set('priceListUrl', u)}
              onLabel={(l) => set('priceListLabel', l)}
            />
            <p className="mt-1.5 text-[12px] text-ink-muted">
              Upload a price-list PDF to show a “Price list” section on the activity page (embedded
              on desktop, with a download button everywhere). Leave empty to hide it.
            </p>
          </Field>
          {!contentOnly && (
            <Field label="Pricing">
              <select
                className={inputClass}
                value={v.pricingMode}
                onChange={(e) =>
                  set('pricingMode', e.target.value as ActivityFormValues['pricingMode'])
                }
              >
                <option value="per_person">Per person (price × people)</option>
                <option value="per_group">Per group (one price per group of N)</option>
                <option value="vehicle">Sightseeing vehicle (flat per-vehicle price)</option>
              </select>
              <p className="mt-1.5 text-[12px] text-ink-muted">
                {v.pricingMode === 'vehicle'
                  ? 'Sightseeing vehicle pricing is global, one flat price per vehicle: Sedan €70 / SUV €85 (1–4), Family car €85 (5–6), Van €125 (7–14), Coaster €225 (15–25), capped at 25. Applies to every vehicle-priced tour — no per-tour tiers. Change it in the sightseeing_pricing table.'
                  : v.pricingMode === 'per_group'
                    ? 'The price buys one group of up to “fits up to” people; bigger parties pay for extra groups (ceil(people / size) × price).'
                    : 'Each guest pays the tier price. “Fits up to” is an optional hard cap per tier.'}
              </p>
            </Field>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <StringList
              label="Highlights"
              items={v.highlights}
              onChange={(x) => set('highlights', x)}
              hint={
                highlightsOverridden ? (
                  // Without this, the field silently does nothing on these tours — the trap that
                  // hid 50 lines across 9 sightseeing tours. Say so instead of quietly discarding.
                  <span className="text-[12px] font-semibold text-coral-dark">
                    “{v.category}” has standard highlights, which replace anything you put here.
                    Edit them in Standard content.
                  </span>
                ) : undefined
              }
            />
            <StringList
              label="Languages"
              items={v.languages}
              onChange={(x) => set('languages', x)}
            />
            <StringList
              label="What's included"
              items={v.inclusions}
              onChange={(x) => set('inclusions', x)}
            />
            <StringList
              label="Not included"
              items={v.exclusions}
              onChange={(x) => set('exclusions', x)}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Photos"
        hint="Upload files or paste image URLs. Drag a photo by its handle to reorder (or use the arrows) — the first photo is the cover and the first five fill the detail-page gallery."
      >
        <ImagesEditor images={v.images} slug={v.slug} onChange={(x) => set('images', x)} />
      </Section>

      {!contentOnly && (
        <Section
          title="Options & pricing"
          hint="Each option (e.g. Shared, Private) has price tiers: a label, a € price, and a “fits up to” number. Its meaning follows the Pricing mode above — a per-tier cap (per person) or the group size (per group)."
        >
          {v.pricingMode === 'vehicle' ? (
            <>
              <p className="rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] text-ink-muted">
                Vehicle-priced tours use the global flat prices (Sedan €70 / SUV €85 / Family €85 /
                Van €125 / Coaster €225 · max 25). Add a single option (e.g. “Sightseeing”) so dates
                can be scheduled — no price tiers required.
              </p>
              {v.options.some((o) => o.isPrivateOption) && (
                // The options editor is hidden in vehicle mode, so without this the save error
                // ("private option isn't available on vehicle-priced tours") had no visible fix.
                <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-lg border border-coral/40 bg-coral/5 px-3 py-2.5 text-[12.5px] text-ink">
                  <span>
                    This tour still has a <b>Private option</b> — not available with vehicle
                    pricing, so saving will fail until it&rsquo;s removed.
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        'options',
                        v.options.map((o) => ({ ...o, isPrivateOption: false })),
                      )
                    }
                    className="rounded-lg border border-coral/50 px-2.5 py-1 text-[12px] font-bold text-coral-dark hover:bg-coral/10"
                  >
                    Remove private option
                  </button>
                </div>
              )}
            </>
          ) : (
            <OptionsEditor options={v.options} onChange={(x) => set('options', x)} />
          )}
        </Section>
      )}

      <Section
        title="Itinerary"
        hint="The stops shown on the map and timeline. Add alternatives under a stop to let the customer pick a different place there."
      >
        <ItineraryEditor stops={v.itinerary} onChange={(x) => set('itinerary', x)} />
      </Section>

      <Section
        title="Important information"
        hint="Two lists shown in the “Important information” block on the activity page. “What to bring” is a packing checklist; “Know before you go” holds notes like the infant policy, halal food, or parking. For catamaran & sightseeing tours these merge with the shared defaults (duplicates are removed)."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <StringList
            label="What to bring"
            items={v.whatToBring}
            onChange={(x) => set('whatToBring', x)}
          />
          <StringList
            label="Know before you go"
            items={v.importantInfo}
            onChange={(x) => set('importantInfo', x)}
          />
        </div>
      </Section>

      <Section
        title="Custom badges"
        hint="Custom badges replace the default highlights strip on the activity page. Leave empty to keep the defaults."
      >
        <BadgesEditor badges={v.badges} onChange={(x) => set('badges', x)} />
      </Section>

      {error && (
        <p role="alert" className="rounded-xl bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 flex items-center gap-2 border-t border-[#EAEEF0] bg-white/95 py-4 backdrop-blur">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center rounded-xl bg-teal px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
        >
          {saving ? 'Saving…' : mode === 'new' ? 'Create activity' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/admin/activities')}
          className="inline-flex items-center justify-center rounded-xl border border-[#E2E7EA] bg-white px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:border-teal hover:text-teal"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  full,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex flex-col gap-1.5 ${full ? 'sm:col-span-2' : ''}`}>
      <span className="text-[12.5px] font-bold text-ink/60">
        {label} {required && <span className="text-coral">*</span>}
      </span>
      {children}
      {hint && <span className="text-[12px] text-ink-muted">{hint}</span>}
    </label>
  );
}

function ImagesEditor({
  images,
  slug,
  onChange,
}: {
  images: ImageInput[];
  slug: string;
  onChange: (images: ImageInput[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function update(i: number, patch: Partial<ImageInput>) {
    onChange(images.map((img, idx) => (idx === i ? { ...img, ...patch } : img)));
  }

  // Live-reorder as the dragged photo hovers over another row (same pattern as the Tours card reorder).
  function onDragOverRow(e: React.DragEvent, overIndex: number) {
    if (dragIndex === null || dragIndex === overIndex) return;
    e.preventDefault();
    onChange(moveItem(images, dragIndex, overIndex));
    setDragIndex(overIndex);
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const added: ImageInput[] = [];
      for (const file of Array.from(files)) {
        const url = await uploadActivityImage(file, slug);
        added.push({ url, alt: '' });
      }
      onChange([...images, ...added]);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Upload failed (is the storage bucket set up?).',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {images.map((img, i) => (
        <div
          key={i}
          onDragOver={(e) => onDragOverRow(e, i)}
          onDrop={(e) => e.preventDefault()}
          className={`flex items-center gap-2 rounded-xl border border-ink/10 p-2 transition-opacity ${
            dragIndex === i ? 'opacity-40' : ''
          }`}
        >
          <div
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragEnd={() => setDragIndex(null)}
            aria-label={`Drag to reorder photo ${i + 1}`}
            title="Drag to reorder"
            className="grid h-9 w-6 shrink-0 cursor-grab touch-none place-items-center rounded text-ink-muted hover:text-teal active:cursor-grabbing"
          >
            <IconGrip width={16} height={16} />
          </div>
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              aria-label={`Move photo ${i + 1} up`}
              disabled={i === 0}
              onClick={() => onChange(moveItem(images, i, i - 1))}
              className="grid h-6 w-6 place-items-center rounded text-ink-muted hover:text-teal disabled:cursor-not-allowed disabled:opacity-30"
            >
              <IconChevron width={16} height={16} className="rotate-180" />
            </button>
            <button
              type="button"
              aria-label={`Move photo ${i + 1} down`}
              disabled={i === images.length - 1}
              onClick={() => onChange(moveItem(images, i, i + 1))}
              className="grid h-6 w-6 place-items-center rounded text-ink-muted hover:text-teal disabled:cursor-not-allowed disabled:opacity-30"
            >
              <IconChevron width={16} height={16} />
            </button>
          </div>
          <div className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.alt || 'preview'}
              className="h-14 w-20 rounded-lg object-cover"
            />
            <span
              className={`absolute left-1 top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold ${
                i < 5 ? 'bg-teal text-white' : 'bg-ink/55 text-white'
              }`}
            >
              {i + 1}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              className={inputClass}
              value={img.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://…/photo.jpg"
            />
            <input
              className={inputClass}
              value={img.alt}
              onChange={(e) => update(i, { alt: e.target.value })}
              placeholder="Alt text (what the photo shows)"
            />
          </div>
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => onChange(images.filter((_, idx) => idx !== i))}
            className="shrink-0 text-ink-muted hover:text-coral"
          >
            <IconX width={18} height={18} />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal">
          {uploading ? 'Uploading…' : 'Upload photos'}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
        <button
          type="button"
          onClick={() => onChange([...images, { url: '', alt: '' }])}
          className="rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
        >
          Add image URL
        </button>
      </div>
      {uploadError && <p className="text-[13px] font-medium text-coral">{uploadError}</p>}
    </div>
  );
}

function PriceListEditor({
  url,
  label,
  slug,
  onUrl,
  onLabel,
}: {
  url: string;
  label: string;
  slug: string;
  onUrl: (url: string) => void;
  onLabel: (label: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      onUrl(await uploadActivityPdf(file, slug));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Upload failed (is the storage bucket set up?).',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {url ? (
        <div className="flex items-center gap-3 rounded-xl border border-ink/10 p-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-coral/10 text-coral">
            <IconDocument width={18} height={18} />
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-[13px] font-semibold text-teal underline"
          >
            {decodeURIComponent(url.split('/').pop() ?? 'price-list.pdf')}
          </a>
          <button
            type="button"
            aria-label="Remove price list"
            onClick={() => onUrl('')}
            className="shrink-0 text-ink-muted hover:text-coral"
          >
            <IconX width={18} height={18} />
          </button>
        </div>
      ) : (
        <label className="cursor-pointer self-start rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal">
          {uploading ? 'Uploading…' : 'Upload PDF'}
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => void onFile(e.target.files)}
          />
        </label>
      )}
      <input
        className={inputClass}
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        placeholder="Label (optional) — e.g. Casela park entry prices"
      />
      {error && <p className="text-[13px] font-medium text-coral">{error}</p>}
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: OptionInput[];
  onChange: (o: OptionInput[]) => void;
}) {
  function update(i: number, patch: Partial<OptionInput>) {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  const presetBtn =
    'rounded-full border border-ink/15 px-2.5 py-1 text-[11.5px] font-bold text-ink hover:border-teal hover:text-teal';
  return (
    <div className="flex flex-col gap-4">
      {options.map((opt, i) => {
        // "Full/Half/Free" presets + the Adult/Child/Infant seed derive from the option's highest tier price.
        const optBase = Math.max(0, ...opt.prices.map((x) => x.amountEur ?? 0));
        const half = optBase > 0 ? Math.round((optBase / 2) * 100) / 100 : null;
        const hasReal = opt.prices.some((p) => p.label.trim() || p.amountEur != null);
        const seedBands = [
          {
            label: 'Adult',
            amountEur: optBase > 0 ? optBase : null,
            maxGuests: null,
            minAge: 11,
            maxAge: null,
          },
          { label: 'Child', amountEur: half, maxGuests: null, minAge: 3, maxAge: 10 },
          { label: 'Infant', amountEur: 0, maxGuests: null, minAge: 0, maxAge: 3 },
        ];
        const patchTier = (pi: number, patch: Partial<OptionInput['prices'][number]>) =>
          update(i, { prices: opt.prices.map((x, xi) => (xi === pi ? { ...x, ...patch } : x)) });
        return (
          <div key={i} className="rounded-xl border border-ink/10 p-4">
            <div className="flex items-center gap-2">
              <input
                className={inputClass}
                value={opt.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Option name (e.g. Private group)"
              />
              <button
                type="button"
                aria-label="Remove option"
                onClick={() => onChange(options.filter((_, idx) => idx !== i))}
                className="shrink-0 text-ink-muted hover:text-coral"
              >
                <IconX width={18} height={18} />
              </button>
            </div>
            {/* Per-option time — Half day vs Full day differ here. Blank falls back to the activity's. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
              <span className="font-semibold">This option:</span>
              <input
                type="number"
                min={0}
                className="w-20 rounded-lg border border-ink/15 px-2 py-1.5 text-ink outline-none"
                value={opt.durationMinutes ?? ''}
                placeholder="mins"
                aria-label="Option duration in minutes"
                onChange={(e) =>
                  update(i, { durationMinutes: e.target.value ? Number(e.target.value) : null })
                }
              />
              <span>min ·</span>
              <input
                className="w-44 rounded-lg border border-ink/15 px-2 py-1.5 text-ink outline-none"
                value={opt.startWindow ?? ''}
                placeholder="start time (e.g. 06:00)"
                aria-label="Option start time"
                onChange={(e) => update(i, { startWindow: e.target.value })}
              />
              <span className="text-ink-muted/70">
                blank = use the activity’s duration / start time
              </span>
            </div>
            {/* Private option: its own trips-per-day pool + base-covers-N + per-extra-head pricing.
                Replaces the price tiers entirely (the private fields ARE the pricing). */}
            <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-ink/10 bg-cream/40 px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-teal"
                checked={Boolean(opt.isPrivateOption)}
                onChange={(e) => {
                  // Saving a private option DELETES its price tiers (the private fields ARE the
                  // pricing) — configured age bands are gone for good. Make that a decision.
                  if (
                    e.target.checked &&
                    opt.prices.length > 0 &&
                    !window.confirm(
                      `Turning this option private will permanently delete its ${opt.prices.length} price tier(s) (incl. any age bands) when you save. Continue?`,
                    )
                  ) {
                    e.target.checked = false;
                    return;
                  }
                  update(
                    i,
                    e.target.checked
                      ? {
                          isPrivateOption: true,
                          privateIncluded: opt.privateIncluded ?? 4,
                          privateExtraEur: opt.privateExtraEur ?? 25,
                        }
                      : { isPrivateOption: false },
                  );
                }}
              />
              <span className="text-[12.5px] text-ink">
                <span className="font-bold">Private option</span> — one booking takes the whole trip
                (own <span className="font-semibold">trips-per-day</span> pool, set in
                Availability). A flat base price covers the first N guests; extra guests pay per
                head.
              </span>
            </label>
            {opt.isPrivateOption && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <label className="text-[12px] font-semibold text-ink-muted">
                  Base price €
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="mt-1 w-full rounded-lg border border-ink/15 px-2.5 py-2 text-sm text-ink outline-none"
                    value={opt.privateBaseEur ?? ''}
                    placeholder="90"
                    onChange={(e) =>
                      update(i, { privateBaseEur: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="text-[12px] font-semibold text-ink-muted">
                  Covers up to (guests)
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-ink/15 px-2.5 py-2 text-sm text-ink outline-none"
                    value={opt.privateIncluded ?? ''}
                    placeholder="4"
                    onChange={(e) =>
                      update(i, { privateIncluded: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="text-[12px] font-semibold text-ink-muted">
                  € per extra guest
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="mt-1 w-full rounded-lg border border-ink/15 px-2.5 py-2 text-sm text-ink outline-none"
                    value={opt.privateExtraEur ?? ''}
                    placeholder="25"
                    onChange={(e) =>
                      update(i, { privateExtraEur: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="text-[12px] font-semibold text-ink-muted">
                  Max group size
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-ink/15 px-2.5 py-2 text-sm text-ink outline-none"
                    value={opt.privateMaxGuests ?? ''}
                    placeholder="8"
                    onChange={(e) =>
                      update(i, {
                        privateMaxGuests: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </label>
                <p className="col-span-2 text-[11.5px] text-ink-muted sm:col-span-4">
                  Example: €90 covers 1–4 guests, €25 per extra guest, max 8 → a party of 6 pays
                  €140. Each booking uses <span className="font-semibold">1 trip</span> for the day
                  — set how many trips you run per day on the Availability screen.
                </p>
              </div>
            )}
            <div className={`mt-3 flex flex-col gap-2 ${opt.isPrivateOption ? 'hidden' : ''}`}>
              {opt.prices.map((p, pi) => (
                <div key={pi} className="rounded-lg border border-ink/10 p-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      value={p.label}
                      onChange={(e) => patchTier(pi, { label: e.target.value })}
                      placeholder="Tier (e.g. Adult, Child, Infant)"
                    />
                    <div className="flex w-32 shrink-0 items-center gap-1 rounded-xl border border-ink/15 px-3">
                      <span className="text-sm text-ink-muted">€</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-full bg-transparent py-2.5 text-sm text-ink outline-none"
                        value={p.amountEur ?? ''}
                        onChange={(e) =>
                          patchTier(pi, {
                            amountEur: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        placeholder="70"
                      />
                    </div>
                    <input
                      type="number"
                      min={1}
                      className="w-24 shrink-0 rounded-xl border border-ink/15 px-3 py-2.5 text-sm text-ink outline-none"
                      value={p.maxGuests ?? ''}
                      onChange={(e) =>
                        patchTier(pi, { maxGuests: e.target.value ? Number(e.target.value) : null })
                      }
                      placeholder="Group"
                      aria-label="Group size (max guests) — leave blank for per-person pricing"
                      title='Group size — set e.g. 4 for "per group up to 4"; leave blank for per-person'
                    />
                    <button
                      type="button"
                      aria-label="Remove tier"
                      onClick={() => update(i, { prices: opt.prices.filter((_, xi) => xi !== pi) })}
                      className="shrink-0 text-ink-muted hover:text-coral"
                    >
                      <IconX width={16} height={16} />
                    </button>
                  </div>
                  {/* Optional age band — drives the "Age 3–10" label + the per-band party selector on the
                      activity page. Leave both blank for a normal (non-age) tier. Presets fill € from the
                      highest tier price in this option. */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
                    <span className="font-semibold">Age</span>
                    <input
                      type="number"
                      min={0}
                      aria-label="Age from"
                      className="w-14 rounded-lg border border-ink/15 px-2 py-1.5 text-ink outline-none"
                      value={p.minAge ?? ''}
                      placeholder="from"
                      onChange={(e) =>
                        patchTier(pi, { minAge: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                    <span>–</span>
                    <input
                      type="number"
                      min={0}
                      aria-label="Age to"
                      className="w-14 rounded-lg border border-ink/15 px-2 py-1.5 text-ink outline-none"
                      value={p.maxAge ?? ''}
                      placeholder="to"
                      onChange={(e) =>
                        patchTier(pi, { maxAge: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                    <span className="mx-1 text-ink/20">|</span>
                    <button
                      type="button"
                      className={presetBtn}
                      onClick={() => patchTier(pi, { amountEur: optBase || null })}
                    >
                      Full
                    </button>
                    <button
                      type="button"
                      className={presetBtn}
                      onClick={() => patchTier(pi, { amountEur: half })}
                    >
                      Half
                    </button>
                    <button
                      type="button"
                      className={presetBtn}
                      onClick={() => patchTier(pi, { amountEur: 0 })}
                    >
                      Free
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() =>
                    update(i, {
                      prices: [...opt.prices, { label: '', amountEur: null, maxGuests: null }],
                    })
                  }
                  className="text-[13px] font-bold text-teal hover:text-teal-dark"
                >
                  + Add price tier
                </button>
                <button
                  type="button"
                  onClick={() =>
                    update(i, { prices: hasReal ? [...opt.prices, ...seedBands] : seedBands })
                  }
                  className="text-[13px] font-bold text-teal hover:text-teal-dark"
                >
                  + Add age bands (Adult / Child / Infant)
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...options,
            {
              name: '',
              durationMinutes: null,
              startWindow: '',
              prices: [{ label: '', amountEur: null, maxGuests: null }],
            },
          ])
        }
        className="self-start rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
      >
        Add option
      </button>
    </div>
  );
}

function ItineraryEditor({
  stops,
  onChange,
}: {
  stops: ItineraryStopInput[];
  onChange: (s: ItineraryStopInput[]) => void;
}) {
  function update(i: number, patch: Partial<ItineraryStopInput>) {
    onChange(stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  return (
    <div className="flex flex-col gap-4">
      {stops.map((stop, i) => (
        <div key={i} className="rounded-xl border border-ink/10 p-4">
          <div className="flex items-start gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <input
                className={inputClass}
                value={stop.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Stop title (e.g. Port Louis)"
              />
              <input
                className={inputClass}
                value={stop.area}
                onChange={(e) => update(i, { area: e.target.value })}
                placeholder="Area (e.g. Capital)"
              />
            </div>
            <button
              type="button"
              aria-label="Remove stop"
              onClick={() => onChange(stops.filter((_, idx) => idx !== i))}
              className="shrink-0 pt-2.5 text-ink-muted hover:text-coral"
            >
              <IconX width={18} height={18} />
            </button>
          </div>
          <textarea
            className={`${inputClass} mt-2`}
            rows={2}
            value={stop.description}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder="What happens at this stop…"
          />
          <div className="mt-2">
            <StringList label="Tags" items={stop.tags} onChange={(t) => update(i, { tags: t })} />
          </div>
          <div className="mt-3 rounded-lg bg-ink/[0.03] p-3">
            <div className="text-[12px] font-bold text-ink">
              Alternatives (the customer picks one instead)
            </div>
            <p className="mb-2 text-[11.5px] text-ink-muted">
              Leave empty to keep this stop fixed. Add e.g. Fort Adelaide so the customer can swap
              it for {stop.title.trim() || 'this stop'}.
            </p>
            {stop.options.map((opt, oi) => (
              <div key={oi} className="mb-2 flex items-center gap-2">
                <input
                  className={inputClass}
                  value={opt.title}
                  onChange={(e) =>
                    update(i, {
                      options: stop.options.map((o, idx) =>
                        idx === oi ? { ...o, title: e.target.value } : o,
                      ),
                    })
                  }
                  placeholder="Alternative place (e.g. Fort Adelaide)"
                />
                <input
                  className={inputClass}
                  value={opt.area}
                  onChange={(e) =>
                    update(i, {
                      options: stop.options.map((o, idx) =>
                        idx === oi ? { ...o, area: e.target.value } : o,
                      ),
                    })
                  }
                  placeholder="Area"
                />
                <button
                  type="button"
                  aria-label="Remove alternative"
                  onClick={() =>
                    update(i, { options: stop.options.filter((_, idx) => idx !== oi) })
                  }
                  className="shrink-0 text-ink-muted hover:text-coral"
                >
                  <IconX width={16} height={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => update(i, { options: [...stop.options, { title: '', area: '' }] })}
              className="rounded-full border border-ink/15 px-3 py-1 text-[12px] font-bold text-ink hover:border-teal hover:text-teal"
            >
              + Add alternative
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...stops, { title: '', area: '', description: '', tags: [], options: [] }])
        }
        className="self-start rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
      >
        Add stop
      </button>
    </div>
  );
}

function BadgesEditor({
  badges,
  onChange,
}: {
  badges: BadgeInput[];
  onChange: (b: BadgeInput[]) => void;
}) {
  function update(i: number, patch: Partial<BadgeInput>) {
    onChange(badges.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  return (
    <div className="flex flex-col gap-4">
      {badges.map((badge, i) => {
        const Icon = badgeIcon(badge.icon);
        return (
          <div key={i} className="rounded-xl border border-ink/10 p-4">
            <div className="flex items-start gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-3">
                <div className="flex items-center gap-2">
                  {Icon ? (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cream text-teal">
                      <Icon width={18} height={18} />
                    </span>
                  ) : (
                    <span className="h-9 w-9 shrink-0 rounded-lg bg-ink/[0.04]" aria-hidden />
                  )}
                  <select
                    className={inputClass}
                    value={badge.icon}
                    onChange={(e) => update(i, { icon: e.target.value })}
                    aria-label="Badge icon"
                  >
                    <option value="">Choose icon…</option>
                    {BADGE_ICONS.map((b) => (
                      <option key={b.key} value={b.key}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  className={inputClass}
                  value={badge.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder="Title (e.g. Free cancellation)"
                />
                <input
                  className={inputClass}
                  value={badge.subtitle}
                  onChange={(e) => update(i, { subtitle: e.target.value })}
                  placeholder="Subtitle (e.g. up to 24h before)"
                />
              </div>
              <button
                type="button"
                aria-label="Remove badge"
                onClick={() => onChange(badges.filter((_, idx) => idx !== i))}
                className="shrink-0 pt-2.5 text-ink-muted hover:text-coral"
              >
                <IconX width={18} height={18} />
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...badges, { icon: '', title: '', subtitle: '' }])}
        className="self-start rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
      >
        Add badge
      </button>
    </div>
  );
}
