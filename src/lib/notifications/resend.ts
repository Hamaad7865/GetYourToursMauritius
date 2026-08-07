import { SITE } from '@/lib/seo/site';
import type { NotificationMessage, NotificationProvider } from './types';

/** Why we called a departure off, as a phrase that completes "because of …". */
const DISRUPTION_REASON: Record<string, string> = {
  weather: 'the weather',
  sea_conditions: 'the sea conditions',
  safety: 'a safety call',
  min_group: 'too few travellers on the day',
};

/**
 * The calendar day of an occurrence timestamp. Slots are materialised at NOON Mauritius (08:00 UTC),
 * so the UTC calendar date and the Mauritius one always coincide — slicing the ISO string is safe and
 * matches how the owner alerts already render `booking.when`.
 */
function dayOf(value: unknown): string {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : 'your booked date';
}

/** ` (card: MUR 5938.00)` when the payload carries a cross-currency card charge, else ''. The owner
 *  refunds by hand in Peach where the transaction is MUR, so refund-flavoured alerts append this
 *  whenever the enqueueing side supplies it (enriched alerts already do; SQL-built payloads may not). */
function chargedNote(p: Record<string, unknown>): string {
  const minor = p.chargedAmountMinor;
  const ccy = p.chargedCurrency;
  return typeof minor === 'number' && minor > 0 && typeof ccy === 'string' && ccy !== 'EUR'
    ? ` (card: ${ccy} ${(minor / 100).toFixed(2)})`
    : '';
}

