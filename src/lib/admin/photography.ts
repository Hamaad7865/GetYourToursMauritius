import { getBrowserSupabase } from '@/lib/supabase/browser';
import {
  EMPTY_ACTIVITY,
  createActivity,
  slugify,
  type ActivityFormValues,
} from '@/lib/admin/activity-write';
import { setDailyCapacity } from '@/lib/admin/availability-write';
import { createCategory } from '@/lib/admin/categories';
import {
  PHOTOGRAPHY_CATEGORY,
  isPhotographyCategory,
  photographyAddOnSlugs,
  photographyGroup,
  type PhotographyGroup,
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
      group: photographyGroup({
        title: a.title as string,
        summary: (a.summary as string | null) ?? null,
      }),
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
    cancellationPolicy:
      input.kind === 'weddings'
        ? 'Free cancellation up to 30 days before your wedding date.'
        : 'Free cancellation up to 48 hours before your shoot.',
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
    supplements: input.addOns
      .filter((a) => a.name.trim() && a.priceEur >= 0)
      .map((a) => ({ name: a.name.trim(), nameFr: a.nameFr.trim(), priceEur: a.priceEur })),
  };
}

/** Create the package, then give it its per-day capacity — which also materialises its dates, so a
 *  published package is bookable the moment this returns. Returns the new activity id. */
export async function createPhotographyPackage(input: PhotographyPackageInput): Promise<string> {
  const id = await createActivity(photographyPackageValues(input));
  await setDailyCapacity(id, Math.max(1, Math.round(input.shootsPerDay)));
  return id;
}
