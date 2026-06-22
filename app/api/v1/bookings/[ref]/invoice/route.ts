import { apiHandler } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext, serviceRoleServiceContext } from '@/lib/http/context';
import { getBookingStatus } from '@/lib/services/bookings';
import { loadBookingForReceipt } from '@/lib/services/receipt';
import { buildInvoice } from '@/lib/invoice/model';
import { renderInvoicePdf } from '@/lib/invoice/pdf';
import { INVOICE_BUSINESS } from '@/lib/invoice/business';
import { ConflictError } from '@/lib/services/errors';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * GET /api/v1/bookings/:ref/invoice — the booking's invoice/receipt PDF.
 *
 * Ownership FIRST: an RLS-gated read of the booking (as the caller) throws not_found unless they own it
 * (or are staff). Only THEN do we elevate to the service-role receipt loader (the joined receipt data
 * lives behind the service_role `api_booking_receipt`), and only by the id of that already-owned
 * booking — no privilege escalation. The invoice is available once the booking is paid.
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { ref } = await params;

  const booking = await getBookingStatus(buildServiceContext(req), ref);
  if (booking.paymentState !== 'paid') {
    throw new ConflictError('Your invoice will be available once the payment is confirmed.');
  }

  const admin = serviceRoleServiceContext();
  const { booking: inv, payment } = await loadBookingForReceipt(admin, booking.id);
  const issuedAt = payment.paidAt ?? admin.now().toISOString();
  const model = buildInvoice(inv, { ...payment, issuedAt }, INVOICE_BUSINESS);
  const pdf = await renderInvoicePdf(model);

  // Copy into a fresh ArrayBuffer-backed Uint8Array: renderInvoicePdf returns Uint8Array<ArrayBufferLike>,
  // which the edge lib's BodyInit (wants ArrayBufferView<ArrayBuffer>) rejects.
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
