import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { ConfigError, NotFoundError } from '@/lib/services/errors';
import { createPaymentLink } from '@/lib/services/payments';
import {
  installmentSeqLooksValid,
  quoteInstallmentPayReturnUrl,
  quoteRefLooksValid,
  readQuoteInstallmentTokenCookie,
} from '@/lib/quotes/link-cookie';
import { resolveInstallmentForToken } from '@/lib/quotes/resolve';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string; seq: string }> };

/**
 * POST /api/v1/quotes/:ref/i/:seq/pay — "Pay this installment" on a durable installment page.
 *
 * The installment analogue of the balance pay route, and the same DURABLE property: a FRESH Peach
 * session is minted on THIS click, sized by create_payment to this installment's share of the balance
 * (the running total up to it minus what is already settled), so the link keeps working until it is
 * covered. Nothing to convert (the deposit already confirmed the booking) — this only mints the checkout.
 *
 * AUTHENTICATED BY THE INSTALLMENT LINK TOKEN in the httpOnly cookie the open route set (scoped to this
 * seq), not by requireUser — a quote guest has no account. resolveInstallmentForToken is THE gate: one
 * 404 for every refusal (unknown ref/seq, wrong token, not-confirmed booking, already-covered
 * installment), so the endpoint is not an existence oracle. It passes authorizedBy:'quote' (the RPC is
 * service-role only, authorization is the token this route verified) and purpose:'balance' with the seq,
 * so create_payment sizes and leases per installment.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'quote_installment_pay', 20, 60);
  const { ref, seq } = await params;
  if (!quoteRefLooksValid(ref) || !installmentSeqLooksValid(seq))
    throw new NotFoundError('Not found');

  const seqNum = Number(seq);
  const token = readQuoteInstallmentTokenCookie(req);
  if (!token) throw new NotFoundError('Not found');

  // THE authorization AND payability gate. Null for every refusal, and it already carries the booking ref
  // (no second read like the balance route needs).
  const inst = await resolveInstallmentForToken(ref, seqNum, token);
  if (!inst) throw new NotFoundError('Not found');

  const env = getServerEnv();
  // FAIL CLOSED (money path): NEXT_PUBLIC_SITE_URL builds both the return URL and Peach's Origin header.
  if (!isSiteUrlConfiguredForLive(env)) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime — refusing to mint a checkout that would redirect the guest to localhost.',
      { code: 'site_url_not_configured' },
    );
  }

  const ctx = serviceRoleRpcContext();
  const link = await createPaymentLink(
    ctx,
    {
      bookingRef: inst.bookingRef,
      // Back to THIS installment's page, not the /bookings sign-in wall (the guest has no account).
      returnUrl: quoteInstallmentPayReturnUrl(ref, seqNum),
      purpose: 'balance',
      authorizedBy: 'quote',
      installmentSeq: seqNum,
    },
    ctx,
  );

  // bookingRef alongside the link so the page can hand the guest to /bookings/{ref}/pay with the session.
  return jsonOk({ ...link, bookingRef: inst.bookingRef }, { status: 201 });
});
