import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { QuotePayButton } from '@/components/quotes/QuotePayButton';
import { QUOTE_TOKEN_COOKIE, quoteOpenPath } from '@/lib/quotes/link-cookie';
import { resolveQuoteForToken, type PublicQuoteLine } from '@/lib/quotes/resolve';
import { formatMauritiusDateTime } from '@/lib/invoice/mauritius-time';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Your quote',
  // The page shows a named guest their prices. Never indexed, and `follow: false` so the links on it
  // are not walked either — same stance as the pay page.
  robots: { index: false, follow: false },
};

/**
 * The PUBLIC quote page — the other end of the emailed link.
 *
 * THE TOKEN IS NEVER IN THIS PAGE'S URL. It arrives in the httpOnly cookie that
 * GET /api/v1/quotes/{ref}/open sets before redirecting here; src/lib/quotes/link-cookie.ts has the
 * full reasoning, but the short version is that app/layout.tsx renders GTM on every page (whose tags
 * fall back to cookieless pings carrying `page_location`) and src/lib/client-error-report.ts posts
 * `window.location.href` into `error_logs` — so a token in the query string would be handed to Google
 * and written to a staff-readable log table, undoing the point of storing only its hash.
 *
 * The guest has no account, so {@link resolveQuoteForToken} is the whole of the authorization (it runs
 * with the service-role client, which bypasses RLS). It answers null for every refusal — unknown ref,
 * wrong token, unsent draft, withdrawn offer, lapsed validity, a total with no lines behind it — so this
 * page has exactly ONE branch. That is deliberate: a different response per case would tell a prober
 * which quote refs exist, and the ref is the path segment of a link that gets forwarded.
 *
 * Nothing is reserved until it is paid. Conversion happens at PAY, in the route the button posts to,
 * so an offer the guest never accepts holds no capacity.
 *
 * Deliberately NOT localised, matching src/lib/email/quote.ts, which states the same reason: the
 * emailed quote is English-only, so a French page under an English email would be the odd half.
 */

/** `EUR 230.00` — the same plain shape the quote email prints, so the two figures read as one. */
function money(currency: string, minorAmount: number): string {
  return `${currency} ${(minorAmount / 100).toFixed(2)}`;
}

/** What the guest calls this line. A catalogue line carries a price label instead of free text. */
function lineLabel(line: PublicQuoteLine): string {
  return line.description?.trim() || line.priceLabel?.trim() || 'Quoted item';
}

/**
 * `2026-08-23 09:00 MUT` for a line that carries its own date; nothing when it does not.
 *
 * The shared formatter, not `Intl.DateTimeFormat({ timeZone: 'Indian/Mauritius' })`: this page runs
 * on the edge, where the ICU timezone database is not guaranteed to ship (see
 * src/lib/invoice/mauritius-time.ts). A custom line's `starts_at` is an instant, so printing the raw
 * UTC wall-clock would be four hours wrong — and a late-evening tour would read as the day before.
 */
function lineWhen(line: PublicQuoteLine): string {
  return formatMauritiusDateTime(line.startsAt);
}

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  /** `?t=` repeated (`?t=a&t=b`) arrives as an ARRAY, so the type is not narrowed to a string here. */
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { ref } = await params;
  const { t } = await searchParams;

  // A hand-built or pre-cookie `?t=` link: bounce it through the open route rather than render a page
  // whose URL carries a bearer credential. `redirect()` throws before any HTML exists, so nothing is
  // rendered, no GTM tag loads, and no `window.location.href` is ever set to this URL.
  if (typeof t === 'string' && t.length > 0) redirect(quoteOpenPath(ref, t));

  const token = (await cookies()).get(QUOTE_TOKEN_COOKIE)?.value ?? '';
  const quote = await resolveQuoteForToken(ref, token);
  if (!quote) notFound();

  const converted = quote.convertedAt !== null;

  return (
    <>
      <GygHeader sticky showSearch={false} />
      <main className="min-h-[60vh] bg-white">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="font-display text-2xl font-semibold text-ink">Your quote {quote.ref}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Hi {quote.customerName}, here is the quote you asked us for.
          </p>

          {quote.introNote && (
            <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {quote.introNote}
            </p>
          )}

          <ul className="mt-7 border-t border-ink/10">
            {quote.items.map((line) => {
              const when = lineWhen(line);
              return (
                <li
                  key={line.position}
                  className="flex items-start justify-between gap-4 border-b border-ink/10 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{lineLabel(line)}</p>
                    {when && <p className="mt-0.5 text-[12.5px] text-ink-muted">{when}</p>}
                    {line.quantity > 1 && (
                      <p className="mt-0.5 text-[12.5px] text-ink-muted">
                        {line.quantity} × {money(quote.currency, line.unitAmountMinor)}
                      </p>
                    )}
                  </div>
                  <p className="whitespace-nowrap text-sm text-ink">
                    {money(quote.currency, line.subtotalMinor)}
                  </p>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-4 py-3">
            <p className="text-[15px] font-bold text-ink">Total</p>
            <p className="whitespace-nowrap text-[15px] font-bold text-ink">
              {money(quote.currency, quote.totalMinor)}
            </p>
          </div>
          <p className="text-[12.5px] text-ink-muted">
            Valid until {quote.validUntil}. Nothing is reserved until the quote is paid.
          </p>

          {/* An ACCEPTED quote must not present an unqualified "Accept & pay". The link gets forwarded
              — to a partner, to a travel agent — and gets reopened by the guest after paying; a live
              payment CTA there invites a second attempt whose only answer is a refusal. The button
              stays, as a secondary action, because api_convert_quote's re-arm branch is a real recovery
              route for a booking that died unpaid. */}
          {converted && (
            <div className="mt-7 rounded-xl border border-teal/30 bg-teal/5 p-4">
              <p className="text-sm font-bold text-ink">
                You have accepted this quote — a booking has been created.
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                Check your email for the confirmation. If your payment did not go through, you can
                still complete it below.
              </p>
            </div>
          )}

          <div className="mt-7">
            <QuotePayButton quoteRef={quote.ref} converted={converted} />
          </div>

          <p className="mt-6 text-[13px] leading-relaxed text-ink-muted">
            Something to change? Reply to the email we sent you, or contact us at{' '}
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
