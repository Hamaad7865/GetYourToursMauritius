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
  /** Per-option time (Half day / Full day etc.) — falls back to the activity's on the detail page. */
  durationMinutes?: number | null;
  startWindow?: string;
  /** Private option (own trips-per-day pool): a flat base price covers the first `privateIncluded`
   *  guests, `privateExtraEur` per additional head, `privateMaxGuests` cap. When `isPrivateOption`
   *  the option carries NO price tiers — the four fields below are its whole pricing. */
  isPrivateOption?: boolean;
  privateBaseEur?: number | null;
  privateIncluded?: number | null;
  privateExtraEur?: number | null;
  privateMaxGuests?: number | null;
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
  /** Real departure/start time shown in the quick facts (e.g. "09:00" or "07:30–09:30"); '' shows
   *  the generic "Check availability for start times". */
  startWindow: string;
  /** Private/exclusive to the booker's party — drives the "Private group" quick-fact. Not assumed. */
  isPrivate: boolean;
  /** Adults only (18+) — hides the baby/child-seats add-on and shows an "18+" note. E.g. hiking. */
  adultsOnly: boolean;
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
  /** Public Storage URL of a price-list PDF; '' hides the "Price list" section on the activity page. */
  priceListUrl: string;
  /** Optional label shown above the price-list PDF (e.g. "Casela park entry prices"). */
  priceListLabel: string;
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
  startWindow: '',
  isPrivate: false,
  adultsOnly: false,
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
  priceListUrl: '',
  priceListLabel: '',
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
  if (v.startWindow.trim()) out.startWindow = v.startWindow.trim();
  if (v.isPrivate) out.isPrivate = true;
  if (v.adultsOnly) out.adultsOnly = true;
  if (v.priceListUrl.trim()) {
    out.priceList = v.priceListLabel.trim()
      ? { url: v.priceListUrl.trim(), label: v.priceListLabel.trim() }
      : { url: v.priceListUrl.trim() };
  }
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

/**
 * Images have no downstream FK (booking_items snapshots, never references them). INSERT the new rows
 * BEFORE deleting the old ones (same reasoning as replacePrices — the browser client has no transaction,
 * so a delete-then-insert whose insert fails / the user navigating away would strand the tour with ZERO
 * photos, blanking its cover + gallery on the live site). Insert-first leaves the old photos intact on
 * failure. Safe because activity_images has no (activity_id, position) uniqueness — only a PK on id.
 */
