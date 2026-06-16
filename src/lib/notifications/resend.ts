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
  return { subject: `Belle Mare Tours — ${message.template}`, text: `Reference: ${ref}` };
}

/**
 * Resend (https://resend.com) transactional-email provider. Edge-safe: a single fetch + JSON,
 * no SDK. Only the email channel is wired today; other channels are skipped (not failed).
 */
export class ResendNotificationProvider implements NotificationProvider {
  readonly name = 'resend';

  constructor(private readonly config: { apiKey: string; from: string }) {}

  async send(message: NotificationMessage): Promise<void> {
    if (message.channel !== 'email') return;
    const { subject, text } = render(message);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: this.config.from, to: message.recipient, subject, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 200)}`);
    }
  }
}
