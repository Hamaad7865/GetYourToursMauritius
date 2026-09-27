/**
 * Photography & film — the rules shared by the public pages, the booking widget and /admin.
 *
 * A photography package is an ordinary catalogue activity whose category is exactly
 * PHOTOGRAPHY_CATEGORY. That is the whole integration: dates come from its availability, "extra
 * guests" from a private option (base covers N, a price per extra head), add-ons (drone, extra hour,
 * album…) from its supplements, and payment from the one checkout — nothing about the money path is
 * re-implemented for photography.
 *
 * Pure (no framework imports), so it is safe on the server, the client and in tests.
 */

export const PHOTOGRAPHY_CATEGORY = 'Photography';

/** The `activities.extra` key a TOUR uses to list the photography package slugs it offers as an
 *  add-on (set in the tour editor's Logistics pane). */
export const PHOTOGRAPHY_ADD_ONS_KEY = 'photographyAddOns';

export function isPhotographyCategory(category: string | null | undefined): boolean {
  return (category ?? '').trim().toLowerCase() === PHOTOGRAPHY_CATEGORY.toLowerCase();
}

/**
 * Photography is paid in two halves: this share up front to book the date (non-refundable — the
 * existing partial-deposit rule in api_mark_refunded), the rest when the photos are delivered.
 * The charge itself is set in SQL by `set_photography_deposit()` (20261010000000); this is its
 * DISPLAY mirror only, pinned to it by tests/integration/photography-deposit.test.ts.
 */
export const PHOTOGRAPHY_DEPOSIT_PERCENT = 50;

/** Half the total rounded UP to the cent — `(total + 1) / 2` in integer minor units, exactly as the
 *  trigger computes it. A total under 2 cents carries no deposit (paid in full), as in SQL. */
export function photographyDepositMinor(totalMinor: number): number {
  const total = Math.round(totalMinor);
  return total < 2 ? 0 : Math.floor((total + 1) / 2);
}

export type PhotographyGroup = 'weddings' | 'shoots';

/** The `activities.extra` key holding a package's group, chosen in the admin (New package → Type,
 *  or the tour editor's Logistics pane). */
export const PHOTOGRAPHY_GROUP_KEY = 'photographyGroup';

export function isPhotographyGroup(v: unknown): v is PhotographyGroup {
  return v === 'weddings' || v === 'shoots';
}

/** The group saved in `extra`, or null when none was chosen (older rows). */
export function savedPhotographyGroup(extra: unknown): PhotographyGroup | null {
  const v =
    extra && typeof extra === 'object'
      ? (extra as Record<string, unknown>)[PHOTOGRAPHY_GROUP_KEY]
      : undefined;
  return isPhotographyGroup(v) ? v : null;
}

/* ---------------------------------------------------------------------------------------------
 * Price-card specs (20261011+): the reference-style ticks on a package page — edited-photos
 * count, location line, delivery line — plus the owner's "best seller" badge. All live in
 * `activities.extra` (no migration): set in /admin/photography → Edit package, read here.
 * ------------------------------------------------------------------------------------------- */
/** `activities.extra` keys a package's price-card specs. */
export const PHOTOGRAPHY_BEST_SELLER_KEY = 'photographyBestSeller';
export const PHOTOGRAPHY_PHOTO_COUNT_KEY = 'photographyPhotoCount';
export const PHOTOGRAPHY_LOCATION_KEY = 'photographyLocation';
export const PHOTOGRAPHY_DELIVERY_KEY = 'photographyDelivery';
/** `activities.extra` key for a package's own inspiration strip ("Get inspired by these …
 *  shots"): the package's own photo URLs, in display order — uploaded in /admin/photography →
 *  Edit package, stored on the package itself (not the shared gallery). Empty/absent = the
 *  tag-based fallback. */
export const PHOTOGRAPHY_INSPIRATION_KEY = 'photographyInspiration';
/** `activities.extra` key for the package's cover photo URL. The cover shows on cards, search
 *  and SEO — but NOT in the package page's own gallery. */
export const PHOTOGRAPHY_COVER_KEY = 'photographyCover';
/** Per-tick visibility on the price card. Only an explicit `false` hides a tick — older packages
 *  without these keys keep showing everything they used to. */
export const PHOTOGRAPHY_SHOW_DURATION_KEY = 'photographyShowDuration';
export const PHOTOGRAPHY_SHOW_GUESTS_KEY = 'photographyShowGuests';
export const PHOTOGRAPHY_SHOW_ADD_ONS_KEY = 'photographyShowAddOns';
export const PHOTOGRAPHY_SHOW_DEPOSIT_KEY = 'photographyShowDeposit';
/** Visibility of the "Package details" collapsible on the package page. Same opt-out rule. */
export const PHOTOGRAPHY_SHOW_DETAILS_KEY = 'photographyShowDetails';

