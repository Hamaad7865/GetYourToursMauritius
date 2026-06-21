import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Checkout } from '@/components/checkout/Checkout';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const t = await getT();
  return (
    <Suspense fallback={<p className="py-20 text-center text-sm text-ink-muted">{t('Loading…')}</p>}>
      <Checkout />
    </Suspense>
  );
}
