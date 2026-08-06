import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { ChargeNotice } from '@/components/checkout/ChargeNotice';
import { EmbeddedCheckout } from '@/components/checkout/EmbeddedCheckout';
import { PayPageFallback } from '@/components/checkout/PayPageFallback';
import { PeachWidgetPreload } from '@/components/checkout/PeachWidgetPreload';
import { getPeachWidgetConfig } from '@/lib/payments';
import { safeReturnPath } from '@/lib/checkout/return-path';
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
 *
 * `?return=` overrides where "back" is, and exists for the guest who paid a QUOTE. The default,
 * /bookings/{ref}, only renders for the booking's owner: BookingConfirmation fetches with a bearer
 * token and otherwise says "Sign in to view booking …". A quote guest has no account by definition, so
 * without this they are charged and then shown a sign-in wall. It is pinned to a same-origin relative
 * path by {@link safeReturnPath} — an unvalidated redirect target on the screen right after a card
 * number is typed is an open door to a convincing phishing page.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ cid?: string; return?: string | string[] }>;
}) {
  const { ref } = await params;
  const { cid, return: requestedReturn } = await searchParams;
  const widget = getPeachWidgetConfig();
  const t = await getT();
  const returnUrl = safeReturnPath(requestedReturn, `/bookings/${ref}`);

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
                // Where "Try again" goes when the widget never came up — THIS page, minus the ?cid, so
                // PayPageFallback mints a fresh session. It is passed separately from `returnUrl`
                // because they stopped being the same thing when `?return=` arrived: a quote guest's
                // return is /quotes/{ref}, and /quotes/{ref}/pay is not a route.
                retryUrl={`/bookings/${ref}/pay`}
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
