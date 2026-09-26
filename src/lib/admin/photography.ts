import { getBrowserSupabase } from '@/lib/supabase/browser';
import {
  EMPTY_ACTIVITY,
  createActivity,
  loadActivityForEdit,
  slugify,
  updateActivity,
  uploadActivityImage,
  type ActivityFormValues,
  type OptionInput,
} from '@/lib/admin/activity-write';
import { loadAvailabilityState, setDailyCapacity } from '@/lib/admin/availability-write';
import { createCategory } from '@/lib/admin/categories';
import {
  PHOTOGRAPHY_ADD_ON_PRESETS,
  PHOTOGRAPHY_CATEGORY,
  PHOTOGRAPHY_STARTER_PACKAGES,
  PHOTOGRAPHY_GALLERY_DEFAULTS,
  PHOTO_STOCK,
  isPhotographyCategory,
  photographyAddOnSlugs,
  photographyGroup,
  photographyCover,
  photographyInspirationIds,
  photographySpecs,
  savedPhotographyGroup,
  toPhotographyPhoto,
  type GalleryTag,
  type PhotoMediaType,
  type PhotoSlot,
  type PhotographyGroup,
  type PhotographyPhoto,
} from '@/lib/catalogue/photography';

/* The /admin/photography module. A photography package IS a catalogue activity (category
 * "Photography"), so this module never writes its own tables: it lists those activities, creates
 * new ones from a template through the tour editor's own createActivity(), and reports which tours
 * offer which package. Staff RLS already grants read+write on activities and their children. */

export interface PhotographyPackageRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  group: PhotographyGroup;
  durationMinutes: number | null;
  /** The private option's base price (EUR) — the "from" price — or null when unpriced. */
  baseEur: number | null;
  included: number | null;
  extraEur: number | null;
  maxGuests: number | null;
  shootsPerDay: number | null;
  addOns: { name: string; priceEur: number }[];
  /** The card's cover: the owner-picked `extra.photographyCover`, else the gallery's lead image. */
  coverUrl: string | null;
  bestSeller: boolean;
}

export interface PairedTourRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  addOns: string[];
}

export interface PhotographyAdminData {
  categoryExists: boolean;
  packages: PhotographyPackageRow[];
  pairedTours: PairedTourRow[];
}

