import type { NotificationMessage, NotificationProvider } from './types';

/**
 * Meta WhatsApp Cloud API provider (graph.facebook.com). Edge-safe: a single fetch + JSON, no SDK.
 *
 * Delivery modes:
 *  - `templateName` set → sends that pre-approved template with ONE body parameter carrying the whole
 *    alert line. WhatsApp only delivers business-initiated messages outside a 24-hour customer-service
 *    window via approved templates, so this is the reliable mode for owner alerts. Approve a template
 *    like: "New booking: {{1}}".
 *  - otherwise → a plain text message (delivers only inside an open 24h session — fine for testing:
 *    message the business number once from the owner phone to open one).
 *
 * Mirrors the Resend provider's stance: a channel this provider can't deliver FAILS (never a silent
 * success), so the outbox row stays visible instead of black-holing.
 */
export class WhatsAppNotificationProvider implements NotificationProvider {
  readonly name = 'whatsapp-cloud';

  constructor(
    private readonly config: {
      accessToken: string;
      phoneNumberId: string;
      templateName?: string;
      /** Must match the template's APPROVED locale exactly (e.g. 'en' vs 'en_US') or Meta rejects. */
      templateLanguage?: string;
    },
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    if (message.channel !== 'whatsapp') {
      throw new Error(`WhatsApp provider cannot deliver channel '${message.channel}'`);
    }
    const to = message.recipient.replace(/[^\d]/g, '');
    if (!to) {
      throw new Error('whatsapp send failed: empty recipient number');
    }
    const text = message.text ?? `Belle Mare Tours — ${message.template}`;

    // Meta rejects template BODY parameters containing newlines/tabs or 4+ consecutive spaces
    // ("Param text cannot have new-line/tab characters ..."), so the multi-line alert must be
    // flattened for template mode — otherwise every owner alert bounces and burns its retries.
    const templateParam = text
      .replace(/[\n\t]+/g, ' · ')
      .replace(/ {2,}/g, ' ')
      .trim();
    const body = this.config.templateName
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: this.config.templateName,
            language: { code: this.config.templateLanguage ?? 'en' },
            components: [{ type: 'body', parameters: [{ type: 'text', text: templateParam }] }],
          },
        }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };

    const res = await fetch(
      `https://graph.facebook.com/v20.0/${this.config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`WhatsApp send failed (${res.status}): ${detail.slice(0, 200)}`);
    }
  }
}
