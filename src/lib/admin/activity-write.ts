import { getBrowserSupabase } from '@/lib/supabase/browser';

/* Client-side admin writes. RLS already grants staff/admin full read+write on activities and
 * their images/options/prices, so an authenticated admin performs these directly — no RPC. */

export interface ImageInput {
  url: string;
  alt: string;
}
export interface PriceInput {
  label: string;
  amountEur: number | null;
  maxGuests: number | null;
}
export interface OptionInput {
  /** Stable id of an existing option (absent for newly-added ones). Lets updateActivity diff
   *  options in place instead of recreating them — preserving materialised slots and holds. */
  id?: string;
  name: string;
  prices: PriceInput[];
}
export interface ItineraryStopInput {
  title: string;
  area: string;
  description: string;
  tags: string[];
}

export interface ActivityFormValues {
  slug: string;
  type: 'activity' | 'transport';
  title: string;
  category: string;
  location: string;
  durationMinutes: number | null;
  summary: string;
  description: string;
  meetingPoint: string;
  pickupAvailable: boolean;
  /** Island-tour pricing: charge per group (ceil(people / group size) × price) instead of per head. */
  groupPricing: boolean;
  cancellationPolicy: string;
  status: 'draft' | 'published';
  languages: string[];
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  images: ImageInput[];
  options: OptionInput[];
  itinerary: ItineraryStopInput[];
}

