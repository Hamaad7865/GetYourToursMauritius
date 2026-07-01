import { getBrowserSupabase } from '@/lib/supabase/browser';
import { normalizeBadges, type BadgeInput } from '@/lib/catalogue/badges';
import type { PricingMode } from '@/lib/validation/tours';

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
  /** Age band (GetYourGuide-style party selector). Null on a normal, non-age tier. */
  minAge?: number | null;
  maxAge?: number | null;
}
export interface OptionInput {
  /** Present for options loaded from an existing activity; absent for newly-added ones. Used to
   *  reconcile options in place on edit so a booked option keeps its identity. */
  id?: string;
  name: string;
  prices: PriceInput[];
}
export interface ItineraryStopInput {
  title: string;
  area: string;
  description: string;
  tags: string[];
  /** Alternatives the customer can pick instead of this stop. */
  options: { title: string; area: string }[];
}

export interface ActivityFormValues {
  slug: string;
  type: 'activity' | 'transport';
  title: string;
  category: string;
  location: string;
  durationMinutes: number | null;
  /** Minimum advance booking (lead time) in days. 1 = "tomorrow earliest" (the default); higher for
   *  planning-heavy trips. Enforced server-side in create_hold + api_list_availability. */
  minAdvanceDays: number;
  summary: string;
  description: string;
  meetingPoint: string;
  pickupAvailable: boolean;
  /** Home/boarding region (North/South/East/West/Central), or '' to auto-derive from coords. Drives the
   *  region-based transport add-on for per_person / per_group activities with pickup. */
  region: string;
  /** per_person (× people), per_group (× ceil(people/size)), or vehicle (one flat price for the
   *  vehicle that fits the party — a tier's max_guests is the vehicle's capacity). */
  pricingMode: PricingMode;
  cancellationPolicy: string;
  status: 'draft' | 'published';
  languages: string[];
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  images: ImageInput[];
  options: OptionInput[];
  itinerary: ItineraryStopInput[];
  badges: BadgeInput[];
}

export const EMPTY_ACTIVITY: ActivityFormValues = {
  slug: '',
  type: 'activity',
  title: '',
  category: 'Sightseeing tours',
  location: '',
  durationMinutes: null,
  minAdvanceDays: 1,
  summary: '',
  description: '',
  meetingPoint: '',
  pickupAvailable: false,
  region: '',
  pricingMode: 'per_person',
  cancellationPolicy: 'Free cancellation up to 24 hours before your activity for a full refund.',
  status: 'published',
  languages: ['English'],
  highlights: [],
  inclusions: [],
  exclusions: [],
  images: [],
  options: [],
  itinerary: [],
  badges: [],
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
    .map((s) => {
      const base = {
        title: s.title.trim(),
        area: s.area.trim() || null,
        description: s.description.trim() || null,
        tags: s.tags.filter((t) => t.trim()),
      };
      const options = s.options
        .filter((o) => o.title.trim())
        .map((o) => ({ title: o.title.trim(), area: o.area.trim() || null }));
      return options.length ? { ...base, options } : base;
    });
  const badges = normalizeBadges(v.badges);
  const out: Record<string, unknown> = {};
  if (itinerary.length) out.itinerary = itinerary;
  if (badges.length) out.badges = badges;
  return out;
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
    min_advance_days: Math.max(0, Math.round(v.minAdvanceDays || 0)),
    meeting_point: v.meetingPoint.trim() || null,
    pickup_available: v.pickupAvailable,
    region: v.region.trim() || null,
    pricing_mode: v.pricingMode,
    languages: v.languages.filter((l) => l.trim()),
    inclusions: v.inclusions.filter((l) => l.trim()),
    exclusions: v.exclusions.filter((l) => l.trim()),
    highlights: v.highlights.filter((l) => l.trim()),
    cancellation_policy: v.cancellationPolicy.trim() || null,
    status: v.status,
    extra: buildExtra(v) as never,
  };
}

/** Plan how form options map onto the existing option rows. Pure, so it's unit-tested. An option
 *  with an id matching an existing row is updated in place (keeps the identity bookings/occurrences
 *  reference); one without is new; an existing row absent from the form is a removal candidate. */