export interface PhotographySpecs {
  /** The owner's pick — the only package that gets the "Best seller" badge. */
  bestSeller: boolean;
  /** Edited photos included ("Up to 40 edited photos"), or null when unset. */
  photoCount: number | null;
  /** Location line as written by the owner ("Beach of your choice"), or null. */
  location: string | null;
  /** Delivery line as written by the owner ("Delivery in 3 weeks"), or null. */
  delivery: string | null;
  /** Which of the automatic ticks the card shows. All default to true. */
  showDuration: boolean;
  showGuests: boolean;
  showAddOns: boolean;
  showDeposit: boolean;
  /** Whether the "Package details" collapsible shows. Defaults to true. */
  showDetails: boolean;
}

/** Normalise whatever `extra` holds into clean specs — unknown shapes read as unset. */
export function photographySpecs(extra: unknown): PhotographySpecs {
  const rec = extra && typeof extra === 'object' ? (extra as Record<string, unknown>) : {};
  const count = rec[PHOTOGRAPHY_PHOTO_COUNT_KEY];
  const location = rec[PHOTOGRAPHY_LOCATION_KEY];
  const delivery = rec[PHOTOGRAPHY_DELIVERY_KEY];
  return {
    bestSeller: rec[PHOTOGRAPHY_BEST_SELLER_KEY] === true,
    photoCount: typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null,
    location: typeof location === 'string' && location.trim() ? location.trim() : null,
    delivery: typeof delivery === 'string' && delivery.trim() ? delivery.trim() : null,
    showDuration: rec[PHOTOGRAPHY_SHOW_DURATION_KEY] !== false,
    showGuests: rec[PHOTOGRAPHY_SHOW_GUESTS_KEY] !== false,
    showAddOns: rec[PHOTOGRAPHY_SHOW_ADD_ONS_KEY] !== false,
    showDeposit: rec[PHOTOGRAPHY_SHOW_DEPOSIT_KEY] !== false,
    showDetails: rec[PHOTOGRAPHY_SHOW_DETAILS_KEY] !== false,
  };
}

/** Weddings and wedding films vs every other shoot. The owner's saved choice wins; a package saved
 *  without one falls back to reading its own title/summary. */
export function photographyGroup(
  p: { title: string; summary?: string | null },
  saved?: PhotographyGroup | null,
): PhotographyGroup {
  if (saved) return saved;
  return /wedding|elop|film|mariage|vow/i.test(`${p.title} ${p.summary ?? ''}`)
    ? 'weddings'
    : 'shoots';
}

