import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { QuoteInstallmentPayButton } from '@/components/quotes/QuoteInstallmentPayButton';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { LOCALE_HEADER } from '@/lib/i18n/routing';
import {
  QUOTE_INSTALLMENT_TOKEN_COOKIE,
  installmentSeqLooksValid,
  quoteInstallmentOpenPath,
  quoteInstallmentPagePath,
} from '@/lib/quotes/link-cookie';
import { resolveInstallmentForToken } from '@/lib/quotes/resolve';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Pay for your trip',
  robots: { index: false, follow: false },
};

/** `EUR 180.00` — the same plain shape the quote page and email print. */
function money(currency: string, minorAmount: number): string {
  return `${currency} ${(minorAmount / 100).toFixed(2)}`;
}

/**
 * A durable per-installment payment page — the other end of the dated reminder link.
 *
 * The installment analogue of the balance page: the reminder's link is /quotes/{ref}/i/{seq}?t=…, and a
 * raw `?t=` is redirected through the /i/{seq}/open route (token → httpOnly cookie → clean page) so GTM
 * and the client-error reporter never carry the credential. {@link resolveInstallmentForToken} is the
 * whole of the authorization (service-role client, RLS-immune) and answers null for every refusal —
 * unknown ref/seq, wrong/absent token, a not-confirmed booking, and an installment already covered — so
 * this page has ONE branch. Nothing is minted until the guest clicks Pay. English-only, matching the
 * deposit and balance pages.
 */
export default async function QuoteInstallmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string; seq: string }>;
  searchParams: Promise<{ t?: string | string[]; just_paid?: string | string[] }>;
}) {
  const { ref, seq } = await params;
  const { t, just_paid: justPaidParam } = await searchParams;
  if (!installmentSeqLooksValid(seq)) notFound();
  const seqNum = Number(seq);

  // A raw `?t=` link: bounce through the open route before any HTML exists, so nothing renders the token.
  if (typeof t === 'string' && t.length > 0) redirect(quoteInstallmentOpenPath(ref, seqNum, t));

  // A language switch would drop the cookie's Path — bounce to the canonical page (English-only anyway).
  const urlLocale = (await headers()).get(LOCALE_HEADER);
  if (isLocale(urlLocale) && urlLocale !== DEFAULT_LOCALE)
    redirect(quoteInstallmentPagePath(ref, seqNum));

  const token = (await cookies()).get(QUOTE_INSTALLMENT_TOKEN_COOKIE)?.value ?? '';
  const inst = await resolveInstallmentForToken(ref, seqNum, token);
  if (!inst) notFound();

  // "A card was submitted" — never "it worked" (a quote guest cannot self-confirm). Only changes the wait wording.
  const justPaid = typeof justPaidParam === 'string' && justPaidParam.length > 0;

  return (
    <>
      <GygHeader sticky showSearch={false} />
      <main className="min-h-[60vh] bg-white">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="font-display text-2xl font-semibold text-ink">
            Pay for your trip — {inst.ref}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Hi {inst.customerName}, this is the payment due for <strong>{inst.label}</strong>.
          </p>

          <div className="mt-7 flex items-center justify-between gap-4 border-t border-ink/10 py-4">
            <p className="text-[15px] font-bold text-ink">Amount due</p>
            <p className="whitespace-nowrap text-[15px] font-bold text-ink">
              {money(inst.currency, inst.chargeMinor)}
            </p>
          </div>

          {justPaid ? (
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
              <p className="text-sm font-bold text-ink">Your payment has not completed yet.</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                If your bank has taken it, it can take a moment to reach us — reload this page in a
                minute and it will say so. If it did not go through, you can try again below.
              </p>
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-muted">
              Your booking is confirmed. Paying this settles {inst.label} — the rest of your trip is
              collected the same way, before each activity.
            </p>
          )}

          <div className="mt-7">
            <QuoteInstallmentPayButton
              quoteRef={inst.ref}
              seq={inst.seq}
              amountLabel={money(inst.currency, inst.chargeMinor)}
            />
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