export async function loadPhotographyAdmin(): Promise<PhotographyAdminData> {
  const sb = getBrowserSupabase();
  const [cats, acts] = await Promise.all([
    sb.from('categories').select('name'),
    sb
      .from('activities')
      .select(
        'id, slug, title, status, category, summary, duration_minutes, daily_capacity, extra, activity_images(url, position)',
      )
      .order('sort')
      .returns<
        Array<{
          id: string;
          slug: string;
          title: string;
          status: string;
          category: string | null;
          summary: string | null;
          duration_minutes: number | null;
          daily_capacity: number | null;
          extra: unknown;
          activity_images: { url: string; position: number }[] | null;
        }>
      >(),
  ]);
  if (cats.error) throw cats.error;
  if (acts.error) throw acts.error;
  const rows = acts.data ?? [];
  const pkgRows = rows.filter((a) => isPhotographyCategory(a.category as string));
  const ids = pkgRows.map((a) => a.id as string);

  const [opts, sups] = ids.length
    ? await Promise.all([
        sb
          .from('activity_options')
          .select(
            'activity_id, status, private_base_minor, private_included, private_extra_minor, private_max_guests, position',
          )
          .in('activity_id', ids)
          .order('position'),
        sb
          .from('activity_supplements')
          .select('activity_id, name, price_minor, position')
          .in('activity_id', ids)
          .order('position'),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (opts.error) throw opts.error;
  if (sups.error) throw sups.error;

  const packages: PhotographyPackageRow[] = pkgRows.map((a) => {
    const opt = (opts.data ?? []).find((o) => o.activity_id === a.id && o.status !== 'archived');
    const images = ((a.activity_images ?? []) as { url: string; position: number }[])
      .slice()
      .sort((x, y) => x.position - y.position);
    return {
      id: a.id as string,
      slug: a.slug as string,
      title: a.title as string,
      status: a.status as string,
      group: photographyGroup(
        { title: a.title as string, summary: (a.summary as string | null) ?? null },
        savedPhotographyGroup(a.extra),
      ),
      durationMinutes: (a.duration_minutes as number | null) ?? null,
      baseEur: opt?.private_base_minor != null ? opt.private_base_minor / 100 : null,
      included: opt?.private_included ?? null,
      extraEur: opt?.private_extra_minor != null ? opt.private_extra_minor / 100 : null,
      maxGuests: opt?.private_max_guests ?? null,
      shootsPerDay: (a.daily_capacity as number | null) ?? null,
      addOns: (sups.data ?? [])
        .filter((s) => s.activity_id === a.id)
        .map((s) => ({ name: s.name as string, priceEur: (s.price_minor as number) / 100 })),
      coverUrl: photographyCover(a.extra) ?? images[0]?.url ?? null,
      bestSeller: photographySpecs(a.extra).bestSeller,
    };
  });

  const pairedTours: PairedTourRow[] = rows
    .filter((a) => !isPhotographyCategory(a.category as string))
    .map((a) => ({
      id: a.id as string,
      slug: a.slug as string,
      title: a.title as string,
      status: a.status as string,
      addOns: photographyAddOnSlugs(a.extra),
    }))
    .filter((a) => a.addOns.length > 0);

  return {
    categoryExists: (cats.data ?? []).some((c) => isPhotographyCategory(c.name as string)),
    packages,
    pairedTours,
  };
}

export async function ensurePhotographyCategory(): Promise<void> {
  await createCategory({ name: PHOTOGRAPHY_CATEGORY, imageUrl: null, status: 'active' });
}

/** What the "New package" template asks for. */
export interface PhotographyPackageInput {
  title: string;
  kind: PhotographyGroup;
  summary: string;
  durationHours: number;
  /** Price of the shoot for the first `included` guests. */
  baseEur: number;
  included: number;
  /** Price per guest beyond `included`. 0 = extra guests are free. */
  extraEur: number;
  maxGuests: number;
  /** How many of this shoot the team can do on one day (the date picker's capacity). */
  shootsPerDay: number;
  minAdvanceDays: number;
  features: string[];
  /** `id` = an existing supplement row, updated IN PLACE on edit so the booking_supplements that
   *  reference it keep their link; absent = a new add-on. */
  addOns: { id?: string; name: string; nameFr: string; priceEur: number }[];
  imageUrl: string;
  status: 'draft' | 'published';
  /** The owner's pick for the price-card badge — only one package should have it. */
  bestSeller: boolean;
  /** Edited photos included (0 = hide the tick). */
  photoCount: number;
  /** Price-card spec lines as written by the owner ('' = hidden). */
  locationLine: string;
  deliveryLine: string;
  /** Price-card tick visibility. All default to shown. */
  showDuration: boolean;
  showGuests: boolean;
  showAddOns: boolean;
  showDeposit: boolean;
  /** "Package details" collapsible visibility. Defaults to shown. */
  showDetails: boolean;
  /** Hand-picked inspiration photo ids, in display order. Empty = the tag fallback. */
  inspiration: string[];
}

/**
 * The tour-editor form values for a new package. Pure, so it's unit-tested: one PRIVATE option
 * (base covers N guests + a price per extra guest, capped) is what gives the widget its party
 * stepper, and each add-on becomes a supplement row — the one table api_book prices add-ons from.
 */
export function photographyPackageValues(input: PhotographyPackageInput): ActivityFormValues {
  const title = input.title.trim();
  const features = input.features.map((f) => f.trim()).filter(Boolean);
  return {
    ...EMPTY_ACTIVITY,
    slug: slugify(title),
    title,
    category: PHOTOGRAPHY_CATEGORY,
    location: 'Mauritius',
    summary: input.summary.trim(),
    description: input.summary.trim(),
    durationMinutes: Math.max(15, Math.round(input.durationHours * 60)),
    minAdvanceDays: Math.max(0, Math.round(input.minAdvanceDays)),
    meetingPoint: 'At your hotel, villa or chosen location in Mauritius',
    pickupAvailable: false,
    isPrivate: true,
    pricingMode: 'per_person',
    // Must match what the platform enforces: set_photography_deposit charges 50% up front, and
    // api_mark_refunded keeps a genuine partial deposit on cancellation — so the terms say exactly
    // that, never "free cancellation".
    cancellationPolicy:
      'A 50% deposit books your date and is non-refundable. The balance is paid when your photos are delivered.',
    ...packageSeo(title, input.summary),
    status: input.status,
    languages: ['English', 'French'],
    highlights: features,
    inclusions: features,
    images: input.imageUrl.trim() ? [{ url: input.imageUrl.trim(), alt: title }] : [],
    options: [
      {
        name: input.kind === 'weddings' ? 'Wedding coverage' : 'Private shoot',
        durationMinutes: null,
        startWindow: '',
        isPrivateOption: true,
        privateBaseEur: input.baseEur,
        privateIncluded: Math.max(1, Math.round(input.included)),
        privateExtraEur: Math.max(0, input.extraEur),
        privateMaxGuests: Math.max(Math.round(input.included), Math.round(input.maxGuests)),
        prices: [],
      },
    ],
    photographyGroup: input.kind,
    photographyBestSeller: input.bestSeller,
    photographyPhotoCount: input.photoCount > 0 ? Math.round(input.photoCount) : null,
    photographyLocation: input.locationLine.trim(),
    photographyDelivery: input.deliveryLine.trim(),
    photographyShowDuration: input.showDuration,
    photographyShowGuests: input.showGuests,
    photographyShowAddOns: input.showAddOns,
    photographyShowDeposit: input.showDeposit,
    photographyShowDetails: input.showDetails,
    photographyInspiration: [...input.inspiration],
    photographyCover: input.imageUrl.trim(),
    supplements: input.addOns
      .filter((a) => a.name.trim() && a.priceEur >= 0)
      .map((a) => ({ name: a.name.trim(), nameFr: a.nameFr.trim(), priceEur: a.priceEur })),
  };
}

/** Default search appearance for a package: "<title> — Photographer in Mauritius" when it fits
 *  Google's ~60-character title budget, and the summary plus the search term as the description.
 *  Empty means the page's built-in fallback. Pure, so it's unit-tested. */
export function packageSeo(title: string, summary: string) {
  const t = `${title.trim()} — Photographer in Mauritius`;
  const base = summary.trim().replace(/\s+/g, ' ');
  const d = base
    ? `${base.replace(/[.!]?$/, '.')} Book online with a local photographer in Mauritius.`
    : '';
  return { seoTitle: t.length <= 60 ? t : '', seoDescription: d.length <= 160 ? d : '' };
}

/** Create the package, then give it its per-day capacity — which also materialises its dates, so a
 *  published package is bookable the moment this returns. Returns the new activity id. */
export async function createPhotographyPackage(input: PhotographyPackageInput): Promise<string> {
  const id = await createActivity(photographyPackageValues(input));
  await setDailyCapacity(id, Math.max(1, Math.round(input.shootsPerDay)));
  return id;
}

/* ---------------------------------------------------------------------------------------------
 * Page photos (photography_photos). Staff RLS grants insert/update/delete; the public reads them.
 * ------------------------------------------------------------------------------------------- */

export async function loadPhotographyPhotos(): Promise<PhotographyPhoto[]> {
  const { data, error } = await getBrowserSupabase()
    .from('photography_photos')
    .select('id, slot, url, alt, tags, position, media_type, poster_url')
    .order('position')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(toPhotographyPhoto).filter((p): p is PhotographyPhoto => p !== null);
}

/** Upload a file to the public activity-images bucket (under photography/) and return its URL. */
export function uploadPhotographyPhoto(file: File): Promise<string> {
  return uploadActivityImage(file, 'photography');
}

/** Upload a customer-gallery file under galleries/<booking-ref>/ and return its public URL. */
export function uploadGalleryPhoto(file: File, ref: string): Promise<string> {
  return uploadActivityImage(file, `gallery-${ref}`);
}

/** Add a photo at the END of its slot. For a single-photo slot pass `replace` to swap the current
 *  one out — the page shows the first photo of a slot, so leftovers would just be dead rows. */
export async function addPhotographyPhoto(
  slot: PhotoSlot,
  input: {
    url: string;
    alt?: string | null;
    tags?: GalleryTag[];
    /** 'video' only in the gallery slot. */
    mediaType?: PhotoMediaType;
    posterUrl?: string | null;
  },
  opts: { replace?: boolean } = {},
): Promise<void> {
  const sb = getBrowserSupabase();
  if (opts.replace) {
    const { error } = await sb.from('photography_photos').delete().eq('slot', slot);
    if (error) throw error;
  }
  const { data: last, error: lastErr } = await sb
    .from('photography_photos')
    .select('position')
    .eq('slot', slot)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw lastErr;
  const { error } = await sb.from('photography_photos').insert({
    slot,
    url: input.url.trim(),
    alt: input.alt?.trim() || null,
    tags: input.tags ?? [],
    position: ((last?.position as number | undefined) ?? -1) + 1,
    media_type: slot === 'gallery' && input.mediaType === 'video' ? 'video' : 'image',
    poster_url: input.posterUrl?.trim() || null,
  });
  if (error) throw error;
}

export async function updatePhotographyPhoto(
  id: string,
  patch: {
    alt?: string | null;
    tags?: GalleryTag[];
    posterUrl?: string | null;
    url?: string;
    mediaType?: PhotoMediaType;
  },
): Promise<void> {
  const row: {
    alt?: string | null;
    tags?: GalleryTag[];
    poster_url?: string | null;
    url?: string;
    media_type?: PhotoMediaType;
  } = {};
  if (patch.url !== undefined) {
    const url = patch.url.trim();
    if (!/^(https?:\/\/|\/(?!\/))/.test(url))
      throw new Error('Enter an image or video URL starting with https:// or /.');
    row.url = url;
  }
  if (patch.mediaType !== undefined) row.media_type = patch.mediaType;
  if ('alt' in patch) row.alt = patch.alt?.trim() || null;
  if (patch.tags) row.tags = patch.tags;
  if ('posterUrl' in patch) row.poster_url = patch.posterUrl?.trim() || null;
  const { error } = await getBrowserSupabase().from('photography_photos').update(row).eq('id', id);
  if (error) throw error;
}

/** Import the sample set once, in one insert, without overwriting an existing gallery. */
export async function importPhotographyGallery(): Promise<void> {
  const sb = getBrowserSupabase();
  const { data, error: readError } = await sb
    .from('photography_photos')
    .select('id')
    .eq('slot', 'gallery')
    .limit(1);
  if (readError) throw readError;
  if (data?.length) return;
  const { error } = await sb.from('photography_photos').insert(
    PHOTOGRAPHY_GALLERY_DEFAULTS.map((photo, position) => ({
      slot: 'gallery',
      url: PHOTO_STOCK[photo.key],
      alt: photo.alt,
      tags: photo.tags,
      position,
      media_type: 'image',
      poster_url: null,
    })),
  );
  if (error) throw error;
}

export async function deletePhotographyPhoto(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('photography_photos').delete().eq('id', id);
  if (error) throw error;
}

/** Re-number a slot in the given order (0, 1, 2…). */
export async function reorderPhotographyPhotos(orderedIds: string[]): Promise<void> {
  const sb = getBrowserSupabase();
  for (const [position, id] of orderedIds.entries()) {
    const { error } = await sb.from('photography_photos').update({ position }).eq('id', id);
    if (error) throw error;
  }
}

/* ---------------------------------------------------------------------------------------------
 * Balances to collect. A photography booking is paid 50% up front (set_photography_deposit,
 * 20261010000000); the rest is due when the photos are delivered. Staff RLS reads bookings.
 * ------------------------------------------------------------------------------------------- */

export interface PhotoBalanceRow {
  ref: string;
  customerName: string;
  customerEmail: string;
  packageTitle: string;
  shootDate: string | null;
  totalEur: number;
  depositEur: number;
  balanceDueEur: number;
}

/** Confirmed photography bookings that still owe their balance, shoot date first. */
export async function loadPhotoBalances(): Promise<PhotoBalanceRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from('booking_items')
    .select(
      'booking_id, bookings!inner(ref, status, customer_name, customer_email, total_minor, deposit_minor, balance_due_minor), activity_options!inner(activities!inner(title, category)), session_occurrences(starts_at)' as never,
    )
    .eq('activity_options.activities.category' as never, PHOTOGRAPHY_CATEGORY as never)
    .eq('bookings.status' as never, 'confirmed' as never);
  if (error) throw error;
  type Item = {
    booking_id: string;
    bookings: {
      ref: string;
      customer_name: string;
      customer_email: string;
      total_minor: number;
      deposit_minor: number | null;
      balance_due_minor: number | null;
    };
    activity_options: { activities: { title: string } };
    session_occurrences: { starts_at: string } | null;
  };
  const seen = new Set<string>();
  const rows: PhotoBalanceRow[] = [];
  for (const it of (data ?? []) as unknown as Item[]) {
    if (seen.has(it.booking_id)) continue;
    seen.add(it.booking_id);
    const b = it.bookings;
    const deposit = Number(b.deposit_minor ?? 0);
    const balance = Number(b.balance_due_minor ?? 0);
    if (!(deposit > 0 && deposit < Number(b.total_minor)) || balance <= 0) continue;
    rows.push({
      ref: b.ref,
      customerName: b.customer_name,
      customerEmail: b.customer_email,
      packageTitle: it.activity_options?.activities?.title ?? '',
      shootDate: it.session_occurrences?.starts_at ?? null,
      totalEur: Number(b.total_minor) / 100,
      depositEur: deposit / 100,
      balanceDueEur: balance / 100,
    });
  }
  return rows.sort((a, b) => (a.shootDate ?? '').localeCompare(b.shootDate ?? ''));
}

/** "Photos delivered — request balance": emails the guest a link to their booking page. */
export async function requestPhotoBalance(ref: string): Promise<{ url: string; emailed: boolean }> {
  const { data: auth } = await getBrowserSupabase().auth.getSession();
  const token = auth.session?.access_token;
  const res = await fetch(`/api/v1/admin/bookings/${encodeURIComponent(ref)}/photo-balance`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({}),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: { url?: string; emailed?: boolean };
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.ok || !body.data?.url) {
    throw new Error(body?.error?.message ?? 'Could not request the balance.');
  }
  return { url: body.data.url, emailed: Boolean(body.data.emailed) };
}

/* ---------------------------------------------------------------------------------------------
 * Editing an existing package, and importing the six examples.
 * ------------------------------------------------------------------------------------------- */

/** The package's private option — the one the form edits (price for N guests, extra guest, max). */
function privateOptionIndex(v: ActivityFormValues): number {
  const live = v.options.findIndex((o) => o.isPrivateOption && o.status !== 'archived');
  return live >= 0 ? live : v.options.findIndex((o) => o.isPrivateOption);
}

/** The simple form's view of a saved package. Pure, so it's unit-tested. */
export function packageInputFromValues(
  v: ActivityFormValues,
  shootsPerDay: number | null,
): PhotographyPackageInput {
  const opt = v.options[privateOptionIndex(v)];
  const specs = photographySpecs(v.sourceExtra);
  return {
    title: v.title,
    kind: v.photographyGroup || photographyGroup({ title: v.title, summary: v.summary }),
    summary: v.summary,
    durationHours: v.durationMinutes ? Math.round((v.durationMinutes / 60) * 100) / 100 : 1,
    baseEur: opt?.privateBaseEur ?? 0,
    included: opt?.privateIncluded ?? 2,
    extraEur: opt?.privateExtraEur ?? 0,
    maxGuests: opt?.privateMaxGuests ?? opt?.privateIncluded ?? 2,
    shootsPerDay: shootsPerDay ?? 1,
    minAdvanceDays: v.minAdvanceDays,
    features: v.inclusions.length ? [...v.inclusions] : [...v.highlights],
    addOns: v.supplements.map((s) => ({
      id: s.id,
      name: s.name,
      nameFr: s.nameFr,
      priceEur: s.priceEur ?? 0,
    })),
    imageUrl: photographyCover(v.sourceExtra) ?? v.images[0]?.url ?? '',
    status: v.status,
    bestSeller: specs.bestSeller,
    photoCount: specs.photoCount ?? 0,
    locationLine: specs.location ?? '',
    deliveryLine: specs.delivery ?? '',
    showDuration: specs.showDuration,
    showGuests: specs.showGuests,
    showAddOns: specs.showAddOns,
    showDeposit: specs.showDeposit,
    showDetails: specs.showDetails,
    inspiration: photographyInspirationIds(v.sourceExtra),
  };
}

/**
 * Apply the simple form's edits onto the full saved package, touching ONLY what the form shows. The
 * slug, description, photos after the first, itinerary, French, badges, other options — everything
 * edited in the full tour editor — is carried through unchanged. Pure, so it's unit-tested.
 */
export function applyPackageInput(
  v: ActivityFormValues,
  input: PhotographyPackageInput,
): ActivityFormValues {
  const title = input.title.trim();
  const summary = input.summary.trim();
  const features = input.features.map((f) => f.trim()).filter(Boolean);
  const included = Math.max(1, Math.round(input.included));
  const privateFields: Partial<OptionInput> = {
    isPrivateOption: true,
    privateBaseEur: input.baseEur,
    privateIncluded: included,
    privateExtraEur: Math.max(0, input.extraEur),
    privateMaxGuests: Math.max(included, Math.round(input.maxGuests)),
    prices: [],
  };
  const idx = privateOptionIndex(v);
  const options =
    idx >= 0
      ? v.options.map((o, i) => (i === idx ? { ...o, ...privateFields } : o))
      : [
          ...v.options,
          {
            name: input.kind === 'weddings' ? 'Wedding coverage' : 'Private shoot',
            durationMinutes: null,
            startWindow: '',
            ...privateFields,
          } as OptionInput,
        ];
  const cover = input.imageUrl.trim();
  const images = cover
    ? v.images[0]?.url === cover
      ? v.images
      : [{ url: cover, alt: v.images[0]?.alt || title }, ...v.images.slice(1)]
    : v.images.slice(1);
  // Highlights follow the "What's included" list only while they were the same list (the template
  // writes both); highlights the owner curated separately in the tour editor are left alone.
  const sameLists = v.highlights.join('\n') === v.inclusions.join('\n');
  return {
    ...v,
    title,
    summary,
    // The description is the summary until the owner writes a longer one in the tour editor.
    description:
      !v.description.trim() || v.description.trim() === v.summary.trim() ? summary : v.description,
    durationMinutes: Math.max(15, Math.round(input.durationHours * 60)),
    minAdvanceDays: Math.max(0, Math.round(input.minAdvanceDays)),
    status: input.status,
    photographyGroup: input.kind,
    photographyBestSeller: input.bestSeller,
    photographyPhotoCount: input.photoCount > 0 ? Math.round(input.photoCount) : null,
    photographyLocation: input.locationLine.trim(),
    photographyDelivery: input.deliveryLine.trim(),
    photographyShowDuration: input.showDuration,
    photographyShowGuests: input.showGuests,
    photographyShowAddOns: input.showAddOns,
    photographyShowDeposit: input.showDeposit,
    photographyShowDetails: input.showDetails,
    photographyInspiration: [...input.inspiration],
    photographyCover: input.imageUrl.trim(),
    inclusions: features,
    highlights: sameLists ? features : v.highlights,
    images,
    options,
    supplements: input.addOns
      .filter((a) => a.name.trim() && a.priceEur >= 0)
      .map((a) => ({
        ...(a.id ? { id: a.id } : {}),
        name: a.name.trim(),
        nameFr: a.nameFr.trim(),
        priceEur: a.priceEur,
      })),
  };
}

export interface LoadedPackage {
  values: ActivityFormValues;
  input: PhotographyPackageInput;
  shootsPerDay: number | null;
}

export async function loadPhotographyPackage(id: string): Promise<LoadedPackage> {
  const [values, availability] = await Promise.all([
    loadActivityForEdit(id),
    loadAvailabilityState(id),
  ]);
  if (!values) throw new Error('Package not found.');
  if (!isPhotographyCategory(values.category)) {
    throw new Error('This is not a photography package — edit it in Tours instead.');
  }
  return {
    values,
    input: packageInputFromValues(values, availability.capacity),
    shootsPerDay: availability.capacity,
  };
}

/** Save the simple form's edits in place (the tour editor's own update path — options and add-ons
 *  are reconciled by id, never recreated), then the shoots-per-day capacity if it changed. */
export async function savePhotographyPackage(
  id: string,
  loaded: LoadedPackage,
  input: PhotographyPackageInput,
): Promise<void> {
  await updateActivity(id, applyPackageInput(loaded.values, input));
  const perDay = Math.max(1, Math.round(input.shootsPerDay));
  if (perDay !== loaded.shootsPerDay) await setDailyCapacity(id, perDay);
}

/** The form input for one of the six examples. */
export function starterPackageInput(
  key: string,
  status: PhotographyPackageInput['status'] = 'draft',
): PhotographyPackageInput {
  const p = PHOTOGRAPHY_STARTER_PACKAGES.find((s) => s.key === key);
  if (!p) throw new Error(`Unknown example package: ${key}`);
  return {
    title: p.title,
    kind: p.kind,
    summary: p.summary,
    durationHours: p.durationHours,
    baseEur: p.baseEur,
    included: p.included,
    extraEur: p.extraEur,
    maxGuests: p.maxGuests,
    shootsPerDay: p.shootsPerDay,
    minAdvanceDays: p.minAdvanceDays,
    features: [...p.features],
    addOns: PHOTOGRAPHY_ADD_ON_PRESETS.map((a) => ({ ...a })),
    imageUrl: p.image,
    status,
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
}

/**
 * Turn the six example cards into real packages — as DRAFTS, so nothing becomes bookable at a price
 * the owner has not reviewed. Skips any whose slug already exists (re-running is safe). Returns how
 * many were created.
 */
export async function importStarterPackages(): Promise<number> {
  const slugs = PHOTOGRAPHY_STARTER_PACKAGES.map((p) => slugify(p.title));
  const { data, error } = await getBrowserSupabase()
    .from('activities')
    .select('slug')
    .in('slug', slugs);
  if (error) throw error;
  const existing = new Set((data ?? []).map((r) => r.slug as string));
  let created = 0;
  for (const p of PHOTOGRAPHY_STARTER_PACKAGES) {
    if (existing.has(slugify(p.title))) continue;
    await createPhotographyPackage(starterPackageInput(p.key, 'draft'));
    created += 1;
  }
  return created;
}

/* ---------------------------------------------------------------------------------------------
 * Customer galleries. One gallery per photography booking: the studio uploads the finished
 * photos here, then "Send gallery link" emails the guest their private gallery
 * (/bookings/:ref#gallery). Reads/writes go through the browser client — staff RLS on
 * booking_photos admits them; only the send goes through a staff-gated API route.
 * ------------------------------------------------------------------------------------------- */

export interface CustomerGalleryRow {
  bookingId: string;
  ref: string;
  customerName: string;
  customerEmail: string;
  packageTitle: string;
  shootDate: string | null;
  photoCount: number;
  /** The gallery thumbnails, oldest first. Loaded per booking on expand. */
  photos?: { id: string; url: string }[];
}

/** Confirmed photography bookings with their gallery photo counts, shoot date first. */
export async function loadCustomerGalleries(): Promise<CustomerGalleryRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from('booking_items')
    .select(
      'booking_id, bookings!inner(id, ref, status, customer_name, customer_email), activity_options!inner(activities!inner(title, category)), session_occurrences(starts_at)' as never,
    )
    .eq('activity_options.activities.category' as never, PHOTOGRAPHY_CATEGORY as never)
    .eq('bookings.status' as never, 'confirmed' as never);
  if (error) throw error;
  type Item = {
    booking_id: string;
    bookings: { id: string; ref: string; customer_name: string; customer_email: string };
    activity_options: { activities: { title: string } };
    session_occurrences: { starts_at: string } | null;
  };
  const seen = new Map<string, CustomerGalleryRow>();
  for (const it of (data ?? []) as unknown as Item[]) {
    if (seen.has(it.booking_id)) continue;
    seen.set(it.booking_id, {
      bookingId: it.booking_id,
      ref: it.bookings.ref,
      customerName: it.bookings.customer_name,
      customerEmail: it.bookings.customer_email,
      packageTitle: it.activity_options?.activities?.title ?? '',
      shootDate: it.session_occurrences?.starts_at ?? null,
      photoCount: 0,
    });
  }
  const rows = [...seen.values()];
  if (!rows.length) return rows;
  let counts: Map<string, number>;
  try {
    const { data: photos, error: photosError } = await getBrowserSupabase()
      .from('booking_photos')
      .select('booking_id')
      .in(
        'booking_id',
        rows.map((r) => r.bookingId),
      );
    if (photosError) throw photosError;
    counts = new Map<string, number>();
    for (const p of (photos ?? []) as unknown as { booking_id: string }[]) {
      counts.set(p.booking_id, (counts.get(p.booking_id) ?? 0) + 1);
    }
  } catch (err) {
    // The gallery migration hasn't been applied to this database yet (catch-up.sql) — say so
    // plainly instead of "Could not load galleries".
    throw new Error(
      'Gallery storage is not set up yet (booking_photos is missing) — run supabase/catch-up.sql on the database, then reload.',
      { cause: err },
    );
  }
  for (const r of rows) r.photoCount = counts.get(r.bookingId) ?? 0;
  return rows.sort((a, b) => (a.shootDate ?? '').localeCompare(b.shootDate ?? ''));
}

/** One booking's gallery photos, oldest first. */
export async function loadGalleryPhotos(bookingId: string): Promise<{ id: string; url: string }[]> {
  const { data, error } = await getBrowserSupabase()
    .from('booking_photos')
    .select('id, url')
    .eq('booking_id', bookingId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; url: string }[]).map((p) => ({
    id: p.id,
    url: p.url,
  }));
}