/** Renders a minimal subject/body per template. Templates can grow into proper HTML later. */
function render(message: NotificationMessage): { subject: string; text: string } {
  const p = message.payload;
  const ref = typeof p.ref === 'string' ? p.ref : '';
  const name = typeof p.customerName === 'string' && p.customerName ? p.customerName : 'there';
  const bookingUrl = `${SITE.url}/bookings/${ref}`;

  if (message.template === 'booking_confirmation') {
    const currency = typeof p.currency === 'string' ? p.currency : 'EUR';
    const total =
      typeof p.totalMinor === 'number'
        ? ` (total ${currency} ${(p.totalMinor / 100).toFixed(2)})`
        : '';
    return {
      subject: `Your Belle Mare Tours booking ${ref} is confirmed`,
      text: `Hi ${name},\n\nGood news — your booking ${ref} is confirmed${total}. We look forward to welcoming you.\n\nBelle Mare Tours`,
    };
  }
  if (message.template === 'booking_refunded') {
    return {
      subject: `Your Belle Mare Tours booking ${ref} has been refunded`,
      text: `Hi ${name},\n\nYour booking ${ref} has been refunded. Please allow a few days for it to appear on your statement.\n\nBelle Mare Tours`,
    };
  }
  // Owner-facing alert: the customer self-cancelled; the owner must process the refund in Peach.
  if (message.template === 'booking_cancellation') {
    const currency = typeof p.currency === 'string' ? p.currency : 'EUR';
    const total =
      typeof p.totalMinor === 'number'
        ? ` (${currency} ${(p.totalMinor / 100).toFixed(2)}${chargedNote(p)})`
        : '';
    return {
      subject: `Action needed: booking ${ref} cancelled — refund to process`,
      text: `${name} cancelled booking ${ref}${total}. It is now refund_pending and the seat has been released.\n\nRefund it in the Peach dashboard, then mark it refunded in admin.\n\nBelle Mare Tours (internal alert)`,
    };
  }
  if (message.template === 'booking_refund_pending') {
    return {
      subject: `Your Belle Mare Tours booking ${ref} — refund on its way`,
      text: `Hi ${name},

We couldn't confirm your booking ${ref} (the last spots were taken as your payment completed), so we're refunding you in full. You don't need to do anything — the refund is being processed and will appear on your statement within a few days.

Sorry for the inconvenience — we'd love to host you on another date.

Belle Mare Tours`,
    };
  }
  // Owner-facing: money was captured but the booking can't stand — process the refund in Peach.
  if (message.template === 'owner_refund_pending') {
    const currency = typeof p.currency === 'string' ? p.currency : 'EUR';
    const total =
      typeof p.totalMinor === 'number'
        ? ` (${currency} ${(p.totalMinor / 100).toFixed(2)}${chargedNote(p)})`
        : '';
    return {
      subject: `Action needed: booking ${ref} is refund_pending — refund to process`,
      text: `Booking ${ref}${total} by ${name} was PAID but could not stand (oversell race or paid after expiry). It is now refund_pending.

Refund it in the Peach dashboard, then mark it refunded in admin.

Belle Mare Tours (internal alert)`,
    };
  }
  // WE called the departure off. The guest owes us a choice, so the whole mail points at one link.
  if (message.template === 'booking_weather_disrupted') {
    const when = dayOf(p.startsAt);
    const reason =
      DISRUPTION_REASON[typeof p.reason === 'string' ? p.reason : 'weather'] ?? 'the conditions';
    return {
      subject: `Your Belle Mare Tours trip on ${when} has been called off`,
      text: `Hi ${name},

We've had to call off your trip on ${when} (booking ${ref}) because of ${reason}. We're sorry — we don't make that call lightly, and getting you out there safely comes first.

What happens next is your choice, and both options are free:

  • Move to another date that suits you
  • Take a full refund

Choose here: ${bookingUrl}

If you'd rather talk it through, just reply to this email.

Belle Mare Tours`,
    };
  }
  if (message.template === 'booking_rescheduled') {
    const when = dayOf(p.startsAt);
    return {
      subject: `Your Belle Mare Tours booking ${ref} is now on ${when}`,
      text: `Hi ${name},

That's sorted — booking ${ref} has moved to ${when}. Everything else stays exactly as it was, and there's nothing more to pay.

Your booking: ${bookingUrl}

See you there.

Belle Mare Tours`,
    };
  }
  // The guest's own confirmation of a cancellation. Serves both a plain self-cancel and taking the
  // refund arm of a called-off trip — deliberately reason-neutral so it is honest in both.
  if (message.template === 'booking_cancelled_confirmation') {
    return {
      subject: `Your Belle Mare Tours booking ${ref} is cancelled — refund on its way`,
      text: `Hi ${name},

We've cancelled booking ${ref} as you asked, and your refund is on its way. You don't need to do anything — it goes back to the card you paid with and usually lands within a few days.

We'd love to host you another time.

Belle Mare Tours`,
    };
  }
  // Owner-facing: a guest moved themselves to a different date — the run sheet changed.
  if (message.template === 'owner_date_changed') {
    const to = dayOf(p.startsAt);
    const from = dayOf(p.previousStartsAt);
    return {
      subject: `Date changed: ${ref} moved to ${to}`,
      text: `${name} moved booking ${ref} from ${from} to ${to}.

Open in admin: ${SITE.url}/admin/bookings?q=${encodeURIComponent(ref)}

Belle Mare Tours (internal alert)`,
    };
  }
  // Late pickup, owner side. Email only by design: the Telegram/WhatsApp owner channels are unset in
  // production and resolveOwnerRecipient throws for them, so enqueuing those rows would only create
  // permanently-failing outbox entries.
  if (message.template === 'owner_pickup_set') {
    const fee =
      typeof p.feeEur === 'number' && p.feeEur > 0 ? ` (supplement €${p.feeEur.toFixed(2)})` : '';
    const where = typeof p.pickupLocation === 'string' ? p.pickupLocation : 'an address';
    const phone =
      typeof p.customerPhone === 'string' && p.customerPhone ? `\nPhone: ${p.customerPhone}` : '';
    return {
      subject: `Pickup set: ${ref} — ${where}`,
      text: `${name} set their pickup for ${ref}${fee}.

Pick-up: ${where}${phone}
Trip: ${typeof p.activityTitle === 'string' ? p.activityTitle : ''} · ${dayOf(p.startsAt)}

Open in admin: ${SITE.url}/admin/bookings?q=${encodeURIComponent(ref)}

Belle Mare Tours (internal alert)`,
    };
  }
  if (message.template === 'owner_pickup_missing') {
    // Whether the guest was chased at all decides what the owner should DO, so it decides the copy.
    // On an activity with no online pickup service the guest is never mailed — telling the owner
    // "they have been reminded twice" would be a flat lie, and would make them wait instead of call.
    const chased = p.guestChased !== false;
    const why = chased
      ? `They have been reminded twice.`
      : `They have NOT been chased: this trip can't take a pickup online (${typeof p.refusal === 'string' ? p.refusal : 'not eligible'}), so nothing will reach them automatically — please phone them.`;
    return {
      subject: `No pickup yet: ${ref} departs ${dayOf(p.startsAt)}`,
      text: `${name}'s booking ${ref} departs on ${dayOf(p.startsAt)} and still has NO pickup address — they chose "I'll decide later" and haven't come back. ${why}

Trip: ${typeof p.activityTitle === 'string' ? p.activityTitle : ''}

Open in admin: ${SITE.url}/admin/bookings?q=${encodeURIComponent(ref)}

Belle Mare Tours (internal alert)`,
    };
  }
  // A supplement we took but could not apply — the guest's money is sitting on a booking with no
  // pickup against it. Nobody can refund what nobody knows about, so this alert IS the control.
  if (message.template === 'owner_pickup_orphan_payment') {
    const card =
      typeof p.chargedAmountMinor === 'number' && typeof p.chargedCurrency === 'string'
        ? ` (card: ${p.chargedCurrency} ${(p.chargedAmountMinor / 100).toFixed(2)})`
        : '';
    const fee = typeof p.feeEur === 'number' ? `€${p.feeEur.toFixed(2)}` : 'a pickup supplement';
    return {
      subject: `Action needed: refund ${fee} pickup supplement on ${ref}`,
      text: `${name} paid ${fee}${card} for a late pickup on booking ${ref}, but it could NOT be applied — the trip was called off, or they changed to an address that costs nothing while that payment was still open.

The money is held and no pickup was added. Refund it in the Peach dashboard.

Open in admin: ${SITE.url}/admin/bookings?q=${encodeURIComponent(ref)}

Belle Mare Tours (internal alert)`,
    };
  }
  // Money we did not ask for. Rare by construction, and invisible everywhere else in the ledger —
  // which is exactly why it is worth a loud, specific email rather than a log line.
  if (message.template === 'owner_overpayment') {
    const expected = typeof p.expectedEur === 'number' ? p.expectedEur.toFixed(2) : '?';
    const paid = typeof p.paidEur === 'number' ? p.paidEur.toFixed(2) : '?';
    return {
      subject: `Action needed: ${ref} was overpaid (€${paid} against €${expected})`,
      text: `Booking ${ref} (${name}) has taken MORE money than it asked for on a single payment: €${paid} settled against an expected €${expected}${
        typeof p.purpose === 'string' ? ` (${p.purpose})` : ''
      }.

That normally means one checkout session was completed twice. Check the transactions in the Peach dashboard and refund the duplicate.

Open in admin: ${SITE.url}/admin/bookings?q=${encodeURIComponent(ref)}

Belle Mare Tours (internal alert)`,
    };
  }
  if (message.template === 'booking_expired') {
    return {
      subject: `Your Belle Mare Tours reservation ${ref} has expired`,
      text: `Hi ${name},\n\nYour reservation ${ref} wasn't paid in time, so we've released the seats. If you'd still like to go, just book again on our website — it only takes a minute.\n\nBelle Mare Tours`,
    };
  }
  // Deposit receipt (part-paid quote booking). Normally pre-rendered by enrichBookingConfirmation with
  // the branded HTML + PDF; this is the belt-and-braces text fallback.
  if (message.template === 'deposit_receipt') {
    const currency = typeof p.currency === 'string' ? p.currency : 'EUR';
    const bal =
      typeof p.balanceDueMinor === 'number'
        ? ` (balance ${currency} ${(p.balanceDueMinor / 100).toFixed(2)} still to pay)`
        : '';
    return {
      subject: `Deposit received for your Belle Mare Tours booking ${ref}`,
      text: `Hi ${name},\n\nThanks — we have received your deposit for booking ${ref}${bal}. Your place is reserved; we will email you a secure link to pay the balance.\n\nBelle Mare Tours`,
    };
  }
  // The guest's DEPOSIT-FORFEIT notice — their booking is cancelled and the non-refundable deposit is
  // KEPT (any balance they had paid is refunded). Deliberately NOT booking_refunded, which claims a
  // full refund. `refundedMinor` decides whether a balance was returned (both-paid) or not (deposit-only).
  if (message.template === 'deposit_forfeited') {
    const currency = typeof p.currency === 'string' ? p.currency : 'EUR';
    const deposit =
      typeof p.depositMinor === 'number'
        ? `${currency} ${(p.depositMinor / 100).toFixed(2)}`
        : 'your deposit';
    const refundedMinor = typeof p.refundedMinor === 'number' ? p.refundedMinor : 0;
    const refundLine =
      refundedMinor > 0
        ? `We have refunded the ${currency} ${(refundedMinor / 100).toFixed(2)} balance you had paid — please allow a few days for it to appear on your statement. `
        : '';
    return {
      subject: `Your Belle Mare Tours booking ${ref} has been cancelled`,
      text: `Hi ${name},\n\nYour booking ${ref} has been cancelled. ${refundLine}As agreed when you booked, the deposit of ${deposit} is non-refundable and has been retained.\n\nWe'd be glad to welcome you another time.\n\nBelle Mare Tours`,
    };
  }
  // Owner-facing: the balance on a deposit booking has now been paid, settling it in full.
  if (message.template === 'owner_balance_paid') {
    const currency = typeof p.currency === 'string' ? p.currency : 'EUR';
    const total =
      typeof p.totalMinor === 'number' ? ` (${currency} ${(p.totalMinor / 100).toFixed(2)})` : '';
    return {
      subject: `Balance paid: booking ${ref} settled in full`,
      text: `The balance on booking ${ref}${total} by ${name} has been paid — it is now settled in full. The full VAT invoice has gone to the guest.\n\nBelle Mare Tours (internal alert)`,
    };
  }
  return { subject: `Belle Mare Tours — ${message.template}`, text: `Reference: ${ref}` };
}

