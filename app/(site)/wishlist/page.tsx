import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { WishlistView } from '@/components/wishlist/WishlistView';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { SITE } from '@/lib/seo/site';
import type { TourSummary } from '@/lib/validation/tours';

export const runtime = 'edge';

export const metadata: Metadata = {
  // absolute: the title already names the brand — stop the root "%s | Belle Mare Tours" template doubling it.
  title: { absolute: `Your wishlist | ${SITE.operator}` },
  description: 'The Belle Mare Tours activities you’ve saved to your wishlist.',
  alternates: { canonical: '/wishlist' },
  robots: { index: false, follow: true },
};

// The wishlist is a client-side set of slugs; fetch the catalogue so the page can render the
// saved activities as cards (the catalogue is small, so one pull is fine).
async function getActivities(): Promise<TourSummary[]> {
  try {
    const { items } = await searchActivities(publicServiceContext(), { page: 1, pageSize: 100 });
    return items;
  } catch (error) {
    console.error('[wishlist] catalogue fetch failed', error);
    return [];
  }
}

export default async function WishlistPage() {
  const activities = await getActivities();
  return (
    <>
      <GygHeader />
      <main className="bg-white">
        <div className="mx-auto max-w-shell px-6">
          <WishlistView activities={activities} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
