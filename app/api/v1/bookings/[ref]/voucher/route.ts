import { apiHandler } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext, serviceRoleServiceContext } from '@/lib/http/context';
import { getBookingStatus } from '@/lib/services/bookings';
import { loadBookingForReceipt } from '@/lib/services/receipt';
import { buildInvoice } from '@/lib/invoice/model';
import { renderVoucherPdf } from '@/lib/invoice/voucher-pdf';
import { INVOICE_BUSINESS } from '@/lib/invoice/business';
import { isConfirmedStatus } from '@/lib/checkout/confirm-poll';
import { SITE } from '@/lib/seo/site';
import { ConflictError } from '@/lib/services/errors';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * GET /api/v1/bookings/:ref/voucher — the airport-transfer e-voucher PDF (driver run-sheet + booking QR).
 *
 * Same ownership-first → elevate pattern as the invoice route: an RLS-gated read proves ownership before
 * we touch the service-role receipt loader, keyed only by the already-owned booking id. The voucher is
 * available once the booking is confirmed/paid, and only for airport-transfer bookings (everything else
 * has no voucher → 409 rather than a confusing blank document).
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { ref } = await params;

  const booking = await getBookingStatus(buildServiceContext(req), ref);
  if (!isConfirmedStatus(booking.status) && booking.paymentState !== 'paid') {
    throw new ConflictError('Your e-voucher will be available once the booking is confirmed.');
  }

  const admin = serviceRoleServiceContext();
  const { booking: inv, payment } = await loadBookingForReceipt(admin, booking.id);
  const issuedAt = payment.paidAt ?? admin.now().toISOString();
  const model = buildInvoice(inv, { ...payment, issuedAt }, INVOICE_BUSINESS);

  if (!model.booking.transfer) {
    throw new ConflictError('This booking is not an airport transfer, so it has no e-voucher.');
  }

  const pdf = await renderVoucherPdf(model, `${SITE.url}/bookings/${ref}`);

  // Fresh ArrayBuffer-backed copy: renderVoucherPdf returns Uint8Array<ArrayBufferLike>, which the edge
  // BodyInit (wants ArrayBufferView<ArrayBuffer>) rejects — same reason as the invoice route.
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="voucher-${model.booking.ref}.pdf"`,
      'cache-control': 'no-store',
    },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
