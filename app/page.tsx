import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { GygHero } from '@/components/gyg/GygHero';
import { HomeShowcase } from '@/components/gyg/HomeShowcase';
import { HomeShowcaseProvider } from '@/components/gyg/HomeShowcaseContext';
import { SiteFooter } from '@/components/site/SiteFooter';
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

  // A few real activity photos (up to two per activity, deduped) for the hero's decorative pile.
  const gallery: { url: string; alt: string }[] = [];
  const seen = new Set<string>();
  for (const a of activities) {
    const imgs = a.images.length ? a.images : a.heroImage ? [a.heroImage] : [];
    for (const img of imgs.slice(0, 2)) {
      if (img.url && !seen.has(img.url)) {
        seen.add(img.url);
        gallery.push({ url: img.url, alt: a.title });
      }
    }
    if (gallery.length >= 5) break;
  }

  return (
    <HomeShowcaseProvider>
      <GygHeader heroMode />
      <GygHero gallery={gallery.slice(0, 5)} />
      <main className="bg-white pb-14">
        <HomeShowcase activities={activities} />
      </main>
      <SiteFooter />
    </HomeShowcaseProvider>
  );
}
