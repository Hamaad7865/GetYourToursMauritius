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
  category: 'Sightseeing tours',
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

async function writeChildren(activityId: string, v: ActivityFormValues): Promise<void> {
  const sb = getBrowserSupabase();

  const images = v.images
    .filter((i) => i.url.trim())
    .map((img, position) => ({ activity_id: activityId, url: img.url.trim(), alt: img.alt.trim() || null, position }));
  if (images.length) {
    const { error } = await sb.from('activity_images').insert(images);
    if (error) throw error;
  }

  for (let i = 0; i < v.options.length; i += 1) {
    const option = v.options[i]!;
    if (!option.name.trim()) continue;
    const { data: opt, error } = await sb
      .from('activity_options')
      .insert({ activity_id: activityId, name: option.name.trim(), position: i })
      .select('id')
      .single();
    if (error) throw error;
    const prices = option.prices
      .filter((p) => p.label.trim() && p.amountEur != null)
      .map((p, position) => ({
        activity_option_id: opt.id,
        label: p.label.trim(),
        amount_minor: Math.round((p.amountEur ?? 0) * 100),
        max_guests: p.maxGuests,
        position,
      }));
    if (prices.length) {
      const { error: priceErr } = await sb.from('activity_option_prices').insert(prices);
      if (priceErr) throw priceErr;
    }
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

/** Update an activity, replacing its images/options/prices. */
export async function updateActivity(id: string, v: ActivityFormValues): Promise<void> {
  const sb = getBrowserSupabase();
  const opId = await operatorId();
  const { error } = await sb.from('activities').update(activityRow(v, opId)).eq('id', id);
  if (error) throw error;
  // Write the NEW children first, then remove the OLD ones — so a mid-write failure leaves
  // the activity with (at worst) duplicate options, never an empty/unbookable one. (Options
  // cascade-delete their prices.)
  const { data: oldImages } = await sb.from('activity_images').select('id').eq('activity_id', id);
  const { data: oldOptions } = await sb.from('activity_options').select('id').eq('activity_id', id);
  await writeChildren(id, v);
  const oldImageIds = (oldImages ?? []).map((o) => o.id);
  const oldOptionIds = (oldOptions ?? []).map((o) => o.id);
  if (oldImageIds.length) await sb.from('activity_images').delete().in('id', oldImageIds);
  if (oldOptionIds.length) await sb.from('activity_options').delete().in('id', oldOptionIds);
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
