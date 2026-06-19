'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCategories } from '@/lib/categories/useCategories';
import { IconPlus, IconX } from '@/components/ui/icons';
import {
  EMPTY_ACTIVITY,
  createActivity,
  loadActivityForEdit,
  slugify,
  updateActivity,
  uploadActivityImage,
  type ActivityFormValues,
  type ImageInput,
  type ItineraryStopInput,
  type OptionInput,
} from '@/lib/admin/activity-write';

export function ActivityForm({ mode, id }: { mode: 'new' | 'edit'; id?: string }) {
  const router = useRouter();
  const categories = useCategories();
  const [values, setValues] = useState<ActivityFormValues | null>(mode === 'new' ? EMPTY_ACTIVITY : null);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugLocked, setSlugLocked] = useState(mode === 'edit');

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
      if (mode === 'new') await createActivity(v);
      else if (id) await updateActivity(id, v);
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
                  prev ? { ...prev, title: e.target.value, slug: slugLocked ? prev.slug : slugify(e.target.value) } : prev,
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
            <select className={inputClass} value={v.category} onChange={(e) => set('category', e.target.value)}>
              {/* Always include the current value so editing an activity in a removed/renamed
                  category still shows it. */}
              {[...new Set([...categories.map((c) => c.name), v.category].filter(Boolean))].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
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
              onChange={(e) => set('durationMinutes', e.target.value ? Number(e.target.value) : null)}
              placeholder="480"
            />
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
          <Field label="Home region (transport add-on)">
            <select className={inputClass} value={v.region} onChange={(e) => set('region', e.target.value)}>
              <option value="">Auto (from map coordinates)</option>
              <option value="North">North</option>
              <option value="South">South</option>
              <option value="East">East</option>
              <option value="West">West</option>
              <option value="Central">Central</option>
            </select>
            <p className="mt-1.5 text-[12px] text-ink-muted">
              The activity’s boarding region. For per-person / per-group activities with hotel pickup, the
              door-to-door transport fee scales with how far the customer’s pickup is from this region. Fares
              live in Vehicle pricing → Activity transport add-on.
            </p>
          </Field>
          <Field label="Pricing">
            <select
              className={inputClass}
              value={v.pricingMode}
              onChange={(e) => set('pricingMode', e.target.value as ActivityFormValues['pricingMode'])}
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
          <div className="grid gap-5 sm:grid-cols-2">
            <StringList label="Highlights" items={v.highlights} onChange={(x) => set('highlights', x)} />
            <StringList label="Languages" items={v.languages} onChange={(x) => set('languages', x)} />
            <StringList label="What's included" items={v.inclusions} onChange={(x) => set('inclusions', x)} />
            <StringList label="Not included" items={v.exclusions} onChange={(x) => set('exclusions', x)} />
          </div>
        </div>
      </Section>

      <Section title="Photos" hint="Upload files or paste image URLs. The first photo is the cover.">
        <ImagesEditor images={v.images} slug={v.slug} onChange={(x) => set('images', x)} />
      </Section>

      <Section
        title="Options & pricing"
        hint="Each option (e.g. Shared, Private) has price tiers: a label, a € price, and a “fits up to” number. Its meaning follows the Pricing mode above — a per-tier cap (per person) or the group size (per group)."
      >
        {v.pricingMode === 'vehicle' ? (
          <p className="rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] text-ink-muted">
            Vehicle-priced tours use the global flat prices (Sedan €70 / SUV €85 / Family €85 / Van
            €125 / Coaster €225 · max 25). Add a single option (e.g. “Sightseeing”) so dates can be
            scheduled — no price tiers required.
          </p>
        ) : (
          <OptionsEditor options={v.options} onChange={(x) => set('options', x)} />
        )}
      </Section>

      <Section
        title="Itinerary"
        hint="The stops shown on the map and timeline. Add alternatives under a stop to let the customer pick a different place there."
      >
        <ItineraryEditor stops={v.itinerary} onChange={(x) => set('itinerary', x)} />
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

const inputClass =
  'w-full rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-muted/70 focus:border-teal focus:bg-white';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#EAEEF0] bg-white p-5 sm:p-6">
      <h2 className="text-[15px] font-extrabold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-[13px] text-ink-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
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

function StringList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  function add() {
    const t = draft.trim();
    if (!t) return;
    onChange([...items, t]);
    setDraft('');
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-bold text-ink">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span key={`${it}-${i}`} className="flex items-center gap-1 rounded-full bg-cream px-3 py-1 text-[13px] text-ink">
            {it}
            <button
              type="button"
              aria-label={`Remove ${it}`}
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="text-ink-muted hover:text-coral"
            >
              <IconX width={13} height={13} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={`Add ${label.toLowerCase()}…`}
        />
        <button
          type="button"
          onClick={add}
          className="shrink-0 rounded-xl border border-ink/15 px-3 text-ink hover:border-teal hover:text-teal"
        >
          <IconPlus width={16} height={16} />
        </button>
      </div>
    </div>
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

  function update(i: number, patch: Partial<ImageInput>) {
    onChange(images.map((img, idx) => (idx === i ? { ...img, ...patch } : img)));
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
      setUploadError(err instanceof Error ? err.message : 'Upload failed (is the storage bucket set up?).');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {images.map((img, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-ink/10 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt={img.alt || 'preview'} className="h-14 w-20 shrink-0 rounded-lg object-cover" />
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

function OptionsEditor({ options, onChange }: { options: OptionInput[]; onChange: (o: OptionInput[]) => void }) {
  function update(i: number, patch: Partial<OptionInput>) {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  return (
    <div className="flex flex-col gap-4">
      {options.map((opt, i) => (
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
          <div className="mt-3 flex flex-col gap-2">
            {opt.prices.map((p, pi) => (
              <div key={pi} className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={p.label}
                  onChange={(e) =>
                    update(i, { prices: opt.prices.map((x, xi) => (xi === pi ? { ...x, label: e.target.value } : x)) })
                  }
                  placeholder="Tier (e.g. Adult, Up to 4)"
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
                      update(i, {
                        prices: opt.prices.map((x, xi) =>
                          xi === pi ? { ...x, amountEur: e.target.value ? Number(e.target.value) : null } : x,
                        ),
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
                    update(i, {
                      prices: opt.prices.map((x, xi) =>
                        xi === pi ? { ...x, maxGuests: e.target.value ? Number(e.target.value) : null } : x,
                      ),
                    })
                  }
                  placeholder="Group"
                  aria-label="Group size (max guests) — leave blank for per-person pricing"
                  title="Group size — set e.g. 4 for &quot;per group up to 4&quot;; leave blank for per-person"
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
            ))}
            <button
              type="button"
              onClick={() => update(i, { prices: [...opt.prices, { label: '', amountEur: null, maxGuests: null }] })}
              className="self-start text-[13px] font-bold text-teal hover:text-teal-dark"
            >
              + Add price tier
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...options, { name: '', prices: [{ label: '', amountEur: null, maxGuests: null }] }])}
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
              Leave empty to keep this stop fixed. Add e.g. Fort Adelaide so the customer can swap it
              for {stop.title.trim() || 'this stop'}.
            </p>
            {stop.options.map((opt, oi) => (
              <div key={oi} className="mb-2 flex items-center gap-2">
                <input
                  className={inputClass}
                  value={opt.title}
                  onChange={(e) =>
                    update(i, {
                      options: stop.options.map((o, idx) => (idx === oi ? { ...o, title: e.target.value } : o)),
                    })
                  }
                  placeholder="Alternative place (e.g. Fort Adelaide)"
                />
                <input
                  className={inputClass}
                  value={opt.area}
                  onChange={(e) =>
                    update(i, {
                      options: stop.options.map((o, idx) => (idx === oi ? { ...o, area: e.target.value } : o)),
                    })
                  }
                  placeholder="Area"
                />
                <button
                  type="button"
                  aria-label="Remove alternative"
                  onClick={() => update(i, { options: stop.options.filter((_, idx) => idx !== oi) })}
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
        onClick={() => onChange([...stops, { title: '', area: '', description: '', tags: [], options: [] }])}
        className="self-start rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
      >
        Add stop
      </button>
    </div>
  );
}
