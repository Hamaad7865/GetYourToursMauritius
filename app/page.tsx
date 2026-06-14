import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Hero } from '@/components/marketing/Hero';
import { WhyBookDirect } from '@/components/marketing/WhyBookDirect';
import { CategoryChips } from '@/components/catalogue/CategoryChips';
import { ActivityGrid } from '@/components/catalogue/ActivityGrid';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import type { TourSummary } from '@/lib/validation/tours';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Belle Mare Tours & Mauritius East-Coast Activities',
  description:
    "Book Belle Mare Tours direct: catamaran cruises to Île aux Cerfs, dolphin swims, undersea walks, parasailing and island day tours across Mauritius's east coast. Instant confirmation, no reseller markup.",
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    title: 'Belle Mare Tours & Mauritius East-Coast Activities',
    description:
      'The official booking platform of Belle Mare Tours — booked direct, no reseller markup.',
    locale: 'en_GB',
    alternateLocale: 'fr_FR',
  },
};

async function getFeaturedActivities(): Promise<TourSummary[]> {
  try {
    const { items } = await searchActivities(publicServiceContext(), { page: 1, pageSize: 12 });
    return items;
  } catch (error) {
    console.error('[home] catalogue fetch failed', error);
    return [];
  }
}

export default async function HomePage() {
  const activities = await getFeaturedActivities();

  return (
    <>
      <SiteHeader />
      <Hero />
      <main>
        <section className="relative z-10 bg-cream">
          <div className="mx-auto max-w-shell px-6">
            <CategoryChips />
          </div>
        </section>

        <section className="bg-cream">
          <div className="mx-auto max-w-shell px-6 pb-16">
            <div className="mb-6 mt-2">
              <h2 className="m-0 font-display text-3xl font-medium tracking-tight text-ink">
                All activities
              </h2>
              <p className="mt-1.5 text-sm text-ink-muted">
                {activities.length > 0 ? `${activities.length} experiences` : 'Experiences'}{' '}
                operated by Belle Mare Tours · East-coast Mauritius
              </p>
            </div>
            <ActivityGrid activities={activities} />
          </div>
        </section>

        <WhyBookDirect />
      </main>
      <SiteFooter />
    </>
  );
}
