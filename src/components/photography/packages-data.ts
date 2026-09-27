import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { getLocale } from '@/lib/i18n/server';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { createUserClient } from '@/lib/supabase/client';
import { isVideoUrl } from '@/lib/media';
import {
  PHOTOGRAPHY_CATEGORY,
  PHOTOGRAPHY_GALLERY_DEFAULTS,
  PHOTO_STOCK,
  galleryTagForPackage,
  isPhotographyCategory,
  mediaThumb,
  photographyGroup,
  photographyOccasions,
  photographySpecs,
  photosIn,
  savedPhotographyGroup,
  type GalleryTag,
  type PhotographyGroup,
  type PhotographyOccasion,
  type PhotographyPhoto,
} from '@/lib/catalogue/photography';
import type { GalleryItem } from './GalleryGrid';
import type { TourSummary } from '@/lib/validation/tours';
import { PHOTOGRAPHY_SHOOTS, matchesPhotographyShoot } from '@/lib/catalogue/photography-shoots';

export type PackageGroup = 'weddings' | 'shoots';

/** One card in the packages grid, already translated on the server. */
export interface PhotoPackage {
  key: string;
  group: PackageGroup;
  title: string;
  meta: string | null;
  /** Bullet list for the built-in cards; live catalogue packages show `summary` instead. */
  features: string[];
  summary: string | null;
  image: string;
  imageAlt: string;
  /** EUR "from" price, or null when the package is quote-only. */
  priceEur: number | null;
  href: string;
  /** True for the WhatsApp enquiry fallback (opens in a new tab). */
  external: boolean;
  highlight: boolean;
  /** The owner's "Best seller" pick (`extra.photographyBestSeller`) — badged on the card. */
  bestSeller: boolean;
  /** Catalogue rating, when the package has reviews. */
  ratingAvg?: number | null;
  ratingCount?: number;
}

/** Built-in stand-in photos (see PHOTO_STOCK). */
export const PHOTO_IMG = PHOTO_STOCK;

/** The published packages — catalogue activities in the Photography category. */
export async function loadPhotographyPackages(): Promise<TourSummary[]> {
  try {
    const { items } = await searchActivities(publicServiceContext(await getLocale()), {
      page: 1,
      pageSize: 24,
      category: PHOTOGRAPHY_CATEGORY,
    });
    return items;
  } catch (error) {
    // The built-in enquiry cards stand in, so a failed read degrades rather than breaks the page.
    console.error('[photography] package fetch failed', error);
    return [];
  }
}

/** Private tours — the ones a shoot pairs with (the reverse of a tour's photography add-ons). A
 *  private-only activity is the one whose from-price is a private base (`fromPriceIncluded`). */
export async function loadPrivateTours(limit = 6): Promise<TourSummary[]> {
  try {
    const { items } = await searchActivities(publicServiceContext(await getLocale()), {
      page: 1,
      pageSize: 100,
    });
    return items
      .filter((a) => a.fromPriceIncluded != null && !isPhotographyCategory(a.category))
      .slice(0, limit);
  } catch (error) {
    console.error('[photography] private tour fetch failed', error);
    return [];
  }
}

/**
 * slug → the group the owner chose for each published package. Catalogue summaries don't carry
 * `extra`, so this is one direct read (the public `activities_read` policy allows published rows).
 * Any failure → {} and every package falls back to the title-based guess.
 */
