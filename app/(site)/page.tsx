import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import { GygHeader } from '@/components/gyg/GygHeader';
import { GygHero } from '@/components/gyg/GygHero';
import { HomeShowcase } from '@/components/gyg/HomeShowcase';
import { HomeShowcaseProvider } from '@/components/gyg/HomeShowcaseContext';
import { SiteFooter } from '@/components/site/SiteFooter';
import { TrustStrip } from '@/components/site/TrustStrip';
import { FeaturedReviews } from '@/components/site/FeaturedReviews';
import { PopularSearches } from '@/components/site/PopularSearches';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import type { TourSummary } from '@/lib/validation/tours';

export const runtime = 'edge';

const DEFAULT_METADATA: Metadata = {
  // `absolute` so the root layout's "%s | Belle Mare Tours" template doesn't push the homepage
  // title past a sensible SERP length.
  title: { absolute: 'Belle Mare Tours — Mauritius Tours, Activities & Airport Taxi' },
  description:
    'Book Mauritius tours, activities and excursions direct with Belle Mare Tours: catamaran cruises, dolphin swims, island day tours, private sightseeing and airport taxi transfers. Transparent pricing, instant confirmation, no reseller markup.',
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
    locale: 'en_GB',
    alternateLocale: 'fr_FR',
    images: [OG_IMAGE],
  },
};

async function getActivities(): Promise<TourSummary[]> {
  try {
    const { items } = await searchActivities(publicServiceContext(), { page: 1, pageSize: 100 });
    return items;
  } catch (error) {
    console.error('[home] catalogue fetch failed', error);
    return [];
  }
}

export default async function HomePage() {
  const activities = await getActivities();

  return (
    <HomeShowcaseProvider>
      <GygHeader heroMode />
      <GygHero />
      <TrustStrip />
      <main className="bg-white pb-14">
        <HomeShowcase activities={activities} />
        <FeaturedReviews />
        <PopularSearches />
      </main>
      <SiteFooter />
    </HomeShowcaseProvider>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/', DEFAULT_METADATA);
}
