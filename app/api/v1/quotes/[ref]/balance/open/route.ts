import { apiHandler } from '@/lib/http/handler';
import { rateLimit } from '@/lib/http/rate-limit';
import { NotFoundError } from '@/lib/services/errors';
import {
  buildQuoteBalanceTokenCookies,
  quoteBalancePagePath,
  quoteRefLooksValid,
  quoteTokenLooksValid,
} from '@/lib/quotes/link-cookie';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * GET /api/v1/quotes/:ref/balance/open?t=… — the balance link's analogue of the deposit's
 * /quotes/{ref}/open route.
 *
 * Its entire job is to get the raw balance-link token OUT of anything that renders. It validates the
 * shape of the ref and the token, puts the token in an httpOnly cookie scoped to this quote's balance
 * paths (see src/lib/quotes/link-cookie.ts for why a DISTINCT cookie from the deposit's and why not
 * `Path=/`), and 302s to the clean `/quotes/{ref}/balance`. An /api/ route renders no HTML, never
 * loads GTM and is outside the middleware matcher, so the token never becomes a `page_location` ping,
 * never lands in `window.location.href` (and therefore never in an `error_logs` row), and the history
 * entry the guest keeps is the clean URL.
 *
 * IT AUTHENTICATES NOTHING, exactly as the deposit open route. There is no database read here on
 * purpose: {@link import('@/lib/quotes/resolve').resolveBalanceForToken} is the single gate, and it
 * runs on the page and again in the pay route. Checking the token here as well would mean two copies
 * of the authorization and — worse — this route answering differently for a real ref than an invented
 * one, the enumeration oracle the whole module is shaped to avoid. Every outcome below is the same 302
 * to the same page; a request with no valid token simply arrives there without a cookie, and the page
 * 404s.
 *
 * Rate limited per IP like every other unauthenticated endpoint.
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'quote_balance_open', 30, 60);
  const { ref } = await params;

  // A ref that is not alphanumeric cannot be interpolated into a cookie `Path=` safely, and cannot be
  // one we minted. Nothing to redirect to.
  if (!quoteRefLooksValid(ref)) throw new NotFoundError('Not found');

  const token = new URL(req.url).searchParams.get('t') ?? '';
  const headers = new Headers({ location: quoteBalancePagePath(ref) });
  if (quoteTokenLooksValid(token)) {
    for (const cookie of buildQuoteBalanceTokenCookies(ref, token)) {
      headers.append('set-cookie', cookie);
    }
  }

  // 302, not 307: the redirect must be a GET regardless, and a 302 replaces the history entry so the
  // tokenised URL is not left in the guest's back button.
  return new Response(null, { status: 302, headers });
});
