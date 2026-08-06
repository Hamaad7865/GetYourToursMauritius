import { apiHandler } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { rateLimit } from '@/lib/http/rate-limit';
import { serviceRoleServiceContext } from '@/lib/http/context';
import { ConflictError, NotFoundError } from '@/lib/services/errors';
import { loadBookingForReceipt } from '@/lib/services/receipt';
import { buildInvoice } from '@/lib/invoice/model';
import { renderInvoicePdf } from '@/lib/invoice/pdf';
import { INVOICE_BUSINESS } from '@/lib/invoice/business';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { quoteRefLooksValid, readQuoteTokenCookie } from '@/lib/quotes/link-cookie';
import { quotePaymentReceived, resolveQuoteForToken } from '@/lib/quotes/resolve';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * GET /api/v1/quotes/:ref/receipt — the paid quote guest's own copy of their invoice & receipt PDF.
 *
 * THE PROBLEM THIS SOLVES. A quote booking may have no `user_id` at all: the guest was emailed an
 * offer, they paid it, and most of them will never open an account. Every customer-facing document
 * route we already have (`/api/v1/bookings/{ref}/invoice`, `/api/v1/bookings/{ref}/voucher`) opens
 * with `requireUser` and then an RLS-gated read whose policy is
 * `using (user_id = auth.uid() or is_staff())` — which an ownerless booking can never satisfy. Without
 * this route, the one customer in the system who is guaranteed to have no account is also the only one
 * who cannot fetch the document for the money they paid.
 *
 * AUTHORIZATION IS THE LINK TOKEN, the same credential that authorised the payment itself, in the
 * httpOnly cookie GET /api/v1/quotes/{ref}/open set — scoped `Path=/api/v1/quotes/{ref}`, so this URL
 * receives it and nothing else on the site does. That is why the route lives HERE and not under
 * `/api/v1/bookings/{ref}/…`: a cookie is sent by path, so a document route outside the quote's own
 * prefix would never see the credential, and moving the token into a query string is the exact thing
 * src/lib/quotes/link-cookie.ts exists to prevent (GTM exports `page_location`; the client error
 * reporter writes `window.location.href` into `error_logs`).
 *
 * ONE ANSWER FOR EVERY REFUSAL TO OPEN THE QUOTE: 404 — unknown ref, malformed ref, missing cookie,
 * wrong token, unsent draft. {@link resolveQuoteForToken} already collapses those into a single null
 * and this route keeps that shape, because `quotes.ref` is the path segment of a link that gets
 * forwarded and a per-case status would turn this into an oracle for which refs exist.
 *
 * THE ONE DISTINGUISHABLE ANSWER IS 409, and only for a caller who has ALREADY proved they hold the
 * link: the quote is readable, but its money has not arrived, so the document does not exist yet.
 * That leaks nothing a guest holding the link cannot already read off their own quote page.
 *
 * WHY THE INVOICE/RECEIPT AND NOT `renderVoucherPdf`: the voucher is the airport-transfer driver
 * run-sheet and is only ever rendered for a booking with `model.booking.transfer` set (its own header
 * says so). api_convert_quote mints no transfer fields, so a quote booking has none — the document a
 * quote guest actually needs is the itemised VAT invoice/receipt, which is also what the confirmation
 * email attaches. Same renderer, same `buildInvoice` model, so the copy they download here and the
 * copy they were emailed are the same document.
 */

/* ---------------------------------------------------------------------------------------------
 * The typed client does not know these tables — same structural cast, and the same reason, as
 * src/lib/quotes/resolve.ts: the quotes module landed in 20260909000000 and is not in the generated
 * src/lib/supabase/types.ts. Kept narrow so a typo in one of these calls is still a compile error.
 * ------------------------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

interface ReceiptReadClient {
  from(table: 'quotes'): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }> };
    };
  };
}

export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'quote_receipt', 30, 60);
  const { ref } = await params;

  // Not a ref we could have minted, so there is nothing to open. Same answer as every other refusal.
  if (!quoteRefLooksValid(ref)) throw new NotFoundError('Not found');
  const token = readQuoteTokenCookie(req);
  if (!token) throw new NotFoundError('Not found');

  // THE authorization. Null for every refusal — see the header.
  const quote = await resolveQuoteForToken(ref, token);
  if (!quote) throw new NotFoundError('Not found');

  // Read off the BOOKING, never off `?just_paid=1` or any other hint from the browser: the same
  // question the public quote page asks before it says anything at all about the guest's money.
  if (!quotePaymentReceived(quote)) {
    throw new ConflictError(
      'Your invoice & receipt will be here once your payment has been confirmed.',
    );
  }

  // A second read of a row `resolveQuoteForToken` has just seen, on purpose: the model it returns is
  // the GUEST-FACING one and deliberately carries no ids (its header explains why — everything on it
  // is serialised into a page the recipient of a forwarded link can read). This runs only after the
  // token has been verified, so it is not reachable without the link.
  const db = createServiceRoleClient() as unknown as ReceiptReadClient;
  const { data, error } = await db.from('quotes').select('booking_id').eq('ref', ref).maybeSingle();
  const bookingId = error || !data || data.booking_id == null ? null : String(data.booking_id);
  // `quotePaymentReceived` was true, so a booking existed a moment ago; if it cannot be named now
  // (an erasure hard-deleted it, a read failed) the honest answer is "not available", never a 500.
  if (!bookingId) {
    throw new ConflictError(
      'Your invoice & receipt will be here once your payment has been confirmed.',
    );
  }

  const admin = serviceRoleServiceContext();
  const { booking, payment } = await loadBookingForReceipt(admin, bookingId);
  const issuedAt = payment.paidAt ?? admin.now().toISOString();
  const model = buildInvoice(booking, { ...payment, issuedAt }, INVOICE_BUSINESS);
  const pdf = await renderInvoicePdf(model);

  // Copy into a fresh ArrayBuffer-backed Uint8Array: renderInvoicePdf returns Uint8Array<ArrayBufferLike>,
  // which the edge lib's BodyInit (wants ArrayBufferView<ArrayBuffer>) rejects — same as the booking
  // invoice route.
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="invoice-${model.invoiceNumber}.pdf"`,
      'cache-control': 'no-store',
    },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
