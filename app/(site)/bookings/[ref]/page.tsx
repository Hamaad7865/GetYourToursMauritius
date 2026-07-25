import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { BookingConfirmation } from '@/components/gyg/detail/BookingConfirmation';
import { PeachWidgetPreload } from '@/components/checkout/PeachWidgetPreload';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Your booking',
  robots: { index: false, follow: false },
};

export default async function BookingPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return (
    <>
      {/* An unpaid booking shows "Complete payment", which lands on the widget — warm it now. */}
      <PeachWidgetPreload />
      <GygHeader sticky showSearch={false} />
      <main className="min-h-[60vh] bg-white">
        <div className="mx-auto max-w-shell px-6">
          <Suspense fallback={<p className="py-16 text-center text-sm text-ink-muted">Loading…</p>}>
            <BookingConfirmation bookingRef={ref} />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