/** Normalise whatever `extra.photographyAddOns` holds into a clean, de-duplicated slug list. */ export function photographyAddOnSlugs(
  extra: unknown,
): string[] {
  const raw =
    extra && typeof extra === 'object'
      ? (extra as Record<string, unknown>)[PHOTOGRAPHY_ADD_ONS_KEY]
      : undefined;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Normalise whatever `extra.photographyInspiration` holds into a clean list of the package's
 *  own photo URLs, in display order. Anything else reads as "no photos" (the tag fallback
 *  applies). Gallery ids saved by the short-lived picker are resolved at render, not here. */
export function photographyInspirationIds(extra: unknown): string[] {
  const raw =
    extra && typeof extra === 'object'
      ? (extra as Record<string, unknown>)[PHOTOGRAPHY_INSPIRATION_KEY]
      : undefined;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** The package's cover photo URL (`extra.photographyCover`), or null when none was set. */
export function photographyCover(extra: unknown): string | null {
  const v =
    extra && typeof extra === 'object'
      ? (extra as Record<string, unknown>)[PHOTOGRAPHY_COVER_KEY]
      : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** One cross-sell card on a booking card: a photography package on a tour, or a private tour on a
 *  photography package. Display only — the linked page prices and books it itself. */
export interface CrossSellItem {
  slug: string;
  title: string;
  fromPriceEur: number | null;
  image: string | null;
}

/** Deep link that opens `slug`'s booking card on the same day for the same party, so pairing a shoot
 *  with a tour (or the reverse) is two clicks, not a second search. */
export function crossSellHref(slug: string, date: string, guests: number): string {
  const params = new URLSearchParams();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('date', date);
  if (guests > 0) params.set('adults', String(Math.round(guests)));
  const qs = params.toString();
  return `/activities/${encodeURIComponent(slug)}${qs ? `?${qs}` : ''}`;
}

/* ---------------------------------------------------------------------------------------------
 * Light slots, locations & occasions (the v3 photography flow) — stored in `activities.extra`,
 * so both the customer flow and /admin/photography read the same source.
 * ------------------------------------------------------------------------------------------- */

export const PHOTOGRAPHY_SLOTS_KEY = 'photographySlots';
export const PHOTOGRAPHY_LOCATIONS_KEY = 'photographyLocations';
export const PHOTOGRAPHY_OCCASIONS_KEY = 'photographyOccasions';

/** What time of day a slot means — drives the coast light-tip and the sun-time label. */
export type PhotographyLight = 'sunrise' | 'day' | 'sunset';

export interface PhotographySlotDef {
  id: string;
  label: string;
  note: string;
  light: PhotographyLight;
  enabled: boolean;
}

/** Shoots (non-wedding) slots. Times are computed from the date — see slotMinutesOfDay. */
export const PHOTOGRAPHY_SHOOT_SLOTS: readonly PhotographySlotDef[] = [
  {
    id: 'sunrise',
    label: 'Sunrise',
    note: 'Empty beaches, soft light',
    light: 'sunrise',
    enabled: true,
  },
  { id: 'morning', label: 'Morning', note: 'Bright, turquoise water', light: 'day', enabled: true },
  {
    id: 'golden',
    label: 'Golden hour',
    note: 'Warm light into sunset',
    light: 'sunset',
    enabled: true,
  },
];

/** Wedding slots replace the shoot slots for packages in the weddings group. */
export const PHOTOGRAPHY_WEDDING_SLOTS: readonly PhotographySlotDef[] = [
  {
    id: 'wmorning',
    label: 'Morning ceremony',
    note: 'Cooler air, calm lagoon',
    light: 'day',
    enabled: true,
  },
  {
    id: 'wafternoon',
    label: 'Afternoon ceremony',
    note: 'Portraits at golden hour after',
    light: 'day',
    enabled: true,
  },
  {
    id: 'wsunset',
    label: 'Sunset ceremony',
    note: 'Vows as the sun goes down',
    light: 'sunset',
    enabled: true,
  },
];

/** The slots a package offers: the owner's saved list when present, else the group defaults.
 *  Saved entries override the defaults by id (so a slot can be disabled or re-worded). */
export function photographySlots(extra: unknown, group: PhotographyGroup): PhotographySlotDef[] {
  const base = (group === 'weddings' ? PHOTOGRAPHY_WEDDING_SLOTS : PHOTOGRAPHY_SHOOT_SLOTS).map(
    (s) => ({ ...s }),
  );
  const raw =
    extra && typeof extra === 'object'
      ? (extra as Record<string, unknown>)[PHOTOGRAPHY_SLOTS_KEY]
      : undefined;
  if (!Array.isArray(raw)) return base;
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const hit = base.find((s) => s.id === o.id);
    if (!hit) continue;
    if (typeof o.enabled === 'boolean') hit.enabled = o.enabled;
    if (typeof o.label === 'string' && o.label.trim()) hit.label = o.label.trim();
    if (typeof o.note === 'string' && o.note.trim()) hit.note = o.note.trim();
  }
  return base;
}

/** The sparse form a package saves in `extra.photographySlots`: only the slots that differ from the
 *  group's defaults (a disabled slot, or a re-worded label/note). Empty = everything default, and
 *  the key is omitted entirely. */
export function photographySlotOverrides(
  slots: readonly PhotographySlotDef[],
  group: PhotographyGroup,
): Pick<PhotographySlotDef, 'id' | 'label' | 'note' | 'enabled'>[] {
  const defaults = group === 'weddings' ? PHOTOGRAPHY_WEDDING_SLOTS : PHOTOGRAPHY_SHOOT_SLOTS;
  const out: Pick<PhotographySlotDef, 'id' | 'label' | 'note' | 'enabled'>[] = [];
  for (const s of slots) {
    const d = defaults.find((x) => x.id === s.id);
    if (!d) continue;
    if (s.enabled !== d.enabled || s.label !== d.label || s.note !== d.note) {
      out.push({ id: s.id, label: s.label, note: s.note, enabled: s.enabled });
    }
  }
  return out;
}

export type PhotographyCoast = 'east' | 'west' | 'any';

export interface PhotographyLocation {
  name: string;
  region: string;
  /** Surcharge over the package price (EUR). 0 = included. Priced for real as a supplement. */
  extraEur: number;
  coast: PhotographyCoast;
  /** Short chip, e.g. "Best at sunrise". */
  best: string;
  /** Google Maps geocode query for the map pin; '' = no map (e.g. "Your hotel"). */
  mapQuery: string;
  /** Admin bookkeeping only: the activity_supplements row that prices this location's surcharge
   *  (named "Location: {name}"). Never set by the readers — the admin form attaches it so a save
   *  updates the row in place instead of recreating it. */
  supplementId?: string;
}

/** Supplement rows named "Location: …" price a location's surcharge (api_book only prices
 *  activity_supplements, so a priced location must exist as a row). The admin form manages them
 *  through the Locations editor and every generic add-on list filters them out by this prefix. */
export const PHOTOGRAPHY_LOCATION_SUPPLEMENT_PREFIX = 'Location:';

/** The exact supplement name for a location surcharge. */
export function locationSupplementName(name: string): string {
  return `${PHOTOGRAPHY_LOCATION_SUPPLEMENT_PREFIX} ${name.trim()}`;
}

/** The exact supplement French name for a location surcharge. */
export function locationSupplementNameFr(name: string): string {
  return `Lieu : ${name.trim()}`;
}

/** True when a supplement row is a location surcharge rather than a generic add-on. */
export function isLocationSupplementName(name: string): boolean {
  return name.startsWith(PHOTOGRAPHY_LOCATION_SUPPLEMENT_PREFIX);
}

/** The island defaults every package starts from — the owner edits them per package. */
export const PHOTOGRAPHY_LOCATION_DEFAULTS: readonly PhotographyLocation[] = [
  {
    name: 'Belle Mare beach',
    region: 'East coast · long white sand',
    extraEur: 0,
    coast: 'east',
    best: 'Best at sunrise',
    mapQuery: 'Belle Mare Beach, Mauritius',
  },
  {
    name: 'Le Morne',
    region: 'South-west · mountain and lagoon',
    extraEur: 40,
    coast: 'west',
    best: 'Best at sunset',
    mapQuery: 'Le Morne Brabant, Mauritius',
  },
  {
    name: 'Île aux Cerfs',
    region: 'East · boat crossing included',
    extraEur: 60,
    coast: 'east',
    best: 'Best in the morning',
    mapQuery: 'Île aux Cerfs, Mauritius',
  },
  {
    name: 'Your hotel',
    region: 'Anywhere on the island',
    extraEur: 0,
    coast: 'any',
    best: 'We advise the time',
    mapQuery: '',
  },
];

/** The package's location list: saved extra wins; absent/invalid → the island defaults. */
export function photographyLocations(extra: unknown): PhotographyLocation[] {
  const raw =
    extra && typeof extra === 'object'
      ? (extra as Record<string, unknown>)[PHOTOGRAPHY_LOCATIONS_KEY]
      : undefined;
  if (!Array.isArray(raw)) return PHOTOGRAPHY_LOCATION_DEFAULTS.map((l) => ({ ...l }));
  const out: PhotographyLocation[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name.trim()) continue;
    const coast = o.coast === 'east' || o.coast === 'west' || o.coast === 'any' ? o.coast : 'any';
    out.push({
      name: o.name.trim(),
      region: typeof o.region === 'string' ? o.region.trim() : '',
      extraEur:
        typeof o.extraEur === 'number' && o.extraEur > 0 ? Math.round(o.extraEur * 100) / 100 : 0,
      coast,
      best: typeof o.best === 'string' ? o.best.trim() : '',
      mapQuery: typeof o.mapQuery === 'string' ? o.mapQuery.trim() : '',
    });
  }
  return out.length ? out : PHOTOGRAPHY_LOCATION_DEFAULTS.map((l) => ({ ...l }));
}

/** Occasion tags for the shoots tab's filter chips (couple / proposal / family / solo). */
export type PhotographyOccasion = 'couple' | 'proposal' | 'family' | 'solo';

export const PHOTOGRAPHY_OCCASIONS: readonly [PhotographyOccasion, string][] = [
  ['couple', 'Couples & honeymoon'],
  ['proposal', 'Proposal'],
  ['family', 'Family'],
  ['solo', 'Solo & portrait'],
];

/** Saved occasions win; otherwise guess from the title so filters work before the owner tags. */
export function photographyOccasions(
  p: { title: string; summary?: string | null },
  extra: unknown,
): PhotographyOccasion[] {
  const raw =
    extra && typeof extra === 'object'
      ? (extra as Record<string, unknown>)[PHOTOGRAPHY_OCCASIONS_KEY]
      : undefined;
  if (Array.isArray(raw)) {
    const out = raw.filter(
      (v): v is PhotographyOccasion =>
        typeof v === 'string' && PHOTOGRAPHY_OCCASIONS.some(([id]) => id === v),
    );
    if (out.length) return [...new Set(out)];
  }
  const text = `${p.title} ${p.summary ?? ''}`;
  const out: PhotographyOccasion[] = [];
  if (/couple|honeymoon|romance/i.test(text)) out.push('couple');
  if (/proposal|engag/i.test(text)) out.push('proposal');
  if (/family|kids|child/i.test(text)) out.push('family');
  if (/solo|portrait|fashion/i.test(text)) out.push('solo');
  return out.length ? out : ['couple'];
}

/* Sun times (approximate for Mauritius, ±10 min across the year) — display/guidance only, the
 * booking itself stays day-granular. */

/** Sunrise/sunset in minutes after midnight, local time. */
export function photographySunTimes(day: Date): { rise: number; set: number } {
  const doy = Math.floor((day.getTime() - new Date(day.getFullYear(), 0, 0).getTime()) / 864e5);
  const c = Math.cos((2 * Math.PI * (doy + 10)) / 365);
  return { rise: 372 - 40 * c, set: 1100 + 40 * c };
}

/** A slot's start time in minutes after midnight on that day. */
export function photographySlotMinutes(slotId: string, day: Date | null): number {
  const fixed: Record<string, number> = { morning: 540, wmorning: 600, wafternoon: 900 };
  if (fixed[slotId] != null) return fixed[slotId]!;
  const s = day ? photographySunTimes(day) : { rise: 372, set: 1100 };
  return slotId === 'sunrise' ? s.rise - 15 : slotId === 'wsunset' ? s.set - 60 : s.set - 75;
}

/** "HH:MM" for a minutes-after-midnight value. */
export function photographyHm(minutes: number): string {
  const r = Math.round(minutes / 5) * 5;
  return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
}

/** The coast/light mismatch tip, or a reassurance. fixTo = a better coast-matched location name
 *  from the same list (only when one exists). */
export function photographyLightTip(
  loc: PhotographyLocation,
  light: PhotographyLight | null,
  locations: readonly PhotographyLocation[],
): { warn: boolean; text: string; fixTo: string | null } {
  const alt = (coast: PhotographyCoast) => locations.find((l) => l.coast === coast)?.name ?? null;
  if (loc.coast === 'east' && light === 'sunset') {
    const fix = alt('west');
    return {
      warn: true,
      text: 'The east coast faces the sunrise, so at golden hour the sun sets behind the island. For the sun going down over the sea, choose the west coast.',
      fixTo: fix,
    };
  }
  if (loc.coast === 'west' && light === 'sunrise') {
    const fix = alt('east');
    return {
      warn: true,
      text: "The west coast sits in the mountain's shadow at sunrise. The east coast gets the first light.",
      fixTo: fix,
    };
  }
  if (loc.coast === 'any') {
    return {
      warn: false,
      text: "We'll check your venue or hotel beach and send you the best spot and time.",
      fixTo: null,
    };
  }
  return {
    warn: false,
    text: `${loc.name} at that time is one of our favourite combinations.`,
    fixTo: null,
  };
}

/** The add-on menu the admin "New package" template pre-fills. Prices are suggestions the owner
 *  edits before saving — they are written into activity_supplements, which is what api_book reads. */
export const PHOTOGRAPHY_ADD_ON_PRESETS: { name: string; nameFr: string; priceEur: number }[] = [
  { name: 'Drone aerials', nameFr: 'Vues aériennes par drone', priceEur: 120 },
  { name: 'Extra hour of coverage', nameFr: 'Heure de couverture supplémentaire', priceEur: 90 },
  { name: 'Same-day preview photos', nameFr: 'Aperçu photo le jour même', priceEur: 40 },
  { name: 'Printed album', nameFr: 'Album imprimé', priceEur: 180 },
];

/* ---------------------------------------------------------------------------------------------
 * Page photos (photography_photos, 20261009000000) — managed in /admin/photography.
 * ------------------------------------------------------------------------------------------- */

/** Built-in stand-in photos (licensed Unsplash stock under /public/photography, plus our own island
 *  shots). Every slot falls back to one of these until the owner uploads their own. */
export const PHOTO_STOCK = {
  hero: '/photography/wedding-beach.jpg',
  weddingSunset: '/photography/wedding-sunset.jpg',
  weddingCouple: '/photography/wedding-couple.jpg',
  weddingDetail: '/photography/wedding-detail.jpg',
  couple: '/photography/couple.jpg',
  family: '/photography/family.jpg',
  family2: '/photography/family-2.jpg',
  film: '/photography/film.jpg',
  film2: '/photography/film-2.jpg',
  aerial: '/hero/islands/aerial-lagoon.jpg',
  islet: '/hero/islands/ile-aux-aigrettes.jpg',
  passe: '/hero/islands/ile-de-la-passe.jpg',
};

export const GALLERY_TAGS = ['weddings', 'films', 'couples', 'family'] as const;
export type GalleryTag = (typeof GALLERY_TAGS)[number];

/** The gallery category a package's own "Get inspired" strip pulls from: the owner's saved
 *  weddings/shoots group first, then a family/kids title match, else the general couples bucket
 *  (most non-wedding packages — holiday, beach, trip, proposal, fashion — read as lifestyle shoots).
 *  Best-effort only: it picks a plausible category for a preview, not a strict classification. */
export function galleryTagForPackage(
  p: { title: string; summary?: string | null },
  group: PhotographyGroup,
): GalleryTag {
  if (group === 'weddings') return 'weddings';
  if (/family|kids|child/i.test(p.title)) return 'family';
  return 'couples';
}

/** The same sample gallery is shown publicly and offered for editing in admin. */
export const PHOTOGRAPHY_GALLERY_DEFAULTS: {
  key: keyof typeof PHOTO_STOCK;
  alt: string;
  tags: GalleryTag[];
  aspect: string;
}[] = [
  {
    key: 'weddingCouple',
    alt: 'Bride and groom by the water',
    tags: ['weddings'],
    aspect: 'aspect-[4/5]',
  },
  { key: 'film2', alt: 'Filming a wedding on the beach', tags: ['films'], aspect: 'aspect-video' },
  { key: 'couple', alt: 'Couple on a Mauritius beach', tags: ['couples'], aspect: 'aspect-square' },
  { key: 'weddingDetail', alt: 'Wedding details', tags: ['weddings'], aspect: 'aspect-[3/4]' },
  { key: 'family2', alt: 'Family on the beach', tags: ['family'], aspect: 'aspect-[4/3]' },
  {
    key: 'aerial',
    alt: 'Aerial view of a Mauritius lagoon',
    tags: ['films', 'weddings'],
    aspect: 'aspect-[4/5]',
  },
  { key: 'weddingSunset', alt: 'Couple at sunset', tags: ['weddings'], aspect: 'aspect-[4/3]' },
  { key: 'family', alt: 'Family holiday portrait', tags: ['family'], aspect: 'aspect-[3/4]' },
  {
    key: 'passe',
    alt: 'Island backdrop for a couples shoot',
    tags: ['couples'],
    aspect: 'aspect-[4/3]',
  },
];

export type PhotoSlot =
  | 'hero'
  | 'service-weddings'
  | 'service-films'
  | 'service-couples'
  | 'service-family'
  | 'gallery'
  | 'why'
  | 'cta'
  | 'pricing-hero'
  | 'gallery-hero';

/** Every slot, in page order, with its admin label and stand-in (the gallery has many photos and
 *  falls back to a built-in set instead). Mirrors the migration's CHECK list. */
export const PHOTO_SLOTS: { id: PhotoSlot; label: string; hint: string; standIn: string | null }[] =
  [
    {
      id: 'hero',
      label: 'Hero',
      hint: 'The big opening photo on /photography.',
      standIn: PHOTO_STOCK.hero,
    },
    {
      id: 'service-weddings',
      label: 'What we shoot — Wedding photography',
      hint: 'Large card.',
      standIn: PHOTO_STOCK.weddingSunset,
    },
    {
      id: 'service-films',
      label: 'What we shoot — Wedding films',
      hint: '',
      standIn: PHOTO_STOCK.film,
    },
    {
      id: 'service-couples',
      label: 'What we shoot — Couples & holidays',
      hint: '',
      standIn: PHOTO_STOCK.couple,
    },
    {
      id: 'service-family',
      label: 'What we shoot — Family shoots',
      hint: 'Wide card — a landscape photo works best.',
      standIn: PHOTO_STOCK.family,
    },
    {
      id: 'gallery',
      label: 'The look — gallery',
      hint: 'Photos and videos — as many as you like. Tag each one so it shows under the right category (on /photography and the gallery page). Long films are best as a YouTube or Vimeo link.',
      standIn: null,
    },
    {
      id: 'why',
      label: 'Why book with us',
      hint: 'Shown beside the three reasons.',
      standIn: PHOTO_STOCK.weddingSunset,
    },
    {
      id: 'cta',
      label: 'Closing banner',
      hint: 'Background of the final “Pick your date” banner (darkened).',
      standIn: PHOTO_STOCK.aerial,
    },
    {
      id: 'pricing-hero',
      label: 'Price list banner',
      hint: 'The banner at the top of /photography/packages.',
      standIn: PHOTO_STOCK.hero,
    },
    {
      id: 'gallery-hero',
      label: 'Gallery page banner',
      hint: 'The banner at the top of /photography/gallery.',
      standIn: PHOTO_STOCK.passe,
    },
  ];

export function isPhotoSlot(v: unknown): v is PhotoSlot {
  return PHOTO_SLOTS.some((s) => s.id === v);
}

export type PhotoMediaType = 'image' | 'video';

export interface PhotographyPhoto {
  id: string;
  slot: PhotoSlot;
  url: string;
  alt: string | null;
  tags: GalleryTag[];
  position: number;
  /** 'video' only in the gallery slot (a DB CHECK enforces it). */
  mediaType: PhotoMediaType;
  /** Optional cover image for a video. */
  posterUrl: string | null;
}

/** Photos of one slot, in display order (position, then insertion order as the reader returns it). */
export function photosIn(photos: PhotographyPhoto[], slot: PhotoSlot): PhotographyPhoto[] {
  return photos.filter((p) => p.slot === slot).sort((a, b) => a.position - b.position);
}

/** The URL a single-photo slot renders: the owner's first photo, else the built-in stand-in. */
export function slotUrl(photos: PhotographyPhoto[], slot: Exclude<PhotoSlot, 'gallery'>): string {
  return photosIn(photos, slot)[0]?.url ?? PHOTO_SLOTS.find((s) => s.id === slot)?.standIn ?? '';
}

/** Coerce a raw DB row into a PhotographyPhoto, or null if it can't be placed. */
export function toPhotographyPhoto(row: {
  id: unknown;
  slot: unknown;
  url: unknown;
  alt?: unknown;
  tags?: unknown;
  position?: unknown;
  media_type?: unknown;
  poster_url?: unknown;
}): PhotographyPhoto | null {
  if (typeof row.id !== 'string' || typeof row.url !== 'string' || !row.url.trim()) return null;
  if (!isPhotoSlot(row.slot)) return null;
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((t): t is GalleryTag => (GALLERY_TAGS as readonly unknown[]).includes(t))
    : [];
  return {
    id: row.id,
    slot: row.slot,
    url: row.url,
    alt: typeof row.alt === 'string' && row.alt.trim() ? row.alt : null,
    tags,
    position: typeof row.position === 'number' ? row.position : 0,
    mediaType: row.media_type === 'video' ? 'video' : 'image',
    posterUrl:
      typeof row.poster_url === 'string' && row.poster_url.trim() ? row.poster_url.trim() : null,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Videos: an uploaded file (mp4 / webm / mov) or a YouTube / Vimeo link. One parser decides how the
 * gallery plays it and what it shows before it plays — so the admin, the grid and the viewer agree.
 * ------------------------------------------------------------------------------------------- */

export type VideoSource =
  | { kind: 'youtube'; id: string; embedUrl: string; thumbUrl: string }
  | { kind: 'vimeo'; id: string; embedUrl: string; thumbUrl: null }
  | { kind: 'file'; src: string; thumbUrl: null };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** How to play `url`, or null when it is not a recognisable video. */
export function videoSource(url: string): VideoSource | null {
  let u: URL;
  try {
    u = new URL(url.trim(), 'https://placeholder.invalid');
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let yt: string | null = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    yt =
      u.searchParams.get('v') ??
      (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '') ? (parts[1] ?? null) : null);
  }
  if (yt && YOUTUBE_ID.test(yt)) {
    return {
      kind: 'youtube',
      id: yt,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&playsinline=1`,
      thumbUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = u.pathname.split('/').filter((p) => /^\d+$/.test(p))[0];
    if (id) {
      return {
        kind: 'vimeo',
        id,
        embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1`,
        thumbUrl: null,
      };
    }
  }
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(u.pathname)) {
    return { kind: 'file', src: url.trim(), thumbUrl: null };
  }
  return null;
}

