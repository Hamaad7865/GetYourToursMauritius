import { describe, expect, it, vi } from 'vitest';
import {
  QUOTE_TOKEN_COOKIE,
  buildQuoteTokenCookies,
  quoteOpenPath,
  quotePayReturnUrl,
  quoteRefLooksValid,
} from '@/lib/quotes/link-cookie';
import { SITE } from '@/lib/seo/site';

/**
 * The link token must never reach a RENDERED page's URL.
 *
 * Two pieces of instrumentation export a page URL verbatim, and both run on every customer page:
 *
 *   - app/layout.tsx renders <GoogleTagManager/> unconditionally, and Google's tags fall back to
 *     cookieless pings when consent is denied. Those pings carry `page_location` — i.e. the whole
 *     `/quotes/QXXXX?t=<64 hex>` — so a bearer credential would be handed to Google, and to any tag
 *     added to the container, consent or no consent.
 *   - src/lib/client-error-report.ts posts `url: window.location.href` to /api/v1/client-errors,
 *     which writes it into `error_logs` — the table documented as holding no personal data and
 *     readable by staff for 30 days.
 *
 * The module hashes the token in the database precisely so that a database read cannot mint a working
 * link; putting the raw one in a page URL hands it to a third party and to a log table instead.
 *
 * So the emailed link points at GET /api/v1/quotes/{ref}/open?t=… — an /api/ route, which renders no
 * HTML, is excluded from the middleware matcher and never loads GTM. It moves the token into an
 * httpOnly cookie and 302s to the clean /quotes/{ref}. From then on the token exists only in a header
 * no script can read: not in `window.location.href`, not in `page_location`, not in the RSC payload.
 */

// The route's only dependency beyond the cookie builders. The real one takes a DB round trip through
// the service-role client; the point here is the redirect and the Set-Cookie, not the limiter.
const hoisted = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/lib/http/rate-limit', () => ({
  rateLimit: async (_req: Request, bucket: string) => {
    hoisted.calls.push(bucket);
  },
  clientIp: () => null,
}));

const { GET } = await import('../../app/api/v1/quotes/[ref]/open/route');

const REF = 'Q0A1B2C3D4E5';
const TOKEN = 'a'.repeat(64);

/** `ref` arrives already URL-decoded in `params`, exactly as Next hands it to a route handler. */
function open(ref: string, query: string): Promise<Response> {
  const url = `https://bellemaretours.com/api/v1/quotes/${encodeURIComponent(ref)}/open${query}`;
  return GET(new Request(url), { params: Promise.resolve({ ref }) });
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

describe('quote link cookie', () => {
  it('scopes the cookie to the two paths that need it, and nowhere else', () => {
    const cookies = buildQuoteTokenCookies(REF, TOKEN);

    expect(cookies).toHaveLength(2);
    // The page and the pay route do NOT share a URL prefix, so one Path cannot cover both — and a
    // Path=/ cookie would attach the credential to every request for every asset on the site.
    expect(cookies.some((c) => c.includes(`Path=/quotes/${REF};`))).toBe(true);
    expect(cookies.some((c) => c.includes(`Path=/api/v1/quotes/${REF};`))).toBe(true);
    for (const cookie of cookies) {
      expect(cookie.startsWith(`${QUOTE_TOKEN_COOKIE}=${TOKEN};`)).toBe(true);
      // httpOnly is the whole point: it is what keeps the token out of window.location, out of any
      // GTM tag's reach and out of a client error report.
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toMatch(/Max-Age=\d+/);
    }
  });

  it('refuses a ref that could break out of the cookie Path attribute', () => {
    expect(quoteRefLooksValid(REF)).toBe(true);
    expect(quoteRefLooksValid('QPAGE1')).toBe(true);
    expect(quoteRefLooksValid('')).toBe(false);
    expect(quoteRefLooksValid('Q1; Path=/')).toBe(false);
    expect(quoteRefLooksValid('../admin')).toBe(false);
    expect(quoteRefLooksValid(`Q${'1'.repeat(64)}`)).toBe(false);
  });

  it('builds the emailed link, which is the /api/ route and never the page', () => {
    const path = quoteOpenPath(REF, TOKEN);
    expect(path).toBe(`/api/v1/quotes/${REF}/open?t=${TOKEN}`);
    // If this ever starts with /quotes/, the token is back in a rendered page URL.
    expect(path.startsWith('/api/')).toBe(true);
  });

  it('names an absolute, same-origin return URL for the provider — not /bookings/{ref}', () => {
    // `?return=` only fixes the CLIENT-side half of the return trip: EmbeddedCheckout consumes it in
    // its own router.replace on onCompleted/onCancelled. A card that takes the redirect-based 3-D
    // Secure path comes back TOP-LEVEL to whatever `shopperResultUrl` Peach was given, and
    // /bookings/{ref} renders "Sign in to view booking …" to someone who by definition has no account
    // — charged, then walled. So the quote pay route must hand createPaymentLink THIS url.
    const url = quotePayReturnUrl(REF);

    expect(url).toBe(`${SITE.url}/quotes/${REF}`);
    expect(url).not.toContain('/bookings/');
    // Absolute and same-origin, both load-bearing: peach.ts derives the Origin header it sends from
    // this URL via `originOf`, so a relative path (or another host) breaks the checkout create.
    expect(url.startsWith(`${SITE.url}/`)).toBe(true);
  });

  it('moves the token into the cookie and redirects to a URL that does not carry it', async () => {
    const res = await open(REF, `?t=${TOKEN}`);

    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBe(`/quotes/${REF}`);
    expect(location).not.toContain(TOKEN);
    expect(location).not.toContain('t=');

    const cookies = setCookies(res);
    expect(cookies).toHaveLength(2);
    expect(cookies.every((c) => c.includes(TOKEN))).toBe(true);
    expect(hoisted.calls).toContain('quote_open');
  });

  it('sets no cookie for a token that cannot be a SHA-256 pre-image', async () => {
    // Fails closed, and lands the guest on the same clean page every other refusal does — the page
    // then answers 404 for a missing cookie, so nothing here tells a prober which refs exist.
    const res = await open(REF, '?t=not-a-token');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/quotes/${REF}`);
    expect(setCookies(res)).toEqual([]);

    const bare = await open(REF, '');
    expect(bare.status).toBe(302);
    expect(setCookies(bare)).toEqual([]);
  });

  it('refuses a malformed ref outright rather than writing it into a Set-Cookie', async () => {
    const res = await open('Q1; Path=/', `?t=${TOKEN}`);
    expect(res.status).toBe(404);
    expect(setCookies(res)).toEqual([]);
  });
});
