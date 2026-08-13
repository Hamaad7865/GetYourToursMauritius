import { apiHandler } from '@/lib/http/handler';
import { rateLimit } from '@/lib/http/rate-limit';
import { NotFoundError } from '@/lib/services/errors';
import {
  buildQuoteInstallmentTokenCookies,
  installmentSeqLooksValid,
  quoteInstallmentPagePath,
  quoteRefLooksValid,
  quoteTokenLooksValid,
} from '@/lib/quotes/link-cookie';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string; seq: string }> };

/**
 * GET /api/v1/quotes/:ref/i/:seq/open?t=… — the installment link's analogue of the balance open route.
 *
 * Its whole job is to strip the raw token OUT of anything that renders: it validates the shape of the
 * ref, the seq and the token, moves the token into an httpOnly cookie scoped to this ONE installment's
 * page + pay route (see src/lib/quotes/link-cookie.ts for why a per-seq Path and not `Path=/`), and 302s
 * to the clean /quotes/{ref}/i/{seq}. An /api/ route renders no HTML, loads no GTM and is outside the
 * middleware matcher, so the token never becomes a page_location ping or an error_logs row.
 *
 * IT AUTHENTICATES NOTHING (exactly like the balance/deposit open routes): resolveInstallmentForToken is
 * the single gate, on the page and again in the pay route. Every outcome is the same 302 to the same
 * page — a request without a valid token simply lands there with no cookie, and the page 404s.
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'quote_installment_open', 30, 60);
  const { ref, seq } = await params;
  if (!quoteRefLooksValid(ref) || !installmentSeqLooksValid(seq))
    throw new NotFoundError('Not found');

  const seqNum = Number(seq);
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const headers = new Headers({ location: quoteInstallmentPagePath(ref, seqNum) });
  if (quoteTokenLooksValid(token)) {
    for (const cookie of buildQuoteInstallmentTokenCookies(ref, seqNum, token)) {
      headers.append('set-cookie', cookie);
    }
  }
  // 302 replaces the tokenised URL in history with the clean one.
  return new Response(null, { status: 302, headers });
});