export const EMPTY_ACTIVITY: ActivityFormValues = {
  slug: '',
  type: 'activity',
  title: '',
  category: 'Island tours',
  location: '',
  durationMinutes: null,
  summary: '',
  description: '',
  meetingPoint: '',
  pickupAvailable: false,
  groupPricing: false,
  cancellationPolicy: 'Free cancellation up to 24 hours before your activity for a full refund.',
  status: 'published',
  languages: ['English'],
  highlights: [],
  inclusions: [],
  exclusions: [],
  images: [],
  options: [],
  itinerary: [],
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

async function operatorId(): Promise<string> {
  const { data, error } = await getBrowserSupabase()
    .from('operators')
    .select('id')
    .eq('slug', 'belle-mare-tours')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Operator "belle-mare-tours" not found — run the admin setup SQL first.');
  return data.id;
}

function buildExtra(v: ActivityFormValues) {
  const itinerary = v.itinerary
    .filter((s) => s.title.trim())
    .map((s) => ({
      title: s.title.trim(),
      area: s.area.trim() || null,
      description: s.description.trim() || null,
      tags: s.tags.filter((t) => t.trim()),
    }));
  return itinerary.length ? { itinerary } : {};
}

function activityRow(v: ActivityFormValues, opId: string) {
  return {
    operator_id: opId,
    slug: v.slug.trim(),
    type: v.type,
    title: v.title.trim(),
    summary: v.summary.trim() || null,
    description: v.description.trim() || null,
    category: v.category as never,
    location: v.location.trim() || null,
    duration_minutes: v.durationMinutes,
    meeting_point: v.meetingPoint.trim() || null,
    pickup_available: v.pickupAvailable,
    group_pricing: v.groupPricing,
    languages: v.languages.filter((l) => l.trim()),
    inclusions: v.inclusions.filter((l) => l.trim()),
    exclusions: v.exclusions.filter((l) => l.trim()),
    highlights: v.highlights.filter((l) => l.trim()),
    cancellation_policy: v.cancellationPolicy.trim() || null,
    status: v.status,
    extra: buildExtra(v) as never,
  };
}

type Sb = ReturnType<typeof getBrowserSupabase>;

function imageRows(activityId: string, v: ActivityFormValues) {
  return v.images
    .filter((i) => i.url.trim())
    .map((img, position) => ({ activity_id: activityId, url: img.url.trim(), alt: img.alt.trim() || null, position }));
}

function priceRows(optionId: string, prices: PriceInput[]) {
  return prices
    .filter((p) => p.label.trim() && p.amountEur != null)
    .map((p, position) => ({
      activity_option_id: optionId,
      label: p.label.trim(),
      amount_minor: Math.round((p.amountEur ?? 0) * 100),
      max_guests: p.maxGuests,
      position,
    }));
}

async function insertPrices(sb: Sb, optionId: string, prices: PriceInput[]): Promise<void> {
  const rows = priceRows(optionId, prices);
  if (!rows.length) return;
  const { error } = await sb.from('activity_option_prices').insert(rows);
  if (error) throw error;
}

/** Insert a brand-new option (+ its price tiers) and return its generated id. */
async function insertOption(
  sb: Sb,
  activityId: string,
  name: string,
  position: number,
  prices: PriceInput[],
): Promise<string> {
  const { data: opt, error } = await sb
    .from('activity_options')
    .insert({ activity_id: activityId, name, position })
    .select('id')
    .single();
  if (error) throw error;
  await insertPrices(sb, opt.id, prices);
  return opt.id;
}

async function writeChildren(activityId: string, v: ActivityFormValues): Promise<void> {
  const sb = getBrowserSupabase();
  const images = imageRows(activityId, v);
  if (images.length) {
    const { error } = await sb.from('activity_images').insert(images);
    if (error) throw error;
  }
  for (let i = 0; i < v.options.length; i += 1) {
    const option = v.options[i]!;
    if (!option.name.trim()) continue;
    await insertOption(sb, activityId, option.name.trim(), i, option.prices);
  }
}

/**
 * Reconcile an activity's options against the submitted form BY STABLE ID — never recreate.
 * Matched options are updated in place (same activity_option_id), so their materialised
 * availability slots, active holds and bookings all survive the edit; their price tiers are
 * replaced (activity_option_prices is the only ON DELETE CASCADE reference, so that's safe).
 * Genuinely-new options are inserted. Surplus options are deleted ONLY when no booking_items
 * reference them — booking_items.activity_option_id is ON DELETE RESTRICT, so deleting a booked
 * option would throw — mirroring the busy-check in stopAvailability.
 */
async function reconcileOptions(activityId: string, v: ActivityFormValues): Promise<void> {
  const sb = getBrowserSupabase();
  const { data: existing, error: exErr } = await sb
    .from('activity_options')
    .select('id')
    .eq('activity_id', activityId);
  if (exErr) throw exErr;
  const existingIds = new Set((existing ?? []).map((o) => o.id));
  const matched = new Set<string>();

  for (let i = 0; i < v.options.length; i += 1) {
    const opt = v.options[i]!;
    if (!opt.name.trim()) continue;
    const matchId = opt.id && existingIds.has(opt.id) ? opt.id : null;
    if (matchId) {
      matched.add(matchId);
      const { error } = await sb
        .from('activity_options')
        .update({ name: opt.name.trim(), position: i })
        .eq('id', matchId);
      if (error) throw error;
      // Reconcile price tiers (CASCADE-only reference): drop and re-insert.
      const { error: delErr } = await sb.from('activity_option_prices').delete().eq('activity_option_id', matchId);
      if (delErr) throw delErr;
      await insertPrices(sb, matchId, opt.prices);
    } else {
      await insertOption(sb, activityId, opt.name.trim(), i, opt.prices);
    }
  }

  const surplus = [...existingIds].filter((id) => !matched.has(id));
  if (surplus.length === 0) return;
  // Keep any surplus option still referenced by a booking (FK restrict); delete the rest.
  const { data: booked, error: bErr } = await sb
    .from('booking_items')
    .select('activity_option_id')
    .in('activity_option_id', surplus);
  if (bErr) throw bErr;
  const busy = new Set((booked ?? []).map((b) => b.activity_option_id));
  const deletable = surplus.filter((id) => !busy.has(id));
  if (deletable.length) {
    const { error } = await sb.from('activity_options').delete().in('id', deletable);
    if (error) throw error;
  }
}

/** Create a new activity (+ images/options/prices). Returns the new id. */
export async function createActivity(v: ActivityFormValues): Promise<string> {
  const sb = getBrowserSupabase();
  const opId = await operatorId();
  const { data, error } = await sb.from('activities').insert(activityRow(v, opId)).select('id').single();
  if (error) throw error;
  await writeChildren(data.id, v);
  return data.id;
}

/** Update an activity, reconciling its images and options in place. */
export async function updateActivity(id: string, v: ActivityFormValues): Promise<void> {
  const sb = getBrowserSupabase();
  const opId = await operatorId();
  const { error } = await sb.from('activities').update(activityRow(v, opId)).eq('id', id);
  if (error) throw error;

  // Images carry no downstream references — replace them, inserting the new set BEFORE dropping
  // the old so a mid-write failure never leaves the activity with no photos.
  const { data: oldImages } = await sb.from('activity_images').select('id').eq('activity_id', id);
  const images = imageRows(id, v);
  if (images.length) {
    const { error: imgErr } = await sb.from('activity_images').insert(images);
    if (imgErr) throw imgErr;
  }
  const oldImageIds = (oldImages ?? []).map((o) => o.id);
  if (oldImageIds.length) {
    const { error: delErr } = await sb.from('activity_images').delete().in('id', oldImageIds);
    if (delErr) throw delErr;
  }

  // Options are diffed by stable id (never recreated) so materialised slots + active holds survive.
  await reconcileOptions(id, v);
}

export async function deleteActivity(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('activities').delete().eq('id', id);
  if (error) throw error;
}

/** Upload an image file to Supabase Storage and return its public URL. */
export async function uploadActivityImage(file: File, slug: string): Promise<string> {
  const sb = getBrowserSupabase();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${slugify(slug) || 'activity'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from('activity-images').upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return sb.storage.from('activity-images').getPublicUrl(path).data.publicUrl;
}

interface ExtraShape {
  itinerary?: Array<{ title?: string; area?: string | null; description?: string | null; tags?: string[] }>;
}

/** Load an existing activity into the editable form shape. */
export async function loadActivityForEdit(id: string): Promise<ActivityFormValues | null> {
  const sb = getBrowserSupabase();
  const { data: act, error } = await sb.from('activities').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!act) return null;

  const { data: images } = await sb
    .from('activity_images')
    .select('url, alt, position')
    .eq('activity_id', id)
    .order('position');
  const { data: options } = await sb
    .from('activity_options')
    .select('id, name, position')
    .eq('activity_id', id)
    .order('position');
  const optionIds = (options ?? []).map((o) => o.id);
  const { data: prices } = optionIds.length
    ? await sb
        .from('activity_option_prices')
        .select('activity_option_id, label, amount_minor, max_guests, position')
        .in('activity_option_id', optionIds)
        .order('position')
    : { data: [] as Array<{ activity_option_id: string; label: string; amount_minor: number; max_guests: number | null }> };

  const extra = (act.extra ?? {}) as ExtraShape;

  return {
    slug: act.slug,
    type: act.type,
    title: act.title,
    category: act.category,
    location: act.location ?? '',
    durationMinutes: act.duration_minutes,
    summary: act.summary ?? '',
    description: act.description ?? '',
    meetingPoint: act.meeting_point ?? '',
    pickupAvailable: act.pickup_available,
    groupPricing: act.group_pricing ?? false,
    cancellationPolicy: act.cancellation_policy ?? '',
    status: act.status,
    languages: act.languages.length ? act.languages : ['English'],
    highlights: act.highlights,
    inclusions: act.inclusions,
    exclusions: act.exclusions,
    images: (images ?? []).map((i) => ({ url: i.url, alt: i.alt ?? '' })),
    options: (options ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      prices: (prices ?? [])
        .filter((p) => p.activity_option_id === o.id)
        .map((p) => ({ label: p.label, amountEur: p.amount_minor / 100, maxGuests: p.max_guests })),
    })),
    itinerary: (extra.itinerary ?? []).map((s) => ({
      title: s.title ?? '',
      area: s.area ?? '',
      description: s.description ?? '',
      tags: s.tags ?? [],
    })),
  };
}
