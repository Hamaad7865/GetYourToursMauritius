import type { Metadata } from 'next';
import Link from 'next/link';
import { GygHeader } from '@/components/gyg/GygHeader';
import { GygHero } from '@/components/gyg/GygHero';
import { CategoryShowcase } from '@/components/gyg/CategoryShowcase';
import { Rail } from '@/components/gyg/Rail';
import { PlaceCard } from '@/components/gyg/PlaceCard';
import { SiteFooter } from '@/components/site/SiteFooter';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { FALLBACK_CATEGORIES } from '@/lib/categories/categories';
import { IconArrowRight } from '@/components/ui/icons';
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
  // Group by the categories actually present, keeping the canonical order first and appending
  // any newly-created categories after it. (Avoids a server-side categories fetch.)
  const present = new Set(activities.map((a) => a.category));
  const known = FALLBACK_CATEGORIES.map((c) => c.name).filter((n) => present.has(n));
  const extra = [...present].filter((n) => !FALLBACK_CATEGORIES.some((c) => c.name === n));
  const byCategory = [...known, ...extra]
    .map((category) => ({
      category,
      items: activities.filter((a) => a.category === category),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      <GygHeader heroMode />
      <GygHero />

      <main className="bg-cream pb-12 pt-2">
        <CategoryShowcase pool={activities} />

        {byCategory.map((group) => (
          <section key={group.category} className="mx-auto max-w-shell px-6 py-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
                {group.category}
              </h2>
              <Link
                href={`/activities?category=${encodeURIComponent(group.category)}`}
                className="flex shrink-0 items-center gap-1 text-sm font-bold text-teal hover:text-teal-dark"
              >
                See all <IconArrowRight width={16} height={16} />
              </Link>
            </div>
            <Rail ariaLabel={group.category}>
              {group.items.map((activity) => (
                <PlaceCard key={activity.id} activity={activity} rail />
              ))}
            </Rail>
          </section>
        ))}

        {byCategory.length === 0 && (
          <div className="mx-auto max-w-shell px-6 py-16">
            <div className="rounded-2xl border border-teal/20 bg-white/60 p-10 text-center text-sm text-ink-muted">
              Experiences appear here once the catalogue is connected.
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </>
  );
}