/**
 * Resend (https://resend.com) transactional-email provider. Edge-safe: a single fetch + JSON,
 * no SDK. Only the email channel is wired today; a non-email row must FAIL (not silently succeed),
 * otherwise the drain would mark it 'sent' without delivering it. Failing routes it to retry and
 * eventually 'failed', where it is visible — until a provider for that channel exists.
 */
/**
 * Attach the brand name to the From header so an inbox shows "Belle Mare Tours", not the bare mailbox —
 * a plain `info@bellemaretours.com` renders as "info" in Gmail. Left untouched when the configured value
 * already carries a display name (contains "<"), so an env like `Belle Mare Tours <info@…>` still wins.
 */
function fromWithBrandName(from: string): string {
  const value = from.trim();
  return value.includes('<') ? value : `${SITE.name} <${value}>`;
}

export class ResendNotificationProvider implements NotificationProvider {
  readonly name = 'resend';

  /** `from` is the send-only transactional identity (bookings@…); `replyTo` is the monitored human
   *  inbox (info@…), so a customer hitting Reply on a booking email reaches someone. `bcc` (also the
   *  human inbox) silently copies the owner on the CUSTOMER'S confirmation — the exact email + invoice
   *  the guest received — WITHOUT the customer seeing it. Only booking_confirmation is BCC'd; owner
   *  alerts already reach the owner and refund/expiry mails aren't worth copying. */
  constructor(
    private readonly config: { apiKey: string; from: string; replyTo?: string; bcc?: string },
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    if (message.channel !== 'email') {
      throw new Error(
        `Resend cannot deliver channel '${message.channel}' — no provider configured`,
      );
    }
    // A fully pre-rendered message (e.g. the invoice/receipt email) carries its own subject/text/html;
    // use those as-is. Otherwise fall back to render() from the template + payload.
    const rendered = render(message);
    const subject = message.subject ?? rendered.subject;
    const text = message.text ?? rendered.text;

    const body: {
      from: string;
      to: string;
      subject: string;
      text: string;
      reply_to?: string;
      bcc?: string;
      html?: string;
      attachments?: Array<{ filename: string; content: string }>;
      // A per-message `from` overrides the send-only identity for THIS message only (the quote email
      // goes out as the monitored info@ inbox so a guest can hit Reply); absent, config.from is used.
    } = {
      from: fromWithBrandName(message.from ?? this.config.from),
      to: message.recipient,
      subject,
      text,
    };
    // Mail goes out as bookings@ (send-only, unmonitored). Point Reply at the human inbox so a guest
    // replying to their confirmation reaches us instead of a black hole.
    if (this.config.replyTo) body.reply_to = this.config.replyTo;
    // Silently copy the owner on the customer's CONFIRMATION only (the email + invoice the guest got).
    // BCC, so the customer never sees the internal address and a reply-all can't reach it. A BCC that
    // fails to deliver (e.g. info@ routing not set up) never blocks the customer's own copy.
    if (
      this.config.bcc &&
      (message.template === 'booking_confirmation' || message.template === 'deposit_receipt')
    )
      body.bcc = this.config.bcc;
    if (message.html) body.html = message.html;
    if (message.attachments?.length) {
      // Resend's attachment shape is { filename, content } where content is base64; it infers the
      // MIME type from the filename, so we deliberately omit contentType to stay on the safe shape.
      body.attachments = message.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
      }));
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
        // Idempotency: the drain does send -> mark-sent. If the edge worker dies between the two,
        // the row re-claims after its lease and re-sends. Keying on the outbox row id (message.id)
        // lets Resend dedup the retry for 24h, so the customer never gets a second invoice email.
        'Idempotency-Key': `notif:${message.id}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 200)}`);
    }
  }
}
