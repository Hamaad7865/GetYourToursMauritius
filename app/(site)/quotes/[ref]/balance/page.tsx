import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { QuoteBalancePayButton } from '@/components/quotes/QuoteBalancePayButton';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { LOCALE_HEADER } from '@/lib/i18n/routing';
import {
  QUOTE_BALANCE_TOKEN_COOKIE,
  quoteBalanceOpenPath,
  quoteBalancePagePath,
} from '@/lib/quotes/link-cookie';
import { resolveBalanceForToken } from '@/lib/quotes/resolve';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Pay your balance',
  // The page shows a named guest what they owe. Never indexed, and `follow: false` so the links on it
  // are not walked either — same stance as the quote and pay pages.
  robots: { index: false, follow: false },
};

/**
 * The DURABLE balance page — the other end of the link staff send after a deposit is paid.
 *
 * THE TOKEN IS NEVER IN THIS PAGE'S RENDERED URL. The operator's link is /quotes/{ref}/balance?t=…, but
 * a raw `?t=` is redirected to GET /api/v1/quotes/{ref}/balance/open, which moves the token into an
 * httpOnly cookie and 302s back here clean — so GTM's `page_location` pings and the client-error
 * reporter's `window.location.href` never carry the credential. The mirror of the deposit /quotes/{ref}
 * page; src/lib/quotes/link-cookie.ts has the full reasoning.
 *
 * The guest has no account, so {@link resolveBalanceForToken} is the whole of the authorization (it
 * runs with the service-role client, which bypasses RLS). It answers null for every refusal — unknown
 * ref, wrong/absent token, no booking, a not-confirmed booking, and a fully-paid one — so this page has
 * exactly ONE branch. A different response per case would tell a prober which quote refs exist.
 *
 * Nothing is minted until the guest clicks Pay: the balance checkout is created on the click, in the
 * route the button posts to, so the link is DURABLE — it works for as long as the balance is owed, no
 * matter how long after staff sent it.
 *
 * Deliberately NOT localised, matching the deposit page and src/lib/email/quote.ts: the balance link is
 * English-only, so a French page under it would be the odd half.
 */

/** `EUR 900.00` — the same plain shape the quote page and email print. */
function money(currency: string, minorAmount: number): string {
  return `${currency} ${(minorAmount / 100).toFixed(2)}`;
}

export default async function QuoteBalancePage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  /** `?t=` repeated (`?t=a&t=b`) arrives as an ARRAY, so the type is not narrowed to a string here. */
  searchParams: Promise<{ t?: string | string[]; just_paid?: string | string[] }>;
}) {
  const { ref } = await params;
  const { t, just_paid: justPaidParam } = await searchParams;

  // A hand-built or pre-cookie `?t=` link: bounce it through the balance open route rather than render
  // a page whose URL carries a bearer credential. `redirect()` throws before any HTML exists, so
  // nothing is rendered, no GTM tag loads, and no `window.location.href` is ever set to this URL. FIRST,
  // before the locale bounce below (that one drops the query string).
  if (typeof t === 'string' && t.length > 0) redirect(quoteBalanceOpenPath(ref, t));

  // A language-button click would otherwise 404 this page: the cookie is scoped `Path=/quotes/{ref}/
  // balance`, so it is NOT sent to `/fr/quotes/{ref}/balance`; middleware rewrites that back here,
  // `cookies()` comes up empty and the page 404s a live balance whose only recovery is the sent link.
  // Bounce to the canonical path instead — the redirected request IS under the cookie's Path. Matches
  // the deposit page's deliberate English-only stance.
  const urlLocale = (await headers()).get(LOCALE_HEADER);
  if (isLocale(urlLocale) && urlLocale !== DEFAULT_LOCALE) redirect(quoteBalancePagePath(ref));

  const token = (await cookies()).get(QUOTE_BALANCE_TOKEN_COOKIE)?.value ?? '';
  const balance = await resolveBalanceForToken(ref, token);
  if (!balance) notFound();

  // The guest has just come back from the card form. EmbeddedCheckout appends `?just_paid=1` whenever
  // it could not confirm the payment itself — which for a quote guest is ALWAYS, since
  // /api/v1/payments/sync needs a bearer token and they have no account — so it means "a card was
  // submitted", never "it worked": a declined card and an abandoned 3-D Secure step arrive back
  // carrying the identical `1`. It is used for ONE thing only: the wording of the wait. The balance is
  // still owed (the webhook lands a beat later), so the Pay button stays too.
  const justPaid = typeof justPaidParam === 'string' && justPaidParam.length > 0;

  return (
    <>
      <GygHeader sticky showSearch={false} />
      <main className="min-h-[60vh] bg-white">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="font-display text-2xl font-semibold text-ink">
            Pay your balance for {balance.ref}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Hi {balance.customerName}, your booking is confirmed. This is the balance still to pay.
          </p>

          <div className="mt-7 flex items-center justify-between gap-4 border-t border-ink/10 py-4">
            <p className="text-[15px] font-bold text-ink">Balance due</p>
            <p className="whitespace-nowrap text-[15px] font-bold text-ink">
              {money(balance.currency, balance.balanceDueMinor)}
            </p>
          </div>

          {justPaid ? (
            /* STRAIGHT OFF THE CARD FORM, WITH NOTHING TO SHOW FOR IT YET. Either the payment is still
               settling (the webhook lands a moment later) or the card was declined / the 3-D Secure step
               was abandoned — and this page cannot tell those apart, so it says exactly that. The pay
               button stays: for the declined guest it is the only way left to pay, and this is a durable
               link they can come back to. */
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
              <p className="text-sm font-bold text-ink">Your payment has not completed yet.</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                If your bank has taken it, it can take a moment to reach us — reload this page in a
                minute and it will say so. If it did not go through, you can try again below.
              </p>
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-muted">
              Your deposit has been received and your seat is reserved. Paying the balance settles
              your booking in full.
            </p>
          )}

          <div className="mt-7">
            <QuoteBalancePayButton quoteRef={balance.ref} />
          </div>

          <p className="mt-6 text-[13px] leading-relaxed text-ink-muted">
            Something to change? Reply to the message we sent you, or contact us at{' '}
            <a href={`mailto:${SITE.email}`} className="font-medium text-teal hover:text-teal-dark">
              {SITE.email}
            </a>{' '}
            or {SITE.phone}.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
