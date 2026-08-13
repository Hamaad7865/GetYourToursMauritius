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
 * The BALANCE link's own cookie — a DISTINCT name from the deposit's, deliberately.
 *
 * A guest can hold both links (they paid the deposit on one; staff sent the balance on the other), and
 * `/quotes/{ref}/balance` sits UNDER `/quotes/{ref}` — so by RFC 6265 §5.1.4 path-match the deposit
 * cookie (Path=/quotes/{ref}) is ALSO sent to the balance page. A shared name would then put two
 * same-name cookies on the one request, and which the balance route reads would be path-length-order-
 * dependent and fragile. Distinct names never cross: the balance routes read only this cookie, the
 * deposit routes only {@link QUOTE_TOKEN_COOKIE}, and each ignores the other.
 */
export const QUOTE_BALANCE_TOKEN_COOKIE = 'bmt_quote_balance_token';

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
 * The raw link token from a request's cookies, or null. THE credential for every `/api/v1/quotes/{ref}`
 * route — the pay route and the receipt route both read it through here rather than each parsing the
 * header themselves, so there is one place that decides what counts as a token.
 *
 * At most one cookie can match: the two the open route sets share a NAME and differ only in Path
 * (`/quotes/{ref}` and `/api/v1/quotes/{ref}`), and these URLs are under the second only — so a guest
 * holding links to several quotes still sends exactly the one for this ref. A value that is not 32
 * bytes of lowercase hex can never match a stored SHA-256, so it is skipped rather than trusted.
 */
export function readQuoteTokenCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== QUOTE_TOKEN_COOKIE) continue;
    const value = rest.join('=');
    if (quoteTokenLooksValid(value)) return value;
  }
  return null;
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

/* ── The BALANCE link — the durable, re-openable second charge ──────────────────────────────────────
 *
 * Same shape as the deposit link, one scope along: the operator copies /quotes/{ref}/balance?t=<token>
 * to the guest, the balance page redirects that ?t= through the balance open route (which moves the
 * token into the httpOnly cookie below and 302s to the clean page), and the clean page's Pay button
 * mints a FRESH balance checkout on each click. Durable because nothing is minted until the click, so
 * the URL keeps working for as long as the balance is owed — the whole point of the redesign.
 * -------------------------------------------------------------------------------------------------- */

/** The two paths the balance cookie is scoped to: the balance page and the route its Pay button posts
 *  to. Neither is `Path=/` for the same reason the deposit's is not — the credential must not ride
 *  every request on the site. */
export function quoteBalanceCookiePaths(ref: string): [string, string] {
  return [`/quotes/${ref}/balance`, `/api/v1/quotes/${ref}/balance`];
}

/**
 * The raw balance-link token from a request's cookies, or null. THE credential for the balance pay
 * route (there is no account to check — a quote guest has none). Reads {@link
 * QUOTE_BALANCE_TOKEN_COOKIE} only, so the deposit cookie that is also in scope on the balance page is
 * ignored. A value that is not 32 bytes of lowercase hex can never match a stored SHA-256, so it is
 * skipped rather than trusted.
 */
export function readQuoteBalanceTokenCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== QUOTE_BALANCE_TOKEN_COOKIE) continue;
    const value = rest.join('=');
    if (quoteTokenLooksValid(value)) return value;
  }
  return null;
}

/**
 * The `Set-Cookie` values that hand the balance token to the balance page and its pay route, and to
 * nothing else. Secure unconditionally (accepted on localhost too, so there is no dev-only plaintext
 * branch), HttpOnly so no script holds it, SameSite=Lax so the guest comes back from Peach's hosted
 * 3-D Secure step with the cookie attached — all exactly as the deposit cookie.
 */
export function buildQuoteBalanceTokenCookies(ref: string, token: string): string[] {
  return quoteBalanceCookiePaths(ref).map(
    (path) =>
      `${QUOTE_BALANCE_TOKEN_COOKIE}=${token}; Path=${path}; Max-Age=${QUOTE_TOKEN_MAX_AGE_SECONDS}; ` +
      `HttpOnly; Secure; SameSite=Lax`,
  );
}

/** The clean balance page the guest ends up on: no token in the URL, so no GTM ping or error-log row
 *  can carry it away — the same reason the deposit page's URL is token-free. */
export function quoteBalancePagePath(ref: string): string {
  return `/quotes/${ref}/balance`;
}

/**
 * The open route that strips `?t=` off the balance page's URL into the httpOnly cookie. The balance
 * page redirects a raw `?t=` here before rendering (so no HTML, no GTM tag, no error report ever sees
 * the token), exactly as the deposit page redirects to {@link quoteOpenPath}.
 */
export function quoteBalanceOpenPath(ref: string, token: string): string {
  return `/api/v1/quotes/${encodeURIComponent(ref)}/balance/open?t=${encodeURIComponent(token)}`;
}

/**
 * THE `returnUrl` THE BALANCE PAY ROUTE HANDS `createPaymentLink`. Absolute, and this origin — the
 * same contract as {@link quotePayReturnUrl}: a card taking the redirect-based 3-D Secure path is sent
 * top-level back to whatever `shopperResultUrl` Peach was given, and a quote guest has no account to
 * sign in to, so it must be their own balance page and not the /bookings default. Absolute + same-
 * origin are load-bearing because peach.ts derives the Origin header from this URL.
 */