export async function loadPhotographyGroups(): Promise<Record<string, PhotographyGroup>> {
  try {
    const { data, error } = await createUserClient()
      .from('activities')
      .select('slug, extra')
      .eq('category', PHOTOGRAPHY_CATEGORY as never);
    if (error || !data) return {};
    const out: Record<string, PhotographyGroup> = {};
    for (const row of data) {
      const g = savedPhotographyGroup(row.extra);
      if (g) out[row.slug as string] = g;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Slugs of packages the owner flagged "Best seller" (`extra.photographyBestSeller`). Same one-read
 * pattern as the groups above — summaries don't carry `extra`. The badge shows on the package
 * grid and the package page; the owner ticks only one package in /admin/photography.
 */
export async function loadPhotographyBestSellers(): Promise<Set<string>> {
  try {
    const { data, error } = await createUserClient()
      .from('activities')
      .select('slug, extra')
      .eq('category', PHOTOGRAPHY_CATEGORY as never);
    if (error || !data) return new Set();
    return new Set(
      (data as { slug: unknown; extra: unknown }[])
        .filter((row) => typeof row.slug === 'string' && photographySpecs(row.extra).bestSeller)
        .map((row) => row.slug as string),
    );
  } catch {
    return new Set();
  }
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * slug → the raw `extra` of each published package. Live `TourSummary` rows don't carry `extra`,
 * and the v3 home screen reads occasions and price-card specs from it. One direct read, the same
 * pattern as `loadPhotographyGroups` — any failure → {} and every package falls back to
 * title-based guessing.
 */
export async function loadPhotographyExtras(): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await createUserClient()
      .from('activities')
      .select('slug, extra')
      .eq('category', PHOTOGRAPHY_CATEGORY as never);
    if (error || !data) return {};
    const out: Record<string, unknown> = {};
    for (const row of data as { slug: unknown; extra: unknown }[]) {
      if (typeof row.slug === 'string') out[row.slug] = row.extra;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The package cards both /photography and /photography/packages render. Live packages link to their
 * own /activities/<slug> page (dates, add-ons, checkout). Missing shoot types render as WhatsApp
 * enquiries with no invented price; matching published packages replace those enquiry cards.
 */
export function buildPackageCards(
  t: T,
  live: TourSummary[],
  waNumber: string,
  groups: Record<string, PhotographyGroup> = {},
  bestSellers: Set<string> = new Set(),
): PhotoPackage[] {
  const hours = (minutes: number | null) => {
    if (!minutes) return null;
    const n = Math.round((minutes / 60) * 10) / 10;
    return n === 1 ? t('{n} hour', { n }) : t('{n} hours', { n });
  };

  const publishedCards = (): PhotoPackage[] => {
    const groupOf = (a: TourSummary) => photographyGroup(a, groups[a.slug]);
    const weddings = live.filter((a) => groupOf(a) === 'weddings');
    const shoots = live.filter((a) => groupOf(a) === 'shoots');
    const toCard = (
      a: TourSummary,
      group: PhotoPackage['group'],
      i: number,
      n: number,
    ): PhotoPackage => ({
      key: a.id,
      group,
      title: a.title,
      meta: hours(a.durationMinutes),
      features: [],
      summary: a.summary,
      image:
        a.heroImage?.url ??
        a.images[0]?.url ??
        (group === 'weddings' ? PHOTO_IMG.weddingSunset : PHOTO_IMG.couple),
      imageAlt: a.heroImage?.alt ?? a.title,
      priceEur: a.fromPriceEur,
      href: `/activities/${a.slug}`,
      external: false,
      // The middle card of a full row of three gets the dark "our pick" treatment, as designed.
      highlight: n === 3 && i === 1,
      bestSeller: bestSellers.has(a.slug),
      ratingAvg: a.ratingAvg ?? null,
      ratingCount: a.ratingCount ?? 0,
    });
    return [
      ...weddings.map((a, i) => toCard(a, 'weddings', i, weddings.length)),
      ...shoots.map((a, i) => toCard(a, 'shoots', i, shoots.length)),
    ];
  };

  const enquire = (title: string) =>
    whatsappUrl(
      `Hi ${SITE.operator}! I’m interested in the “${title}” photography package in Mauritius. Could you send availability and prices?`,
      waNumber,
    );
  const cards = publishedCards();
  const used = new Set<string>();
  const shoots: PhotoPackage[] = PHOTOGRAPHY_SHOOTS.map((p) => {
    const existing = live.find(
      (a) => !used.has(a.id) && (matchesPhotographyShoot(p, a) || a.title === t(p.title)),
    );
    if (existing) {
      used.add(existing.id);
      return cards.find((card) => card.key === existing.id)!;
    }
    const title = t(p.title);
    return {
      key: p.key,
      group: 'shoots',
      title,
      meta: null,
      features: [],
      summary: t(p.summary),
      image: p.image,
      imageAlt: title,
      priceEur: null,
      href: enquire(title),
      external: true,
      highlight: false,
      bestSeller: false,
    };
  });
  return [...shoots, ...cards.filter((card) => !used.has(card.key))];
}

/** Mixed ratios cycle so the masonry reads as a contact sheet, not a grid of identical tiles. */
const ASPECTS = ['aspect-[4/5]', 'aspect-video', 'aspect-square', 'aspect-[3/4]', 'aspect-[4/3]'];

/**
 * The gallery, as both /photography ("The look") and /photography/gallery render it: the owner's
 * photos and videos from /admin/photography → Page photos, in their order, or — until they add any —
 * the built-in stand-in set. Server-side, so the alt text is translated once.
 */
export function buildGalleryItems(t: T, photos: PhotographyPhoto[]): GalleryItem[] {
  const own = photosIn(photos, 'gallery');
  if (own.length) {
    return own.map((p, i) => ({
      key: p.id,
      kind: p.mediaType,
      src: p.url,
      thumb: mediaThumb(p),
      alt:
        p.alt ??
        (p.mediaType === 'video'
          ? t('Photography film in Mauritius')
          : t('Photography in Mauritius')),
      categories: p.tags,
      aspect:
        p.mediaType === 'video' ? 'aspect-video' : (ASPECTS[i % ASPECTS.length] ?? 'aspect-[4/5]'),
    }));
  }
  const stock = (
    key: keyof typeof PHOTO_STOCK,
    alt: string,
    categories: GalleryItem['categories'],
    aspect: string,
  ): GalleryItem => ({
    key,
    kind: 'image',
    src: PHOTO_STOCK[key],
    thumb: PHOTO_STOCK[key],
    alt,
    categories,
    aspect,
  });
  return PHOTOGRAPHY_GALLERY_DEFAULTS.map((photo) =>
    stock(photo.key, t(photo.alt), photo.tags, photo.aspect),
  );
}

/**
 * A package's "Get inspired by these {category} shots" strip: the package's own photos
 * (`extra.photographyInspiration`, uploaded in /admin/photography → Edit package) when set —
 * else the shared gallery filtered to the category that best fits this package. Image items
 * only (a thumbnail is enough to preview — the full gallery still plays videos), capped so the
 * row stays a fixed size regardless of how many photos there are.
 */
export function buildInspirationItems(
  t: T,
  photos: PhotographyPhoto[],
  activity: { title: string; summary?: string | null },
  group: PhotographyGroup,
  limit = 6,
  pickUrls: string[] = [],
): { tag: GalleryTag; items: GalleryItem[] } {
  const tag = galleryTagForPackage(activity, group);
  if (pickUrls.length) {
    // Photos only — the strip renders <img> tiles, so uploaded videos stay in the main gallery.
    const picked = pickUrls
      .filter((url) => /^(https?:\/\/|\/)/i.test(url) && !isVideoUrl(url))
      .slice(0, limit)
      .map((url) => ({
        key: url,
        kind: 'image' as const,
        src: url,
        thumb: url,
        alt: activity.title,
        categories: [] as GalleryTag[],
        aspect: 'aspect-[4/3]',
      }));
    if (picked.length) return { tag, items: picked };
  }
  const gallery = buildGalleryItems(t, photos);
  const items = gallery
    .filter((item) => item.kind === 'image' && item.categories.includes(tag))
    .slice(0, limit);
  return { tag, items };
}

/* ---------------------------------------------------------------------------------------------
 * The v3 home screen (Photography Services v3 handoff) — serializable, translated view models the
 * client components render. All data shaping stays here on the server; the client pieces receive
 * plain props.
 * ------------------------------------------------------------------------------------------- */

/** One card in the v3 "What are we celebrating?" grid — already translated on the server. */
export interface V3Package {
  key: string;
  group: PackageGroup;
  title: string;
  summary: string | null;
  image: string;
  imageAlt: string;
  /** "1.5 hours", or null when the package doesn't state a duration. */
  durationLabel: string | null;
  /** "Up to 6 people", or null when capacity isn't known. */
  peopleLabel: string | null;
  /** Up to 3 ticks — edited-photos count, location line, delivery line from the owner's specs. */
  bullets: string[];
  /** EUR "from" price, or null when the package is quote-only. */
  priceEur: number | null;
  href: string;
  /** True for the WhatsApp enquiry fallback (opens in a new tab). */
  external: boolean;
  bestSeller: boolean;
  /** Shoots-tab filter chips; weddings carry none. */
  occasions: PhotographyOccasion[];
}

/** The v3 package grid: live packages shaped for the design's cards, plus the WhatsApp enquiry
 *  fallback for shoot types without a live package (same contract as `buildPackageCards`). */
export function buildV3Packages(
  t: T,
  live: TourSummary[],
  waNumber: string,
  groups: Record<string, PhotographyGroup> = {},
  bestSellers: Set<string> = new Set(),
  extras: Record<string, unknown> = {},
): V3Package[] {
  const hours = (minutes: number | null) => {
    if (!minutes) return null;
    const n = Math.round((minutes / 60) * 10) / 10;
    return n === 1 ? t('{n} hour', { n }) : t('{n} hours', { n });
  };
  const people = (a: TourSummary) => {
    const guests = a.fromPriceIncluded ?? a.fromPriceMaxGuests;
    return guests ? t('Up to {n} people', { n: guests }) : null;
  };
  const bulletsOf = (a: TourSummary): string[] => {
    const specs = photographySpecs(extras[a.slug]);
    return [
      specs.photoCount != null ? t('Up to {n} edited photos', { n: specs.photoCount }) : null,
      specs.location,
      specs.delivery,
    ]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .slice(0, 3);
  };
  const liveCard = (a: TourSummary): V3Package => {
    const group: PackageGroup = photographyGroup(a, groups[a.slug]);
    return {
      key: a.id,
      group,
      title: a.title,
      summary: a.summary,
      image:
        a.heroImage?.url ??
        a.images[0]?.url ??
        (group === 'weddings' ? PHOTO_IMG.weddingSunset : PHOTO_IMG.couple),
      imageAlt: a.heroImage?.alt ?? a.title,
      durationLabel: hours(a.durationMinutes),
      peopleLabel: people(a),
      bullets: bulletsOf(a),
      priceEur: a.fromPriceEur,
      href: `/activities/${a.slug}`,
      external: false,
      bestSeller: bestSellers.has(a.slug),
      occasions: group === 'shoots' ? photographyOccasions(a, extras[a.slug]) : [],
    };
  };
  const liveCards = live.map(liveCard);

  // Enquiry fallback: an un-published shoot type enquires on WhatsApp rather than inventing a
  // price. PHOTOGRAPHY_SHOOTS is empty since 2026-09-25 (only real bookable packages show), but
  // the loop stays so re-adding a shoot type needs no rewiring.
  const enquire = (title: string) =>
    whatsappUrl(
      `Hi ${SITE.operator}! I’m interested in the “${title}” photography package in Mauritius. Could you send availability and prices?`,
      waNumber,
    );
  const used = new Set<string>();
  const fallback = PHOTOGRAPHY_SHOOTS.map((p): V3Package | null => {
    const title = t(p.title);
    const existing = live.find(
      (a) => !used.has(a.id) && (matchesPhotographyShoot(p, a) || a.title === title),
    );
    if (existing) {
      used.add(existing.id);
      return null;
    }
    return {
      key: p.key,
      group: 'shoots',
      title,
      summary: t(p.summary),
      image: p.image,
      imageAlt: title,
      durationLabel: null,
      peopleLabel: null,
      bullets: [],
      priceEur: null,
      href: enquire(title),
      external: true,
      bestSeller: false,
      occasions: photographyOccasions({ title, summary: t(p.summary) }, null),
    };
  }).filter((p): p is V3Package => p !== null);

  return [...fallback, ...liveCards.filter((card) => !used.has(card.key))];
}

/** One slide of the hero collage — a gallery photo pinned to the best-matching live package. */
export interface V3HeroSlide {
  id: string;
  src: string;
  alt: string;
  /** Small chip on the stacked tiles: the package's title. */
  short: string;
  /** Caption eyebrow: the matching occasion or group label. */
  tag: string;
  href: string | null;
  external: boolean;
  priceLabel: string | null;
}

/**
 * The hero collage slides: the admin-managed gallery photos (or the built-in stand-ins), each
 * linked to the best-matching live package. Matching scores the package's group and occasions
 * against the photo's gallery tags; no match (or no packages at all) still renders the photo,
 * just without a price or link. Image items only — videos can't fill a tile.
 */
export function buildHeroSlides(
  t: T,
  photos: PhotographyPhoto[],
  packages: V3Package[],
  occasionLabels: Record<PhotographyOccasion, string>,
): V3HeroSlide[] {
  const images = buildGalleryItems(t, photos)
    .filter((item) => item.kind === 'image')
    .slice(0, 5);
  const tagLabel: Record<GalleryTag, string> = {
    weddings: t('wedding'),
    films: t('film'),
    couples: t('couple'),
    family: t('family'),
  };
  const score = (p: V3Package, item: (typeof images)[number]): number => {
    const tags = item.categories;
    let s = 0;
    if (p.group === 'weddings') {
      if (tags.includes('weddings')) s += 3;
      if (tags.includes('films')) s += 2;
    } else {
      if (p.occasions.includes('family') && tags.includes('family')) s += 3;
      if (
        (p.occasions.includes('couple') || p.occasions.includes('proposal')) &&
        tags.includes('couples')
      )
        s += 3;
      if (p.occasions.includes('solo') && tags.includes('couples')) s += 1;
    }
    return s;
  };
  return images.map((item) => {
    const [best] = [...packages].sort((a, b) => score(b, item) - score(a, item));
    const matched = best && score(best, item) > 0 ? best : (packages[0] ?? null);
    const firstTag = item.categories[0];
    return {
      id: String(item.key),
      src: item.thumb ?? item.src,
      alt: item.alt,
      short: matched?.title ?? item.alt,
      tag:
        matched && score(matched, item) > 0
          ? matched.group === 'weddings'
            ? t('Weddings')
            : (matched.occasions.map((o) => occasionLabels[o])[0] ?? t('Photoshoots'))
          : firstTag
            ? tagLabel[firstTag]
            : t('Photography'),
      href: matched?.href ?? null,
      external: matched?.external ?? false,
      priceLabel:
        matched != null
          ? matched.priceEur != null
            ? t('From €{n}', { n: Math.round(matched.priceEur) })
            : t('Price on request')
          : null,
    };
  });
}