/** The still to show for a gallery item before it plays: its cover, a YouTube frame, or nothing. */
export function mediaThumb(
  p: Pick<PhotographyPhoto, 'mediaType' | 'url' | 'posterUrl'>,
): string | null {
  if (p.mediaType === 'image') return p.url;
  return p.posterUrl ?? videoSource(p.url)?.thumbUrl ?? null;
}

/* ---------------------------------------------------------------------------------------------
 * The six example packages. Shown on /photography and the price list while no real package is
 * published (as WhatsApp enquiries), and imported by /admin/photography → "Add the 6 example
 * packages" as editable DRAFT packages — one list, so what the owner imports is exactly what the
 * page showed. English source text; the pages translate it through t() (the keys are in messages.ts).
 * Prices are starting suggestions the owner reviews before publishing.
 * ------------------------------------------------------------------------------------------- */

export interface StarterPackage {
  key: string;
  kind: PhotographyGroup;
  title: string;
  /** Short "4 hours · 1 photographer" line under the title. */
  meta: string;
  summary: string;
  features: string[];
  image: string;
  /** The dark "our pick" card on the example grid. */
  highlight: boolean;
  durationHours: number;
  baseEur: number;
  included: number;
  extraEur: number;
  maxGuests: number;
  shootsPerDay: number;
  minAdvanceDays: number;
}

