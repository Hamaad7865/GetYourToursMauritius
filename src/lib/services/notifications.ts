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
import { escapeHtml, renderConfirmationEmail } from '@/lib/email/booking-confirmation';
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
 * for how many (down to the age-band mix and any child seat, which decide what has to be in the vehicle),
 * and for how much — plus the admin deep-link. The email gets subject/text/html; the
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
  const { booking, payment } = await loadBookingForReceipt(ctx, message.bookingId);
  const pax = booking.items.reduce((s, i) => s + (i.pax ?? i.quantity), 0);
  const when = booking.when ? booking.when.slice(0, 10) : 'date TBC';
  // The CARD amount rides along with the EUR total whenever the charge currency differs (MUR since
  // 2026-07-30): the owner refunds BY HAND in the Peach dashboard, where the transaction is MUR — an
  // alert quoting only the euro figure invites refunding the wrong number.
  const chargedNote =
    payment.chargedCurrency.toUpperCase() !== 'EUR' && payment.chargedAmountMinor > 0
      ? ` (card: ${payment.chargedCurrency} ${(payment.chargedAmountMinor / 100).toFixed(2)})`
      : '';
  const total = `€${booking.totalEur.toFixed(2)}${chargedNote}`;
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

  // The age-band MIX, which the bare headcount hides: "4 guests" and "2 × Adult · 1 × Child · 1 × Infant"
  // are very different run sheets (car seats, life jackets, child portions, who may not swim). Per-person
  // lines carry the band in `priceLabel` — one row per band, `quantity` = that band's headcount. A
  // vehicle/bracket booking is instead ONE row with `pax` set, so it's skipped: "1 × Standard car" is a
  // fare line, not a party mix.
  const bands = booking.items
    .filter((i) => i.pax == null && i.quantity > 0)
    .map((i) => `${i.quantity} × ${i.priceLabel}`)
    .join(' · ');

  // Child seats reach us from TWO places, and either one alone can be the whole request: tour/planner
  // bookings carry a seat COUNT (`childSeats`), while the airport-transfer form asks for a seat as a
  // toggle + the child's AGE and leaves the count at 0 — so an age with no count still means "fit a seat".
  const seatCount = booking.childSeats ?? 0;
  const seatAge = booking.transfer?.childSeatAge ?? null;
  const agedNote = seatAge != null ? ` · child aged ${seatAge}` : '';
  // Chat wording (self-describing, no label alongside it) vs the email's label/value row.
  const seatChatNote =
    seatCount > 0
      ? `${seatCount} child seat${seatCount === 1 ? '' : 's'}${agedNote}`
      : seatAge != null
        ? `child seat requested${agedNote}`
        : '';
  const seatRow =
    seatCount > 0
      ? { label: seatCount === 1 ? 'Child seat' : 'Child seats', value: `${seatCount}${agedNote}` }
      : seatAge != null
        ? { label: 'Child seat', value: `requested${agedNote}` }
        : null;

  // Chat channels (WhatsApp / Telegram) take the same one-glance text — no HTML, no PDF — plus the party
  // mix and any child seat (what the owner has to PREPARE), then the phone number when there is one,
  // since that's the fastest way to reach a guest from a phone in hand.
  if (message.channel === 'whatsapp' || message.channel === 'telegram') {
    const bandLine = bands ? `\n👥 ${bands}` : '';
    const seatLine = seatChatNote ? `\n🧒 ${seatChatNote}` : '';
    const phoneLine = booking.customerPhone ? `\n📞 ${booking.customerPhone}` : '';
    message.text = `${refund ? '⚠️ Refund needed' : '🔔 New paid booking'}\n${line}${bandLine}${seatLine}${phoneLine}\n${adminUrl}`;
    return;
  }

  // Everything beyond name/email that helps the owner actually prepare for, reach, or serve the guest:
  // what to PREPARE first (the party mix, any child seat), then the phone, then pickup/dropoff, then —
  // for airport/hotel transfers — the driver's run-sheet fields (already loaded onto `booking.transfer`
  // for the customer's own voucher, just never shown to the owner before). Built as label/value pairs so
  // the plain-text and HTML branches can't drift apart.
  const tr = booking.transfer;
  const details: Array<{ label: string; value: string }> = [];
  if (bands) details.push({ label: 'Party', value: bands });
  if (seatRow) details.push(seatRow);
  if (booking.customerPhone) details.push({ label: 'Phone', value: booking.customerPhone });
  if (booking.pickupLocation) details.push({ label: 'Pick-up', value: booking.pickupLocation });
  if (booking.dropoffLocation) details.push({ label: 'Drop-off', value: booking.dropoffLocation });
  if (tr?.roomOrCabin) details.push({ label: 'Room/cabin', value: tr.roomOrCabin });
  // Luggage decides which vehicle goes out, so it belongs next to the seat count, not just on the voucher.
  if (tr?.luggageDetails) details.push({ label: 'Luggage', value: tr.luggageDetails });
  if (tr && (tr.flightNumber || tr.arrivalTime)) {
    details.push({
      label: 'Arrival flight',
      value: [tr.flightNumber, tr.arrivalTime].filter(Boolean).join(' · '),
    });
  }
  if (tr && (tr.departureFlightNumber || tr.returnDate || tr.returnTime)) {
    details.push({
      label: 'Departure',
      value: [tr.departureFlightNumber, [tr.returnDate, tr.returnTime].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(' · '),
    });
  }
  if (tr?.travellerCountry) details.push({ label: 'Country', value: tr.travellerCountry });
  if (tr?.specialNotes) details.push({ label: 'Notes', value: tr.specialNotes });

  message.subject = refund
    ? `Action needed: refund ${booking.ref} — ${what} · ${total}`
    : `New paid booking — ${what} · ${when} · ${total}`;
  message.text = [
    line,
    '',
    `Customer: ${booking.customerName} · ${booking.customerEmail}`,
    ...details.map((d) => `${d.label}: ${d.value}`),
    `Open in admin: ${adminUrl}`,
    '',
    'Belle Mare Tours (internal alert)',
  ].join('\n');
  // Every interpolated value below is customer-supplied free text (name, phone, pickup notes, special
  // requests…) landing in an HTML email an owner opens in a normal mail client — escape it so a hostile
  // booking field can never break the layout or inject markup (same rule booking-confirmation.ts follows).
  const detailRows = details
    .map(
      (d) =>
        `<tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">${escapeHtml(d.label)}</td><td>${
          d.label === 'Phone'
            ? `<a href="tel:${escapeHtml(d.value)}" style="color:#0E8C92;text-decoration:none">${escapeHtml(d.value)}</a>`
            : escapeHtml(d.value)
        }</td></tr>`,
    )
    .join('');
  message.html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#11201f;line-height:1.5">
      <h2 style="margin:0 0 12px;color:#0B5C63">${refund ? 'Refund needed' : 'New paid booking'}</h2>
      <p style="margin:0 0 14px">${escapeHtml(line)}</p>
      <table style="border-collapse:collapse;font-size:14px" cellpadding="0">
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Reference</td><td><b>${escapeHtml(booking.ref)}</b></td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Tour</td><td>${escapeHtml(booking.activityTitle)}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Date</td><td>${escapeHtml(when)}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Guests</td><td>${pax}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Total</td><td><b>${escapeHtml(total)}</b></td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#5c6b6a">Customer</td><td>${escapeHtml(booking.customerName)} · ${escapeHtml(booking.customerEmail)}</td></tr>
        ${detailRows}
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
  // The guest's stored booking locale (Task 15), carried on the payload by api_enqueue_review_invites
  // — this is sent days later by a cron sweep, off-request, so it's the only correct language source.
  const locale = typeof p.locale === 'string' ? p.locale : null;
  const email = renderReviewRequestEmail({
    customerName,
    activityTitle,
    siteReviewUrl: `${SITE.url}/reviews/write?token=${encodeURIComponent(token)}`,
    googleReviewUrl: SITE.googleReview,
    locale,
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
