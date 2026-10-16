import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Checkout } from '@/components/checkout/Checkout';
import { PeachWidgetPreload } from '@/components/checkout/PeachWidgetPreload';
import { getT } from '@/lib/i18n/server';
import { getChargeCurrency } from '@/lib/settings/charge-currency';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  // In parallel: two independent reads (landmines.md, "Read the database once per page, and in
  // parallel"). The charge currency only picks which notes the payment step shows.
  const [t, chargeCurrency] = await Promise.all([getT(), getChargeCurrency()]);
  return (
    <>
      {/* Warm Peach's checkout.js origin now — the pay step is one click away. */}
      <PeachWidgetPreload />
      <Suspense
        fallback={<p className="py-20 text-center text-sm text-ink-muted">{t('Loading…')}</p>}
      >
        <Checkout chargeCurrency={chargeCurrency} />
      </Suspense>
    </>
  );
}
