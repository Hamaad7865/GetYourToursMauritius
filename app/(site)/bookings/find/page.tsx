import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { FindBookingForm } from '@/components/booking/FindBookingForm';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Find my booking',
  robots: { index: false, follow: false },
};

/** How a guest with no account and no email to hand gets back to a booking. */
export default async function FindBookingPage() {
  const t = await getT();
  return (
    <>
      <GygHeader sticky showSearch={false} />
      <main className="min-h-[60vh] bg-white">
        <div className="mx-auto max-w-md px-6 py-14">
          <h1 className="font-display text-2xl font-semibold text-ink">{t('Find my booking')}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {t(
              'Booked as a guest? Enter your booking reference and the email you booked with, and we’ll email you a link. Your reference is in your confirmation email.',
            )}
          </p>
          <FindBookingForm />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
