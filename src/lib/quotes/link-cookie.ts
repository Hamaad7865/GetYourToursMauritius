/**
 * WHERE THE PUBLIC QUOTE LINK TOKEN LIVES — and, more to the point, where it must not.
 *
 * The token is a bearer credential: whoever holds it can read a named guest's offer and start a
 * payment for it. `quotes.token_hash` stores only its SHA-256 precisely so that a database read (or a
 * leaked backup) cannot mint a working link. Putting the raw token in a RENDERED page's URL undoes
 * that, because two pieces of instrumentation on this site export a page URL verbatim:
 *
 *   - app/layout.tsx renders <GoogleTagManager/> on every page, and its own header says the container
 *     "always loads" and that Google's tags "fall back to cookieless pings" when consent is denied.
 *     Those pings carry `page_location` — the whole `/quotes/QXXXX?t=<64 hex>` — so the credential
 *     reaches Google, and any tag added to the container, consent or no consent.
 *   - src/lib/client-error-report.ts posts `url: window.location.href` to /api/v1/client-errors, which
 *     writes it to `error_logs` — the table documented as holding no personal data, readable by staff
 *     for 30 days. Any JS error on the quote page would persist a live token there.
 *
 * So the emailed link is {@link quoteOpenPath}: GET /api/v1/quotes/{ref}/open?t=… . An /api/ route
 * renders no HTML, is excluded from the middleware matcher (see middleware.ts's `matcher`) and never
 * loads GTM. It moves the token into an httpOnly cookie and 302s to the clean `/quotes/{ref}`. From
 * then on the token exists only in a request header: not in `window.location.href`, not in
 * `page_location`, not in the RSC payload, and not in the browser history entry the guest keeps (a 302
 * replaces it with the clean URL).
 *
 * TWO cookies, not one, and neither scoped `Path=/`. The page (`/quotes/{ref}`) and the pay route
 * (`/api/v1/quotes/{ref}/pay`) share no URL prefix, so no single Path covers both; `Path=/` would
 * attach the credential to every request for every page and asset on the site, which is a worse
 * exposure than the query string it replaces. Cookies are keyed by name + domain + PATH (RFC 6265
 * §5.3), so the two entries coexist, and a guest holding links to two different quotes gets four
 * cookies that never cross.
 */

import { SITE } from '@/lib/seo/site';

/** One name for both scopes — the differing Path is what keeps them apart. */
export const QUOTE_TOKEN_COOKIE = 'bmt_quote_token';

/**
 * Two hours.
 *
 * Long enough to cover the whole job — read the offer, fetch a card, pass 3-D Secure, come back to the
 * page and see the converted state — and short enough that a shared or borrowed browser is not a
 * standing key to someone's quote. The token itself does not expire here: the emailed link re-mints
 * the cookie on every click, and `valid_until` is what actually ends the offer.
 */
export const QUOTE_TOKEN_MAX_AGE_SECONDS = 2 * 60 * 60;

/**
 * Quote refs are `Q` + 12 uppercase hex from {@link import('@/lib/admin/quotes').mintQuoteRef}, and
 * the tests seed shorter alphanumeric ones. Alphanumeric-only is the requirement that matters: the ref
 * is interpolated into a cookie `Path=` attribute, where a `;` or a space would end the attribute and
 * let the rest be read as another one.
 */
export function quoteRefLooksValid(ref: string): boolean {
  return /^[A-Za-z0-9]{1,32}$/.test(ref);
}

/** A raw link token is 32 bytes of lowercase hex — see src/lib/quotes/token.ts. */
export function quoteTokenLooksValid(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

/** The two paths the cookie is scoped to: the page, and the route the page's Pay button posts to. */
export function quoteCookiePaths(ref: string): [string, string] {
  return [`/quotes/${ref}`, `/api/v1/quotes/${ref}`];
}

/**
 * The `Set-Cookie` values that hand the token to the page and the pay route, and to nothing else.
 *
 * `Secure` unconditionally, including on http://localhost: a Secure cookie IS accepted on localhost by
 * every current browser (it is treated as a trustworthy origin), so there is no dev-only branch here
 * that could ship as a plaintext cookie in production.
 */
export function buildQuoteTokenCookies(ref: string, token: string): string[] {
  return quoteCookiePaths(ref).map(
    (path) =>
      `${QUOTE_TOKEN_COOKIE}=${token}; Path=${path}; Max-Age=${QUOTE_TOKEN_MAX_AGE_SECONDS}; ` +
      // SameSite=Lax, not Strict: the guest comes BACK from Peach's hosted 3-D Secure step as a
      // top-level GET navigation from another site, and Strict would withhold the cookie exactly then
      // — landing a guest who has just paid on a 404.
      `HttpOnly; Secure; SameSite=Lax`,
  );
}

/** The page the guest ends up on: no token, nothing a tag or an error report could carry away. */
export function quotePagePath(ref: string): string {
  return `/quotes/${ref}`;
}

/**
 * THE `returnUrl` THE QUOTE PAY ROUTE MUST HAND `createPaymentLink`. Absolute, and this origin.
 *
 * `?return=` on /bookings/{ref}/pay only fixes the CLIENT-side half of the return trip: it is read by
 * EmbeddedCheckout's own `router.replace` when the embedded widget completes or is cancelled. A card
 * that takes the REDIRECT-based 3-D Secure path never gets there — the issuer sends the guest back
 * top-level to whatever `shopperResultUrl` Peach was given, which is this value (see
 * src/lib/payments/peach.ts). Leave it at the /api/v1/payments default, `${SITE_URL}/bookings/{ref}`,
 * and the quote guest lands on BookingConfirmation's "Sign in to view booking …" — charged, then
 * walled, which is the exact outcome the `?return=` work set out to remove.
 *
 * Absolute and same-origin are both load-bearing: peach.ts derives the `Origin` header it sends from
 * this URL via `originOf`, so a relative path or another host breaks the checkout create outright.
 */
export function quotePayReturnUrl(ref: string): string {
  return `${SITE.url}${quotePagePath(ref)}`;
}

/**
 * THE LINK TO EMAIL. Prefix it with `SITE.url` for the absolute form.
 *
 * Never `/quotes/{ref}?t=…`: that is the shape this module exists to avoid, and an emailed link cannot
 * be recalled.
 */
export function quoteOpenPath(ref: string, token: string): string {
  return `/api/v1/quotes/${encodeURIComponent(ref)}/open?t=${encodeURIComponent(token)}`;
}
