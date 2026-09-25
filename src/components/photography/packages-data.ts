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
  photographySpecs,
  photosIn,
  savedPhotographyGroup,
  type GalleryTag,
  type PhotographyGroup,
  type PhotographyPhoto,
} from '@/lib/catalogue/photography';
import type { GalleryItem } from './GalleryGrid';
import type { TourSummary } from '@/lib/validation/tours';
import type { PhotoPackage } from './PackagesSection';
import { PHOTOGRAPHY_SHOOTS, matchesPhotographyShoot } from '@/lib/catalogue/photography-shoots';

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
