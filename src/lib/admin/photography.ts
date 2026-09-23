import { getBrowserSupabase } from '@/lib/supabase/browser';
import {
  EMPTY_ACTIVITY,
  createActivity,
  slugify,
  uploadActivityImage,
  type ActivityFormValues,
} from '@/lib/admin/activity-write';
import { setDailyCapacity } from '@/lib/admin/availability-write';
import { createCategory } from '@/lib/admin/categories';
import {
  PHOTOGRAPHY_CATEGORY,
  isPhotographyCategory,
  photographyAddOnSlugs,
  photographyGroup,
  savedPhotographyGroup,
  toPhotographyPhoto,
  type GalleryTag,
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
      .select('id, slug, title, status, category, summary, duration_minutes, daily_capacity, extra')
      .order('sort'),
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
  addOns: { name: string; nameFr: string; priceEur: number }[];
  imageUrl: string;
  status: 'draft' | 'published';
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
    .select('id, slot, url, alt, tags, position')
    .order('position')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(toPhotographyPhoto).filter((p): p is PhotographyPhoto => p !== null);
}

/** Upload a file to the public activity-images bucket (under photography/) and return its URL. */
export function uploadPhotographyPhoto(file: File): Promise<string> {
  return uploadActivityImage(file, 'photography');
}

/** Add a photo at the END of its slot. For a single-photo slot pass `replace` to swap the current
 *  one out — the page shows the first photo of a slot, so leftovers would just be dead rows. */
export async function addPhotographyPhoto(
  slot: PhotoSlot,
  input: { url: string; alt?: string | null; tags?: GalleryTag[] },
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
  });
  if (error) throw error;
}

export async function updatePhotographyPhoto(
  id: string,
  patch: { alt?: string | null; tags?: GalleryTag[] },
): Promise<void> {
  const row: { alt?: string | null; tags?: GalleryTag[] } = {};
  if ('alt' in patch) row.alt = patch.alt?.trim() || null;
  if (patch.tags) row.tags = patch.tags;
  const { error } = await getBrowserSupabase().from('photography_photos').update(row).eq('id', id);
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
