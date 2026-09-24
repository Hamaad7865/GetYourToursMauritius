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

/** Normalise whatever `extra.photographyAddOns` holds into a clean, de-duplicated slug list. */
export function photographyAddOnSlugs(extra: unknown): string[] {
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