async function replaceImages(activityId: string, images: ImageInput[]): Promise<void> {
  const sb = getBrowserSupabase();
  const { data: old, error: readErr } = await sb
    .from('activity_images')
    .select('id')
    .eq('activity_id', activityId);
  if (readErr) throw readErr;
  const rows = images
    .filter((i) => i.url.trim())
    .map((img, position) => ({ activity_id: activityId, url: img.url.trim(), alt: img.alt.trim() || null, position }));
  if (rows.length) {
    const { error } = await sb.from('activity_images').insert(rows);
    if (error) throw error;
  }
  const oldIds = (old ?? []).map((o) => o.id);
  if (oldIds.length) {
    const { error } = await sb.from('activity_images').delete().in('id', oldIds);
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
 * breaks it. A removed option is deleted unless real bookings reference it (booking_items) — its prices
 * and availability occurrences cascade; a booked option that staff removed is left intact (you can't
 * un-sell a seat).
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
    // Private option: the four private_* columns ARE its pricing (all-null when the toggle is off,
    // which also clears them if the toggle is turned back off). Euro fields round to integer cents.
    const isPriv = Boolean(option.isPrivateOption) && option.privateBaseEur != null;
    const privateCols = {
      private_base_minor: isPriv ? Math.round((option.privateBaseEur ?? 0) * 100) : null,
      private_included: isPriv ? (option.privateIncluded ?? 4) : null,
      private_extra_minor: isPriv ? Math.round((option.privateExtraEur ?? 0) * 100) : null,
      private_max_guests: isPriv ? (option.privateMaxGuests ?? option.privateIncluded ?? 4) : null,
    };
    let optionId = option.id;
    if (isNew || !optionId) {
      const { data: opt, error } = await sb
        .from('activity_options')
        .insert({
          activity_id: activityId,
          name: option.name.trim(),
          duration_minutes: option.durationMinutes ?? null,
          start_window: option.startWindow?.trim() || null,
          position,
          ...privateCols,
        })
        .select('id')
        .single();
      if (error) throw error;
      optionId = opt.id;
    } else {
      const { error } = await sb
        .from('activity_options')
        .update({
          name: option.name.trim(),
          duration_minutes: option.durationMinutes ?? null,
          start_window: option.startWindow?.trim() || null,
          position,
          ...privateCols,
        })
        .eq('id', optionId);
      if (error) throw error;
    }
    // A private option carries NO price tiers (its pricing is the private_* columns) — clearing them
    // here also removes stale tiers when an existing option is switched to private.
    await replacePrices(optionId, isPriv ? [] : option.prices);
  }

  for (const optionId of removedIds) {
    // Delete a removed option UNLESS real bookings reference it. `booking_items` is ON DELETE RESTRICT
    // (you can't un-sell a seat), so a booked option is kept. Its prices AND auto-materialised availability
    // (`session_occurrences`) are both ON DELETE CASCADE, so an option that only has availability — no
    // bookings — is removed cleanly. (Previously the occurrence check wrongly kept it, so a staff deletion
    // never persisted: the option reappeared on reload.)
    const { count: items } = await sb
      .from('booking_items')
      .select('id', { count: 'exact', head: true })
      .eq('activity_option_id', optionId);
    if ((items ?? 0) > 0) continue; // has real bookings — keep it
    const { error } = await sb.from('activity_options').delete().eq('id', optionId);
    if (error) throw error;
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
  // Private options (own trips-per-day pool, base + per-extra-head pricing) ride per_person/per_group
  // activities only — the vehicle flows and transfer/planner widgets aren't option-aware.
  for (const o of v.options) {
    if (!o.isPrivateOption) continue;
    // (vehicle_custom is the planner's mode and never appears in this form's PricingMode.)
    if (v.pricingMode === 'vehicle') {
      throw new Error(
        'A private option isn’t available on vehicle-priced tours — the whole tour is already private per vehicle.',
      );
    }
    if (o.privateBaseEur == null || o.privateBaseEur <= 0) {
      throw new Error(`Private option "${o.name || 'unnamed'}": set a base price (must be more than €0).`);
    }
    const included = o.privateIncluded ?? 0;
    const max = o.privateMaxGuests ?? 0;
    if (included < 1) {
      throw new Error(`Private option "${o.name}": "base covers up to N guests" must be at least 1.`);
    }
    if ((o.privateExtraEur ?? -1) < 0) {
      throw new Error(`Private option "${o.name}": set the price per extra guest (€0 is fine).`);
    }
    if (max < included) {
      throw new Error(
        `Private option "${o.name}": max group size (${max}) can’t be below the guests the base covers (${included}).`,
      );
    }
  }
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

/** Append a new activity to the END of its category's card order. `activities.sort` defaults to 0, so
 *  without this every new tour ties with the category's first card and gets bumped up by the
 *  (rating_count, title) tiebreaker — jumping ahead of the owner's arranged order. */
async function nextSortForCategory(category: string): Promise<number> {
  const { data } = await getBrowserSupabase()
    .from('activities')
    .select('sort')
    .eq('category', category)
    .order('sort', { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.sort as number | null) ?? -1) + 1;
}

/** Create a new activity (+ images/options/prices). Returns the new id. */
export async function createActivity(v: ActivityFormValues): Promise<string> {
  assertPricingValid(v);
  const sb = getBrowserSupabase();
  const opId = await operatorId();
  const sort = await nextSortForCategory(v.category);
  const { data, error } = await sb
    .from('activities')
    .insert({ ...activityRow(v, opId), sort })
    .select('id')
    .single();
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

/** Upload a PDF (e.g. a price list) and return its public URL. Reuses the activity-images bucket
 *  (public read, staff-write, no content-type restriction) — the file just carries a .pdf path. */
export async function uploadActivityPdf(file: File, slug: string): Promise<string> {
  const sb = getBrowserSupabase();
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${slugify(slug) || 'activity'}/pricelist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage
    .from('activity-images')
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'application/pdf' });
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
  startWindow?: string | null;
  isPrivate?: boolean;
  adultsOnly?: boolean;
  priceList?: { url?: string; label?: string } | null;
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
    .select(
      'id, name, duration_minutes, start_window, private_base_minor, private_included, private_extra_minor, private_max_guests, position',
    )
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
    startWindow: extra.startWindow ?? '',
    isPrivate: extra.isPrivate ?? false,
    adultsOnly: extra.adultsOnly ?? false,
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
      durationMinutes: o.duration_minutes,
      startWindow: o.start_window ?? '',
      isPrivateOption: o.private_base_minor != null,
      privateBaseEur: o.private_base_minor != null ? o.private_base_minor / 100 : null,
      privateIncluded: o.private_included,
      privateExtraEur: o.private_extra_minor != null ? o.private_extra_minor / 100 : null,
      privateMaxGuests: o.private_max_guests,
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
    priceListUrl: extra.priceList?.url ?? '',
    priceListLabel: extra.priceList?.label ?? '',
  };
}
