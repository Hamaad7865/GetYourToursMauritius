import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { EmbeddedCheckout } from '@/components/checkout/EmbeddedCheckout';
import { getPeachWidgetConfig } from '@/lib/payments';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Complete your payment',
  robots: { index: false, follow: false },
};

/**
 * Embedded payment step. The checkout was created server-side at /api/v1/payments and its id arrives
 * as `?cid=`; here we mount the Peach widget with it. Booking confirmation comes from the verified
 * webhook — this page just collects the card and hands the customer back to their booking.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ cid?: string }>;
}) {
  const { ref } = await params;
  const { cid } = await searchParams;
  const widget = getPeachWidgetConfig();
  const t = await getT();
  const returnUrl = `/bookings/${ref}`;

  return (
    <>
      <GygHeader sticky showSearch={false} />
      <main className="min-h-[60vh] bg-white">
        <div className="mx-auto max-w-xl px-6 py-10">
          <h1 className="font-display text-2xl font-semibold text-ink">{t('Complete your payment')}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t('You will be charged in EUR')}</p>

          <div className="mt-6">
            {cid && widget ? (
              <EmbeddedCheckout
                scriptUrl={widget.scriptUrl}
                entityId={widget.entityId}
                checkoutId={cid}
                returnUrl={returnUrl}
              />
            ) : (
              <div className="rounded-xl border border-coral/30 bg-coral/5 p-4">
                <p role="alert" className="text-sm font-medium text-coral">
                  {t('We could not start this payment. Please go back and try again.')}
                </p>
                <a
                  href={returnUrl}
                  className="mt-3 inline-block text-sm font-bold text-teal hover:text-teal-dark"
                >
                  {t('Back to your booking')}
                </a>
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
