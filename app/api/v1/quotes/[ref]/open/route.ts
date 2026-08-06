import { apiHandler } from '@/lib/http/handler';
import { rateLimit } from '@/lib/http/rate-limit';
import { NotFoundError } from '@/lib/services/errors';
import {
  buildQuoteTokenCookies,
  quotePagePath,
  quoteRefLooksValid,
  quoteTokenLooksValid,
} from '@/lib/quotes/link-cookie';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * GET /api/v1/quotes/:ref/open?t=… — the target of the link in the quote email.
 *
 * Its entire job is to get the raw link token OUT of anything that renders. It validates the shape of
 * the ref and the token, puts the token in an httpOnly cookie scoped to this quote (see
 * src/lib/quotes/link-cookie.ts for why two cookies and why not `Path=/`), and 302s to the clean
 * `/quotes/{ref}`. An /api/ route renders no HTML, never loads GTM and is outside the middleware
 * matcher, so the token never becomes a `page_location` ping, never lands in `window.location.href`
 * (and therefore never in an `error_logs` row), and the history entry the guest keeps is the clean URL.
 *
 * IT AUTHENTICATES NOTHING. There is no database read here on purpose: {@link
 * import('@/lib/quotes/resolve').resolveQuoteForToken} is the single gate, and it runs on the page and
 * again in the pay route. Checking the token here as well would mean two copies of the authorization,
 * and — worse — this route answering differently for a real ref than for an invented one, which is the
 * enumeration oracle the whole module is shaped to avoid. Every outcome below is the same 302 to the
 * same page; a request with no valid token simply arrives there without a cookie, and the page 404s.
 *
 * Rate limited per IP like every other unauthenticated endpoint: without it this is a free oracle-free
 * but unbounded token-guessing endpoint, and 2^256 guesses cost nothing to attempt.
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'quote_open', 30, 60);
  const { ref } = await params;

  // A ref that is not alphanumeric cannot be interpolated into a cookie `Path=` safely, and cannot be
  // one we minted. Nothing to redirect to.
  if (!quoteRefLooksValid(ref)) throw new NotFoundError('Not found');

  const token = new URL(req.url).searchParams.get('t') ?? '';
  const headers = new Headers({ location: quotePagePath(ref) });
  if (quoteTokenLooksValid(token)) {
    for (const cookie of buildQuoteTokenCookies(ref, token)) headers.append('set-cookie', cookie);
  }

  // 302, not 307: the redirect must be a GET regardless, and a 302 replaces the history entry so the
  // tokenised URL is not left in the guest's back button.
  return new Response(null, { status: 302, headers });
});