/** Upload files for a booking and append them to its gallery, in order. */
export async function addGalleryPhotos(
  ref: string,
  bookingId: string,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const sb = getBrowserSupabase();
  const { data: existing, error: countError } = await sb
    .from('booking_photos')
    .select('id')
    .eq('booking_id', bookingId);
  if (countError) throw countError;
  let position = (existing ?? []).length;
  let done = 0;
  for (const file of files) {
    const url = await uploadGalleryPhoto(file, ref);
    position += 1;
    const { error } = await sb.from('booking_photos').insert({
      booking_id: bookingId,
      url,
      position,
    } as never);
    if (error) throw error;
    done += 1;
    onProgress?.(done, files.length);
  }
}

/** Remove one photo from a booking's gallery. */
export async function removeGalleryPhoto(photoId: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('booking_photos').delete().eq('id', photoId);
  if (error) throw error;
}

/** "Send gallery link": emails the guest their private gallery URL. */
export async function sendGalleryLink(
  ref: string,
): Promise<{ url: string; emailed: boolean; photoCount: number }> {
  const { data: auth } = await getBrowserSupabase().auth.getSession();
  const token = auth.session?.access_token;
  const res = await fetch(`/api/v1/admin/bookings/${encodeURIComponent(ref)}/gallery/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({}),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: { url?: string; emailed?: boolean; photoCount?: number };
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.ok || !body.data?.url) {
    throw new Error(body?.error?.message ?? 'Could not send the gallery link.');
  }
  return {
    url: body.data.url,
    emailed: Boolean(body.data.emailed),
    photoCount: Number(body.data.photoCount ?? 0),
  };
}
