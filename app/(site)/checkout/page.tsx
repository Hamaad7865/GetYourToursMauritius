import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Checkout } from '@/components/checkout/Checkout';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <Suspense fallback={<p className="py-20 text-center text-sm text-ink-muted">Loading…</p>}>
      <Checkout />
    </Suspense>
  );
}
