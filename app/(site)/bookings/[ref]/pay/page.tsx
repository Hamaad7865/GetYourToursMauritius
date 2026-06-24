import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { EmbeddedCheckout } from '@/components/checkout/EmbeddedCheckout';
import { PayPageFallback } from '@/components/checkout/PayPageFallback';
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
              // No `cid` — a returning customer reached this page via the email link / a new tab, so no
              // checkout session was ever minted. Auto-mint one (POST /api/v1/payments) and redirect to
              // ?cid=… rather than show a cold dead-end. Already-paid bookings get a friendly note.
              <PayPageFallback bookingRef={ref} returnUrl={returnUrl} />
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
