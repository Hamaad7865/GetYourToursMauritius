import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { CartView } from '@/components/cart/CartView';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export const metadata: Metadata = {
  // absolute: the title already names the brand — stop the root "%s | Belle Mare Tours" template doubling it.
  title: { absolute: `Your cart | ${SITE.operator}` },
  description: 'The activities in your Belle Mare Tours cart.',
  alternates: { canonical: '/cart' },
  robots: { index: false, follow: true },
};

export default function CartPage() {
  return (
    <>
      <GygHeader />
      <main className="bg-white">
        <div className="mx-auto max-w-shell px-6">
          <CartView />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
