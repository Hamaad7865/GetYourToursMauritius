import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { getLocale } from '@/lib/i18n/server';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { createUserClient } from '@/lib/supabase/client';
import {
  PHOTOGRAPHY_CATEGORY,
  PHOTO_STOCK,
  PHOTOGRAPHY_STARTER_PACKAGES,
  isPhotographyCategory,
  mediaThumb,
  photographyGroup,
  photosIn,
  savedPhotographyGroup,
  type PhotographyGroup,
  type PhotographyPhoto,
} from '@/lib/catalogue/photography';
import type { GalleryItem } from './GalleryGrid';
import type { TourSummary } from '@/lib/validation/tours';
import type { PhotoPackage } from './PackagesSection';

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

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The package cards both /photography and /photography/packages render. Live packages link to their
 * own /activities/<slug> page (dates, extra guests, add-ons, checkout). With none published yet the
 * built-in set renders as WhatsApp enquiries, so the page is never a dead end.
 */
export function buildPackageCards(
  t: T,
  live: TourSummary[],
  waNumber: string,
  groups: Record<string, PhotographyGroup> = {},
): PhotoPackage[] {
  const hours = (minutes: number | null) => {
    if (!minutes) return null;
    const n = Math.round((minutes / 60) * 10) / 10;
    return n === 1 ? t('{n} hour', { n }) : t('{n} hours', { n });
  };

  if (live.length > 0) {
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
    });
    return [
      ...weddings.map((a, i) => toCard(a, 'weddings', i, weddings.length)),
      ...shoots.map((a, i) => toCard(a, 'shoots', i, shoots.length)),
    ];
  }

  const enquire = (title: string) =>
    whatsappUrl(
      `Hi ${SITE.operator}! I’m interested in the “${title}” photography package in Mauritius. Could you send availability and prices?`,
      waNumber,
    );
  // No package published yet: the six examples, as WhatsApp enquiries. The same list /admin imports
  // as editable drafts (PHOTOGRAPHY_STARTER_PACKAGES), so the owner edits exactly what is shown here.
  return PHOTOGRAPHY_STARTER_PACKAGES.map((p) => {
    const title = t(p.title);
    return {
      key: p.key,
      group: p.kind,
      title,
      meta: t(p.meta),
      features: p.features.map((f) => t(f)),
      summary: t(p.summary),
      image: p.image,
      imageAlt: title,
      priceEur: null,
      href: enquire(title),
      external: true,
      highlight: p.highlight,
    };
  });
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
  return [
    stock('weddingCouple', t('Bride and groom by the water'), ['weddings'], 'aspect-[4/5]'),
    stock('film2', t('Filming a wedding on the beach'), ['films'], 'aspect-video'),
    stock('couple', t('Couple on a Mauritius beach'), ['couples'], 'aspect-square'),
    stock('weddingDetail', t('Wedding details'), ['weddings'], 'aspect-[3/4]'),
    stock('family2', t('Family on the beach'), ['family'], 'aspect-[4/3]'),
    stock('aerial', t('Aerial view of a Mauritius lagoon'), ['films', 'weddings'], 'aspect-[4/5]'),
    stock('weddingSunset', t('Couple at sunset'), ['weddings'], 'aspect-[4/3]'),
    stock('family', t('Family holiday portrait'), ['family'], 'aspect-[3/4]'),
    stock('passe', t('Island backdrop for a couples shoot'), ['couples'], 'aspect-[4/3]'),
  ];
}