export const PHOTOGRAPHY_STARTER_PACKAGES: StarterPackage[] = [
  {
    key: 'ceremony-photo',
    kind: 'weddings',
    title: 'Ceremony · Photo',
    meta: '4 hours · 1 photographer',
    summary: 'Your vows, the portraits and the first toast, told in stills.',
    features: ['Edited high-resolution photos', 'Private online gallery', 'Location scouting'],
    image: PHOTO_STOCK.weddingDetail,
    highlight: false,
    durationHours: 4,
    baseEur: 650,
    included: 2,
    extraEur: 0,
    maxGuests: 2,
    shootsPerDay: 1,
    minAdvanceDays: 7,
  },
  {
    key: 'ceremony-photo-film',
    kind: 'weddings',
    title: 'Ceremony · Photo + Film',
    meta: '6 hours · photographer + videographer',
    summary: 'Photos and a cinematic film of the day, from the aisle to the sunset.',
    features: [
      'Edited high-resolution photos',
      'Cinematic film + short teaser',
      'Drone aerials, where permitted',
    ],
    image: PHOTO_STOCK.weddingCouple,
    highlight: true,
    durationHours: 6,
    baseEur: 1150,
    included: 2,
    extraEur: 0,
    maxGuests: 2,
    shootsPerDay: 1,
    minAdvanceDays: 7,
  },
  {
    key: 'full-day',
    kind: 'weddings',
    title: 'Full day · Photo + Film',
    meta: '10 hours · 2 photographers + videographer',
    summary: 'Every moment covered, from getting ready to the last dance.',
    features: ['Getting ready to first dance', 'Feature film + teaser', 'Printed album available'],
    image: PHOTO_STOCK.weddingSunset,
    highlight: false,
    durationHours: 10,
    baseEur: 1890,
    included: 2,
    extraEur: 0,
    maxGuests: 2,
    shootsPerDay: 1,
    minAdvanceDays: 14,
  },
  {
    key: 'couples',
    kind: 'shoots',
    title: 'Couples session',
    meta: '1 hour · 1 beach',
    summary: 'Relaxed, romantic photos for honeymoons, anniversaries and proposals.',
    features: ['Sunrise or golden hour', 'Honeymoon & proposal friendly', 'Online gallery'],
    image: PHOTO_STOCK.couple,
    highlight: false,
    durationHours: 1,
    baseEur: 150,
    included: 2,
    extraEur: 25,
    maxGuests: 4,
    shootsPerDay: 2,
    minAdvanceDays: 1,
  },
  {
    key: 'island-holiday',
    kind: 'shoots',
    title: 'Island holiday session',
    meta: '2 hours · 2 locations',
    summary: 'Two island backdrops and a short reel to remember the trip.',
    features: ['Two island backdrops', 'Vertical reel for social', 'Online gallery'],
    image: PHOTO_STOCK.islet,
    highlight: true,
    durationHours: 2,
    baseEur: 390,
    included: 2,
    extraEur: 30,
    maxGuests: 6,
    shootsPerDay: 2,
    minAdvanceDays: 1,
  },
  {
    key: 'family',
    kind: 'shoots',
    title: 'Family & kids',
    meta: '1 hour · up to 8 people',
    summary: 'Easy-going family portraits on the beach, at your hotel or villa.',
    features: ['Kid-paced, no stiff poses', 'Beach, hotel or villa', 'Online gallery'],
    image: PHOTO_STOCK.family,
    highlight: false,
    durationHours: 1,
    baseEur: 210,
    included: 4,
    extraEur: 20,
    maxGuests: 8,
    shootsPerDay: 2,
    minAdvanceDays: 1,
  },
];