export function planOptionReconcile(
  existingIds: string[],
  formOptions: OptionInput[],
): { toUpsert: Array<{ option: OptionInput; position: number; isNew: boolean }>; removedIds: string[] } {
  const existing = new Set(existingIds);
  const kept = new Set<string>();
  const toUpsert = formOptions
    .filter((o) => o.name.trim())
    .map((option, position) => {
      const isExisting = Boolean(option.id && existing.has(option.id));
      if (isExisting) kept.add(option.id as string);
      return { option, position, isNew: !isExisting };
    });
  const removedIds = existingIds.filter((id) => !kept.has(id));
  return { toUpsert, removedIds };
}

/** Images have no downstream FK (booking_items snapshots, never references them) — replace wholesale. */
async function replaceImages(activityId: string, images: ImageInput[]): Promise<void> {
  const sb = getBrowserSupabase();
  await sb.from('activity_images').delete().eq('activity_id', activityId);
  const rows = images
    .filter((i) => i.url.trim())
    .map((img, position) => ({ activity_id: activityId, url: img.url.trim(), alt: img.alt.trim() || null, position }));
  if (rows.length) {
    const { error } = await sb.from('activity_images').insert(rows);
    if (error) throw error;
  }
}

/**
 * Prices aren't FK-referenced (booking_items snapshots label+amount), so a full replace is safe.
 * INSERT the new tiers BEFORE deleting the old ones: the browser client can't wrap this in a
 * transaction, so a delete-then-insert whose insert fails (constraint / transient error / the user
 * navigating away) would strand the option with ZERO price tiers — and create_booking then raises
 * unknown_price_tier for every customer who picks it. Insert-first means a failure leaves the
 * existing tiers intact.
 */
async function replacePrices(optionId: string, prices: PriceInput[]): Promise<void> {
  const sb = getBrowserSupabase();
  const { data: old, error: readErr } = await sb
    .from('activity_option_prices')
    .select('id')
    .eq('activity_option_id', optionId);
  if (readErr) throw readErr;

  const rows = prices
    .filter((p) => p.label.trim() && p.amountEur != null)
    .map((p, position) => ({
      activity_option_id: optionId,
      label: p.label.trim(),
      amount_minor: Math.round((p.amountEur ?? 0) * 100),
      max_guests: p.maxGuests,
      min_age: p.minAge ?? null,
      max_age: p.maxAge ?? null,
      position,
    }));
  if (rows.length) {
    const { error } = await sb.from('activity_option_prices').insert(rows);
    if (error) throw error;
  }
  const oldIds = (old ?? []).map((o) => o.id);
  if (oldIds.length) {
    const { error } = await sb.from('activity_option_prices').delete().in('id', oldIds);
    if (error) throw error;
  }
}

/**
 * Reconcile options IN PLACE rather than delete-and-recreate. Updating in place keeps each option's
 * id, which session_occurrences and booking_items reference — so editing a booked activity no longer
 * breaks it. A removed option is deleted only when nothing depends on it (no booking_items, no
 * occurrences); a booked option that staff removed is left intact (you can't un-sell a seat).
 */
async function reconcileOptions(activityId: string, formOptions: OptionInput[]): Promise<void> {
  const sb = getBrowserSupabase();
  // Throw on a failed read: a transient null here (e.g. a token-refresh 401) would make every form
  // option look new and duplicate the entire option set on save.
  const { data: existing, error: readErr } = await sb
    .from('activity_options')
    .select('id')
    .eq('activity_id', activityId);
  if (readErr) throw readErr;
  const { toUpsert, removedIds } = planOptionReconcile((existing ?? []).map((o) => o.id), formOptions);

  for (const { option, position, isNew } of toUpsert) {
    let optionId = option.id;
    if (isNew || !optionId) {
      const { data: opt, error } = await sb
        .from('activity_options')
        .insert({ activity_id: activityId, name: option.name.trim(), position })
        .select('id')
        .single();
      if (error) throw error;
      optionId = opt.id;
    } else {
      const { error } = await sb
        .from('activity_options')
        .update({ name: option.name.trim(), position })
        .eq('id', optionId);
      if (error) throw error;
    }
    await replacePrices(optionId, option.prices);
  }

  for (const optionId of removedIds) {
    const { count: items } = await sb
      .from('booking_items')
      .select('id', { count: 'exact', head: true })
      .eq('activity_option_id', optionId);
    const { count: occ } = await sb
      .from('session_occurrences')
      .select('id', { count: 'exact', head: true })
      .eq('activity_option_id', optionId);
    if ((items ?? 0) === 0 && (occ ?? 0) === 0) {
      const { error } = await sb.from('activity_options').delete().eq('id', optionId);
      if (error) throw error;
    }
    // else: keep it — an option with bookings/occurrences must not be deleted.
  }
}

