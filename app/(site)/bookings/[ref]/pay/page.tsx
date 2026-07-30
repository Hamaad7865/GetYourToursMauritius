import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { ChargeNotice } from '@/components/checkout/ChargeNotice';
import { EmbeddedCheckout } from '@/components/checkout/EmbeddedCheckout';
import { PayPageFallback } from '@/components/checkout/PayPageFallback';
import { PeachWidgetPreload } from '@/components/checkout/PeachWidgetPreload';
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
      {/* Starts the script fetch from the server response, without waiting for EmbeddedCheckout
          (a client component) to hydrate and append the tag itself. */}
      <PeachWidgetPreload />
      <GygHeader sticky showSearch={false} />
      <main className="min-h-[60vh] bg-white">
        <div className="mx-auto max-w-xl px-6 py-10">
          <h1 className="font-display text-2xl font-semibold text-ink">
            {t('Complete your payment')}
          </h1>
          {/* The card is charged in MUR (the EUR price converted at the server-pinned rate). This is
              the screen where the card number is typed, so the charge is disclosed HERE — exact
              figure when the minting page handed it over, currency-only otherwise. */}
          <ChargeNotice bookingRef={ref} />

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
