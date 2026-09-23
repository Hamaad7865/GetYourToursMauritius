import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { getLocale } from '@/lib/i18n/server';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import {
  PHOTOGRAPHY_CATEGORY,
  isPhotographyCategory,
  photographyGroup,
} from '@/lib/catalogue/photography';
import type { TourSummary } from '@/lib/validation/tours';
import type { PhotoPackage } from './PackagesSection';

/** Stand-in photography (licensed Unsplash stock under /public/photography, plus our own island
 *  shots) until the team's own work replaces it. */
export const PHOTO_IMG = {
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

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The package cards both /photography and /photography/packages render. Live packages link to their
 * own /activities/<slug> page (dates, extra guests, add-ons, checkout). With none published yet the
 * built-in set renders as WhatsApp enquiries, so the page is never a dead end.
 */
export function buildPackageCards(t: T, live: TourSummary[], waNumber: string): PhotoPackage[] {
  const hours = (minutes: number | null) =>
    minutes ? t('{n} hours', { n: Math.round((minutes / 60) * 10) / 10 }) : null;

  if (live.length > 0) {
    const weddings = live.filter((a) => photographyGroup(a) === 'weddings');
    const shoots = live.filter((a) => photographyGroup(a) === 'shoots');
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