export function quoteBalancePayReturnUrl(ref: string): string {
  return `${SITE.url}${quoteBalancePagePath(ref)}`;
}

/**
 * Is this relative path one of THIS module's public quote pages?
 *
 * Asked by /bookings/{ref}/pay about its own `?return=`, to decide where "Try again" goes when the
 * Peach widget never came up. The default, /bookings/{ref}/pay minus the `?cid`, renders
 * PayPageFallback — whose first branch is "Please sign in to complete your payment", i.e. a sign-in
 * wall in front of the one customer who has no account by design. A quote guest's retry belongs on
 * their own quote page instead: its "Complete payment" posts to /api/v1/quotes/{ref}/pay (the deposit)
 * or /api/v1/quotes/{ref}/balance/pay (the balance), which the link-token cookie authenticates, and
 * that route mints a fresh checkout.
 *
 * BOTH the deposit page (/quotes/{ref}) AND the durable balance page (/quotes/{ref}/balance) qualify:
 * each is a token-cookie-authenticated page whose Pay button re-mints, so each is a place the
 * accountless guest can recover a failed payment. The /bookings fallback would only ask either to sign
 * in. The optional `/balance` segment is the only shape widening admitted.
 *
 * The ref is re-validated with {@link quoteRefLooksValid} rather than trusted: the caller's value came
 * off a query parameter, and this answer sends a browser somewhere on the screen right after a card
 * number was typed. `safeReturnPath` has already pinned it to a same-origin relative path; this pins
 * the shape.
 */
export function isQuotePagePath(path: string): boolean {
  const match = /^\/quotes\/([^/?#]+)(?:\/balance|\/i\/\d{1,3})?$/.exec(path);
  return match !== null && quoteRefLooksValid(match[1]!);
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

/* ── The per-installment link — one dated charge on a per-date scheduled booking ────────────────────
 *
 * Same shape as the balance link, but keyed on a SEQ as well as the ref, because a scheduled booking has
 * several. Each installment's reminder email carries its own /i/{seq}/open link; the open route moves the
 * token into an httpOnly cookie scoped to that ONE installment's page + pay route and 302s to the clean
 * page, whose Pay button mints a fresh checkout for exactly that installment. Distinct paths per seq keep
 * a guest holding two installment links from ever crossing them (RFC 6265 §5.1.4 — /i/1 is not a prefix
 * of /i/2). The token itself is the deterministic HMAC (src/lib/quotes/installment-token.ts), so nothing
 * is stored on the row and the reminder can be sent without ever persisting a raw bearer token.
 * -------------------------------------------------------------------------------------------------- */

export const QUOTE_INSTALLMENT_TOKEN_COOKIE = 'bmt_quote_installment_token';

/** A seq is a small non-negative integer; it is interpolated into a cookie `Path=`, so digits only. */
export function installmentSeqLooksValid(seq: string): boolean {
  return /^\d{1,3}$/.test(seq);
}

/** The two paths this installment's cookie is scoped to: its page and the route its Pay button posts to. */
export function quoteInstallmentCookiePaths(ref: string, seq: number): [string, string] {
  return [`/quotes/${ref}/i/${seq}`, `/api/v1/quotes/${ref}/i/${seq}`];
}

/** The raw installment-link token from a request's cookies, or null. Reads only this cookie name. */
export function readQuoteInstallmentTokenCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== QUOTE_INSTALLMENT_TOKEN_COOKIE) continue;
    const value = rest.join('=');
    if (quoteTokenLooksValid(value)) return value;
  }
  return null;
}

/** Set-Cookie values that hand the installment token to its page + pay route only. Secure/HttpOnly/Lax
 *  exactly as the deposit and balance cookies (Lax so the guest returns from Peach 3-D Secure with it). */
export function buildQuoteInstallmentTokenCookies(
  ref: string,
  seq: number,
  token: string,
): string[] {
  return quoteInstallmentCookiePaths(ref, seq).map(
    (path) =>
      `${QUOTE_INSTALLMENT_TOKEN_COOKIE}=${token}; Path=${path}; Max-Age=${QUOTE_TOKEN_MAX_AGE_SECONDS}; ` +
      `HttpOnly; Secure; SameSite=Lax`,
  );
}

/** The clean installment page the guest ends up on: no token in the URL. */
export function quoteInstallmentPagePath(ref: string, seq: number): string {
  return `/quotes/${ref}/i/${seq}`;
}

/** THE LINK TO EMAIL for an installment. Prefix with SITE.url for the absolute form. Never the page URL
 *  with `?t=` — the shape the whole module avoids. */
export function quoteInstallmentOpenPath(ref: string, seq: number, token: string): string {
  return `/api/v1/quotes/${encodeURIComponent(ref)}/i/${seq}/open?t=${encodeURIComponent(token)}`;
}

/** The `returnUrl` the installment pay route hands createPaymentLink — absolute, same origin, the
 *  installment's own page (a quote guest has no /bookings to sign in to). */
export function quoteInstallmentPayReturnUrl(ref: string, seq: number): string {
  return `${SITE.url}${quoteInstallmentPagePath(ref, seq)}`;
}