/**
 * Roll the open-ended availability window forward for one activity. Idempotent and a no-op unless
 * the activity is published with a daily capacity and at least one price — so calling it after every
 * save means newly published / newly priced open-ended activities show bookable dates immediately,
 * rather than nothing until the next maintenance cron tick (which is disabled by default).
 */
async function materializeActivity(activityId: string): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('materialize_availability', {
    p: { activityId },
  });
  if (error) throw error;
}

/**
 * Per-group pricing needs a group size (the tier's max_guests) to compute ceil(people / size). The
 * server prices any per_group tier with a NULL max_guests per head, and the widget would show one flat
 * group rate — so EVERY priced tier must carry a cap, not just one (an uncapped cheapest tier silently
 * diverges the displayed total from the per-head charge). Reject at save time with a clear message.
 */
function assertPricingValid(v: ActivityFormValues): void {
  if (v.pricingMode !== 'per_group') return;
  const uncapped = v.options.some((o) =>
    o.prices.some((p) => p.label.trim() && p.amountEur != null && (p.maxGuests == null || p.maxGuests <= 0)),
  );
  if (uncapped) {
    throw new Error(
      'Per-group pricing needs a group size on every price tier: set a "max guests" value (the number of people one group price covers) for each tier.',
    );
  }
}

/** Create a new activity (+ images/options/prices). Returns the new id. */
export async function createActivity(v: ActivityFormValues): Promise<string> {
  assertPricingValid(v);
  const sb = getBrowserSupabase();
  const opId = await operatorId();
  const { data, error } = await sb.from('activities').insert(activityRow(v, opId)).select('id').single();
  if (error) throw error;
  await replaceImages(data.id, v.images);
  await reconcileOptions(data.id, v.options);
  await materializeActivity(data.id);
  return data.id;
}

/** Update an activity, reconciling its images/options/prices in place (FK-safe for booked activities). */
export async function updateActivity(id: string, v: ActivityFormValues): Promise<void> {
  assertPricingValid(v);
  const sb = getBrowserSupabase();
  const opId = await operatorId();
  const { error } = await sb.from('activities').update(activityRow(v, opId)).eq('id', id);
  if (error) throw error;
  await replaceImages(id, v.images);
  await reconcileOptions(id, v.options);
  // Publishing or adding the first price makes the activity materializable — fill its window now.
  await materializeActivity(id);
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
  itinerary?: Array<{
    title?: string;
    area?: string | null;
    description?: string | null;
    tags?: string[];
    options?: Array<{ title?: string; area?: string | null }>;
  }>;
  badges?: Array<{ icon?: string; title?: string; subtitle?: string }>;
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
        .select('activity_option_id, label, amount_minor, max_guests, min_age, max_age, position')
        .in('activity_option_id', optionIds)
        .order('position')
    : {
        data: [] as Array<{
          activity_option_id: string;
          label: string;
          amount_minor: number;
          max_guests: number | null;
          min_age: number | null;
          max_age: number | null;
        }>,
      };

  const extra = (act.extra ?? {}) as ExtraShape;

  return {
    slug: act.slug,
    type: act.type,
    title: act.title,
    category: act.category,
    location: act.location ?? '',
    durationMinutes: act.duration_minutes,
    minAdvanceDays: act.min_advance_days ?? 1,
    summary: act.summary ?? '',
    description: act.description ?? '',
    meetingPoint: act.meeting_point ?? '',
    pickupAvailable: act.pickup_available,
    region: act.region ?? '',
    pricingMode: (act.pricing_mode ?? 'per_person') as PricingMode,
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
        .map((p) => ({
          label: p.label,
          amountEur: p.amount_minor / 100,
          maxGuests: p.max_guests,
          minAge: p.min_age,
          maxAge: p.max_age,
        })),
    })),
    itinerary: (extra.itinerary ?? []).map((s) => ({
      title: s.title ?? '',
      area: s.area ?? '',
      description: s.description ?? '',
      tags: s.tags ?? [],
      options: (s.options ?? []).map((o) => ({ title: o.title ?? '', area: o.area ?? '' })),
    })),
    badges: (extra.badges ?? []).map((b) => ({ icon: b.icon ?? '', title: b.title ?? '', subtitle: b.subtitle ?? '' })),
  };
}
