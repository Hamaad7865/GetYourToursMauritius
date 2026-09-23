import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { getLocale } from '@/lib/i18n/server';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { createUserClient } from '@/lib/supabase/client';
import {
  PHOTOGRAPHY_CATEGORY,
  PHOTO_STOCK,
  isPhotographyCategory,
  photographyGroup,
  savedPhotographyGroup,
  type PhotographyGroup,
} from '@/lib/catalogue/photography';
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
  const hours = (minutes: number | null) =>
    minutes ? t('{n} hours', { n: Math.round((minutes / 60) * 10) / 10 }) : null;

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
  const fallback = (
    key: string,
    group: PhotoPackage['group'],
    title: string,
    meta: string,
    summary: string,
    features: string[],
    image: string,
    highlight = false,
  ): PhotoPackage => ({
    key,
    group,
    title,
    meta,
    features,
    summary,
    image,
    imageAlt: title,
    priceEur: null,
    href: enquire(title),
    external: true,
    highlight,
  });
  return [
    fallback(
      'ceremony-photo',
      'weddings',
      t('Ceremony · Photo'),
      t('4 hours · 1 photographer'),
      t('Your vows, the portraits and the first toast, told in stills.'),
      [t('Edited high-resolution photos'), t('Private online gallery'), t('Location scouting')],
      PHOTO_IMG.weddingDetail,
    ),
    fallback(
      'ceremony-photo-film',
      'weddings',
      t('Ceremony · Photo + Film'),
      t('6 hours · photographer + videographer'),
      t('Photos and a cinematic film of the day, from the aisle to the sunset.'),
      [
        t('Edited high-resolution photos'),
        t('Cinematic film + short teaser'),
        t('Drone aerials, where permitted'),
      ],
      PHOTO_IMG.weddingCouple,
      true,
    ),
    fallback(
      'full-day',
      'weddings',
      t('Full day · Photo + Film'),
      t('10 hours · 2 photographers + videographer'),
      t('Every moment covered, from getting ready to the last dance.'),
      [t('Getting ready to first dance'), t('Feature film + teaser'), t('Printed album available')],
      PHOTO_IMG.weddingSunset,
    ),
    fallback(
      'couples',
      'shoots',
      t('Couples session'),
      t('1 hour · 1 beach'),
      t('Relaxed, romantic photos for honeymoons, anniversaries and proposals.'),
      [t('Sunrise or golden hour'), t('Honeymoon & proposal friendly'), t('Online gallery')],
      PHOTO_IMG.couple,
    ),
    fallback(
      'island-holiday',
      'shoots',
      t('Island holiday session'),
      t('2 hours · 2 locations'),
      t('Two island backdrops and a short reel to remember the trip.'),
      [t('Two island backdrops'), t('Vertical reel for social'), t('Online gallery')],
      PHOTO_IMG.islet,
      true,
    ),
    fallback(
      'family',
      'shoots',
      t('Family & kids'),
      t('1 hour · up to 8 people'),
      t('Easy-going family portraits on the beach, at your hotel or villa.'),
      [t('Kid-paced, no stiff poses'), t('Beach, hotel or villa'), t('Online gallery')],
      PHOTO_IMG.family,
    ),
  ];
}
