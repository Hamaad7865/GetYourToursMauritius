import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import { GygHeader } from '@/components/gyg/GygHeader';
import { HomeShowcaseProvider } from '@/components/gyg/HomeShowcaseContext';
import { HomeHero } from '@/components/gyg/home/HomeHero';
import { ContinuePlanning } from '@/components/gyg/home/ContinuePlanning';
import { ContinuePlanningReserve } from '@/components/gyg/home/ContinuePlanningReserve';
import { HomeTours } from '@/components/gyg/home/HomeTours';
import { HomeRails } from '@/components/gyg/home/HomeRails';
import { WhyDirect } from '@/components/gyg/home/WhyDirect';
import { SiteFooter } from '@/components/site/SiteFooter';
import { FeaturedReviews } from '@/components/site/FeaturedReviews';
import { PopularSearches } from '@/components/site/PopularSearches';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { homePicks } from '@/lib/services/home-picks';
import { getLocale } from '@/lib/i18n/server';
import type { Locale } from '@/lib/i18n/config';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import type { HomePicks } from '@/lib/validation/home-picks';
import type { TourSummary } from '@/lib/validation/tours';

export const runtime = 'edge';

const DEFAULT_METADATA: Metadata = {
  // `absolute` so the root layout's "%s | Belle Mare Tours" template doesn't push the homepage
  // title past a sensible SERP length.
  title: { absolute: 'Belle Mare Tours — Mauritius Tours, Activities & Airport Taxi' },
  description:
    'Book Mauritius tours direct with the local operator: catamaran cruises, dolphin swims, island day tours and airport taxi transfers. Fixed prices, no markup.',
  keywords: [
    'Mauritius tours',
    'tours in Mauritius',
    'Belle Mare Tours',
    'Mauritius activities',
    'things to do in Mauritius',
    'Mauritius sightseeing tours',
    'taxi Mauritius',
    'airport taxi Mauritius',
    'Mauritius excursions',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/`,
    title: 'Belle Mare Tours — Mauritius Tours, Activities & Airport Taxi',
    description:
      'Book Mauritius tours, activities, sightseeing and airport taxi transfers direct with Belle Mare Tours — transparent pricing, instant confirmation, no reseller markup.',
    // `locale` itself is set below in generateMetadata (via overrideMetadata) once the visitor's
    // language is known; `alternateLocale` is fixed here at the OTHER language, i.e. 'fr_FR' unless
    // the visitor is already French.
    alternateLocale: 'fr_FR',
    images: [OG_IMAGE],
  },
};

async function getActivities(locale: Locale): Promise<TourSummary[]> {
  try {
    const { items } = await searchActivities(publicServiceContext(locale), {
      page: 1,
      pageSize: 100,
    });
    // The homepage's cards only ever draw one photo each, but a summary carries the tour's whole
    // gallery (up to 20). Dropping the rest keeps them out of the HTML sent to every visitor.
    return items.map((a) => ({ ...a, images: a.heroImage ? [] : a.images.slice(0, 1) }));
  } catch (error) {
    console.error('[home] catalogue fetch failed', error);
    return [];
  }
}

/** The first row's shared picks. A failure renders today's private-tours row, never an error page. */
async function getPicks(locale: Locale): Promise<HomePicks | null> {
  try {
    return await homePicks(publicServiceContext(locale));
  } catch (error) {
    console.error('[home] picks fetch failed', error);
    return null;
  }
}

/**
 * The homepage, in GetYourGuide's order: header, a hero that is just a line and a search field,
 * then what the visitor is most likely to want next.
 *
 * It has two states, and the server only ever renders the first. Under the hero, every visitor gets
 * the row chooseHomeRow picks for them (most booked by default). A returning one gets "Continue
 * planning your trip" above it — resolved in the browser from what they viewed, saved or left in
 * their cart, because this page is edge-cached and identical for everyone (see ContinuePlanning).
 */
export default async function HomePage() {
  const locale = await getLocale();
  // Together, not one after the other: each is a round trip to the database.
  const [activities, picks] = await Promise.all([getActivities(locale), getPicks(locale)]);

  return (
    <HomeShowcaseProvider activities={activities}>
      <GygHeader searchDocksOnScroll />
      <main className="bg-white pb-14">
        <HomeHero />
        <ContinuePlanning />
        {/* Must directly follow the rail it reserves space for. */}
        <ContinuePlanningReserve />
        <HomeTours activities={activities} picks={picks} />
        <HomeRails />
        <WhyDirect />
        <FeaturedReviews />
        <PopularSearches />
      </main>
      <SiteFooter />
    </HomeShowcaseProvider>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const metadata: Metadata = {
    ...DEFAULT_METADATA,
    openGraph: {
      ...DEFAULT_METADATA.openGraph,
      alternateLocale: locale === 'fr' ? 'en_GB' : 'fr_FR',
    },
  };
  return overrideMetadata('/', metadata);
}
