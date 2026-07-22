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
import { renderConfirmationEmail } from '@/lib/email/booking-confirmation';
import { renderReviewRequestEmail } from '@/lib/email/review-request';
import { INVOICE_BUSINESS } from '@/lib/invoice/business';
import { SITE } from '@/lib/seo/site';
import { getServerEnv } from '@/lib/config/env';

const claimedSchema = z.array(
  z.object({
    id: z.string(),
    channel: z.enum(['email', 'whatsapp', 'telegram']),
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

  const bookingUrl = `${SITE.url}/bookings/${model.booking.ref}`;
  const email = renderConfirmationEmail(model, bookingUrl);
  message.subject = email.subject;
  message.html = email.html;
  message.text = email.text;

  // The invoice/receipt rides as a PDF (best-effort; a render error never blocks the email). The airport-
  // transfer e-voucher is deliberately NOT attached — it's offered as a secure LINK to the auth-gated
  // booking page (see renderConfirmationEmail), so heuristic mail-scanners have no voucher PDF to false-
  // positive on. The voucher is still generated on demand at /api/v1/bookings/:ref/voucher and is
  // downloadable from that page.
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
  if (attachments.length) message.attachments = attachments;
}

/**
 * Owner-alert rows are enqueued with the literal recipient sentinel 'owner' (the DB never stores the
 * owner's personal contact detail). Resolve it here at send time: email falls back to the site inbox,
 * WhatsApp has no safe fallback so an unset number FAILS LOUDLY (visible in the outbox) instead of
 * silently messaging nobody.
 */
function resolveOwnerRecipient(message: NotificationMessage): void {
  if (message.recipient !== 'owner') return;
  const env = getServerEnv();
  if (message.channel === 'email') {
    message.recipient = env.OWNER_NOTIFY_EMAIL ?? SITE.email;
  } else if (message.channel === 'telegram') {
    if (!env.TELEGRAM_OWNER_CHAT_ID) {
      throw new Error('owner telegram chat id not configured (set TELEGRAM_OWNER_CHAT_ID)');
    }
    message.recipient = env.TELEGRAM_OWNER_CHAT_ID;
  } else {
    if (!env.OWNER_WHATSAPP_TO) {
      throw new Error('owner whatsapp number not configured (set OWNER_WHATSAPP_TO)');
    }
    message.recipient = env.OWNER_WHATSAPP_TO;
  }
}

/**
 * Enrich an `owner_new_booking` / `owner_refund_pending` alert in place: one glance tells the owner who booked what, when,
 * for how many, and for how much — plus the admin deep-link. The email gets subject/text/html; the
 * WhatsApp row gets the same summary as `text` (the WhatsApp provider sends text/template only).
 * A booking-load failure propagates so the alert retries rather than sending a blank one.
 */
async function enrichOwnerNewBooking(
  ctx: ServiceContext,
  message: NotificationMessage & { bookingId: string | null },
): Promise<void> {
  if (!message.bookingId) {
    throw new Error('owner_new_booking: missing bookingId on the outbox row');
  }
  const { booking } = await loadBookingForReceipt(ctx, message.bookingId);
  const pax = booking.items.reduce((s, i) => s + (i.pax ?? i.quantity), 0);
  const when = booking.when ? booking.when.slice(0, 10) : 'date TBC';
  const total = `€${booking.totalEur.toFixed(2)}`;
  const what = booking.activityTitle || 'a booking';
  // Item-less bookings (rare custom itineraries) have no headcount — omit the guests clause rather
  // than announcing "0 guests".
  const guests = pax > 0 ? `${pax} ${pax === 1 ? 'guest' : 'guests'}, ` : '';
  const refund = message.template === 'owner_refund_pending';
  const line = refund
    ? `${booking.customerName || 'A guest'}'s PAID booking of ${what} on ${when} — ${guests}${total} ` +
      `(ref ${booking.ref}) needs a refund in Peach (oversell race or paid after expiry).`
    : `${booking.customerName || 'A guest'} booked ${what} on ${when} — ${guests}${total} (ref ${booking.ref}).`;
  const adminUrl = `${SITE.url}/admin/bookings?q=${encodeURIComponent(booking.ref)}`;

  // Chat channels (WhatsApp / Telegram) take the same one-glance text — no HTML, no PDF.
  if (message.channel === 'whatsapp' || message.channel === 'telegram') {
    message.text = `${refund ? '⚠️ Refund needed' : '🔔 New paid booking'}\n${line}\n${adminUrl}`;
    return;
  }
  message.subject = refund
    ? `Action needed: refund ${booking.ref} — ${what} · ${total}`
    : `New paid booking — ${what} · ${when} · ${total}`;
  message.text = `${line}\n\nCustomer: ${booking.customerEmail}\nOpen in admin: ${adminUrl}\n\nBelle Mare Tours (internal alert)`;
  message.html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#11201f;line-height:1.5">
      <h2 style="margin:0 0 12px;color:#0B5C63">${refund ? 'Refund needed' : 'New paid booking'}</h2>
      <p style="margin:0 0 14px">${line}</p>
      <table style="border-collapse:collapse;font-size:14px" cellpadding="0">
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Reference</td><td><b>${booking.ref}</b></td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Tour</td><td>${booking.activityTitle}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Date</td><td>${when}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Guests</td><td>${pax}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Total</td><td><b>${total}</b></td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Customer</td><td>${booking.customerName} · ${booking.customerEmail}</td></tr>
      </table>
      <p style="margin:16px 0 0"><a href="${adminUrl}" style="background:#0E8C92;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;display:inline-block">Open in admin</a></p>
    </div>`;
}

/**
 * Owner alert when a guest moves themselves to a different date — the run sheet changed.
 *
 * Unlike {@link enrichOwnerNewBooking} this loads nothing: the outbox payload already carries the ref,
 * the name and both dates, so there is no DB round-trip and no failure mode that could strand the row.
 * Chat channels MUST get `message.text` here — the Telegram provider sends `message.text` verbatim and
 * would otherwise deliver the bare string "Belle Mare Tours — owner_date_changed".
 */
function enrichOwnerDateChanged(message: NotificationMessage & { bookingId: string | null }): void {
  if (message.channel !== 'whatsapp' && message.channel !== 'telegram') return;
  const p = message.payload;
  const ref = typeof p.ref === 'string' ? p.ref : '';
  const who = typeof p.customerName === 'string' && p.customerName ? p.customerName : 'A guest';
  // Slots are materialised at noon Mauritius (08:00 UTC), so the UTC date is the Mauritius date.
  const day = (v: unknown): string =>
    typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : '?';
  const adminUrl = `${SITE.url}/admin/bookings?q=${encodeURIComponent(ref)}`;
  // Same three-line shape as the other owner alerts: headline / one sentence / bare URL last.
  // No parse_mode is set on the Telegram send, so this is plain text — no markdown.
  message.text = `📅 Date changed\n${who} moved booking ${ref} from ${day(p.previousStartsAt)} to ${day(p.startsAt)}.\n${adminUrl}`;
}

/**
 * Review-request email. Payload-only — the enqueue sweep already embedded activityTitle and
 * customerName at insert time (mirroring enrichOwnerDateChanged's no-DB-load pattern), so this is a
 * pure, synchronous render. The Google button is ALWAYS present — see renderReviewRequestEmail.
 */
function enrichReviewRequest(message: NotificationMessage): void {
  const p = message.payload;
  const token = typeof p.token === 'string' ? p.token : '';
  const activityTitle = typeof p.activityTitle === 'string' ? p.activityTitle : 'your trip';
  const customerName =
    typeof p.customerName === 'string' && p.customerName ? p.customerName : 'there';
  const email = renderReviewRequestEmail({
    customerName,
    activityTitle,
    siteReviewUrl: `${SITE.url}/reviews/write?token=${encodeURIComponent(token)}`,
    googleReviewUrl: SITE.googleReview,
  });
  message.subject = email.subject;
  message.html = email.html;
  message.text = email.text;
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
      resolveOwnerRecipient(message);
      if (message.template === 'booking_confirmation') {
        await enrichBookingConfirmation(ctx, message);
      } else if (
        message.template === 'owner_new_booking' ||
        message.template === 'owner_refund_pending'
      ) {
        await enrichOwnerNewBooking(ctx, message);
      } else if (message.template === 'owner_date_changed') {
        enrichOwnerDateChanged(message);
      } else if (message.template === 'review_request') {
        enrichReviewRequest(message);
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
