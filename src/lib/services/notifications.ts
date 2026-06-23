import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import type {
  NotificationAttachment,
  NotificationMessage,
  NotificationProvider,
} from '@/lib/notifications/types';
import { loadBookingForReceipt } from './receipt';
import { buildInvoice } from '@/lib/invoice/model';
import { renderInvoicePdf } from '@/lib/invoice/pdf';
import { renderVoucherPdf } from '@/lib/invoice/voucher-pdf';
import { renderConfirmationEmail } from '@/lib/email/booking-confirmation';
import { INVOICE_BUSINESS } from '@/lib/invoice/business';
import { SITE } from '@/lib/seo/site';

const claimedSchema = z.array(
  z.object({
    id: z.string(),
    channel: z.enum(['email', 'whatsapp']),
    recipient: z.string(),
    template: z.string(),
    payload: z.record(z.string(), z.unknown()).default({}),
    /** Set on booking_confirmation / booking_refunded rows; null for ad-hoc notifications. */
    bookingId: z.string().nullable().default(null),
  }),
);

/**
 * Base64-encode bytes on the edge runtime. `btoa(String.fromCharCode(...bytes))` spreads the whole
 * array as call arguments and overflows the stack for a multi-KB PDF, so we build the binary string in
 * fixed-size chunks first, then btoa once. No Node Buffer (unavailable on the edge runtime).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // 32 KB — well under the arg-count limit, few iterations for a 1-page PDF
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Enrich a `booking_confirmation` message in place: load the booking + payment, build the invoice
 * model, render the branded HTML email, and attach the invoice/receipt PDF. A PDF-render failure is
 * swallowed (HTML-only send) so a paid customer still gets their confirmation; a booking-load failure
 * propagates so the send is retried rather than mailing a blank email.
 */
async function enrichBookingConfirmation(
  ctx: ServiceContext,
  message: NotificationMessage & { bookingId: string | null },
): Promise<void> {
  if (!message.bookingId) {
    throw new Error('booking_confirmation: missing bookingId on the outbox row');
  }
  const { booking, payment } = await loadBookingForReceipt(ctx, message.bookingId);

  // Deterministic issue date: the card's paid timestamp, else the drain's injected clock (never an
  // ungoverned new Date()) so tests stay reproducible.
  const issuedAt = payment.paidAt ?? ctx.now().toISOString();
  const model = buildInvoice(booking, { ...payment, issuedAt }, INVOICE_BUSINESS);

  const email = renderConfirmationEmail(model);
  message.subject = email.subject;
  message.html = email.html;
  message.text = email.text;

  // PDFs are best-effort: never let a render error block the confirmation email. The tax receipt goes
  // to every booking; the branded e-voucher (the driver run-sheet) is added only for airport transfers.
  // Both ride this single already-deduped message, so there is no extra email and no double-send risk.
  const attachments: NotificationAttachment[] = [];
  try {
    const bytes = await renderInvoicePdf(model);
    attachments.push({
      filename: `invoice-${model.invoiceNumber}.pdf`,
      content: bytesToBase64(bytes),
      contentType: 'application/pdf',
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'pdf render failed';
    console.error(
      `invoice PDF render failed: id=${message.id} ref=${model.invoiceNumber} reason=${reason}`,
    );
  }
  if (model.booking.transfer) {
    try {
      const bytes = await renderVoucherPdf(model, `${SITE.url}/bookings/${model.booking.ref}`);
      attachments.push({
        filename: `voucher-${model.booking.ref}.pdf`,
        content: bytesToBase64(bytes),
        contentType: 'application/pdf',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'pdf render failed';
      console.error(
        `voucher PDF render failed: id=${message.id} ref=${model.invoiceNumber} reason=${reason}`,
      );
    }
  }
  if (attachments.length) message.attachments = attachments;
}

export interface DrainResult {
  processed: number;
  sent: number;
  failed: number;
}

/**
 * Claim a batch of pending notifications, send each via the provider, and record the result.
 * Sending happens OUTSIDE the booking transaction (this is the out-of-band worker). A send that
 * throws leaves the row pending for retry until attempts run out.
 *
 * A `booking_confirmation` is enriched first (Step: invoice/receipt) into a fully pre-rendered HTML
 * message with the PDF attached; every other template flows through the provider's own template
 * rendering unchanged.
 */
export async function drainNotifications(
  ctx: ServiceContext,
  provider: NotificationProvider,
  limit = 20,
): Promise<DrainResult> {
  const claimed = await callRpc(ctx, 'claim_notifications', { limit });
  // Widen each row to a mutable NotificationMessage (the enrich step writes subject/html/text/attachments
  // in place) carrying the bookingId the loader needs.
  const messages: Array<NotificationMessage & { bookingId: string | null }> = claimedSchema
    .parse(claimed ?? [])
    .map((row) => ({ ...row }));
  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      if (message.template === 'booking_confirmation') {
        await enrichBookingConfirmation(ctx, message);
      }
      await provider.send(message);
      await callRpc(ctx, 'mark_notification', { id: message.id, result: 'sent' });
      sent += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'send failed';
      // One-line, secret-free signal so a misconfigured provider (e.g. notifications_not_configured)
      // is loud in the logs instead of a silent black-hole. Only ids + the error message are logged.
      console.error(
        `notification send failed: id=${message.id} template=${message.template} reason=${reason}`,
      );
      await callRpc(ctx, 'mark_notification', { id: message.id, result: 'failed', error: reason });
      failed += 1;
    }
  }
  return { processed: messages.length, sent, failed };
}
