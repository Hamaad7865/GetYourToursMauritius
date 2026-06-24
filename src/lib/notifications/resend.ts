import type { NotificationMessage, NotificationProvider } from './types';

/** Renders a minimal subject/body per template. Templates can grow into proper HTML later. */
function render(message: NotificationMessage): { subject: string; text: string } {
  const p = message.payload;
  const ref = typeof p.ref === 'string' ? p.ref : '';
  const name = typeof p.customerName === 'string' && p.customerName ? p.customerName : 'there';

  if (message.template === 'booking_confirmation') {
    const currency = typeof p.currency === 'string' ? p.currency : 'EUR';
    const total =
      typeof p.totalMinor === 'number' ? ` (total ${currency} ${(p.totalMinor / 100).toFixed(2)})` : '';
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
      typeof p.totalMinor === 'number' ? ` (${currency} ${(p.totalMinor / 100).toFixed(2)})` : '';
    return {
      subject: `Action needed: booking ${ref} cancelled — refund to process`,
      text: `${name} cancelled booking ${ref}${total}. It is now refund_pending and the seat has been released.\n\nRefund it in the Peach dashboard, then mark it refunded in admin.\n\nBelle Mare Tours (internal alert)`,
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
export class ResendNotificationProvider implements NotificationProvider {
  readonly name = 'resend';

  constructor(private readonly config: { apiKey: string; from: string }) {}

  async send(message: NotificationMessage): Promise<void> {
    if (message.channel !== 'email') {
      throw new Error(`Resend cannot deliver channel '${message.channel}' — no provider configured`);
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
      html?: string;
      attachments?: Array<{ filename: string; content: string }>;
    } = { from: this.config.from, to: message.recipient, subject, text };
    if (message.html) body.html = message.html;
    if (message.attachments?.length) {
      // Resend's attachment shape is { filename, content } where content is base64; it infers the
      // MIME type from the filename, so we deliberately omit contentType to stay on the safe shape.
      body.attachments = message.attachments.map((a) => ({ filename: a.filename, content: a.content }));
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
