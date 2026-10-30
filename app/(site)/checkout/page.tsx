import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Checkout } from '@/components/checkout/Checkout';
import { PeachWidgetPreload } from '@/components/checkout/PeachWidgetPreload';
import { getT } from '@/lib/i18n/server';
import { getChargeCurrency } from '@/lib/settings/charge-currency';
import { readGuestCheckoutConfig } from '@/lib/settings/guest-checkout';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  // In parallel: two independent reads (landmines.md, "Read the database once per page, and in
  // parallel"). The charge currency only picks which notes the payment step shows; the guest config
  // decides whether step ② offers guest checkout or the account gate.
  const [t, chargeCurrency, guestCheckout] = await Promise.all([
    getT(),
    getChargeCurrency(),
    readGuestCheckoutConfig(),
  ]);
  return (
    <>
      {/* Warm Peach's checkout.js origin now — the pay step is one click away. */}
      <PeachWidgetPreload />
      <Suspense
        fallback={<p className="py-20 text-center text-sm text-ink-muted">{t('Loading…')}</p>}
      >
        <Checkout chargeCurrency={chargeCurrency} guestCheckout={guestCheckout} />
      </Suspense>
    </>
  );
}
