import type { NotificationMessage, NotificationProvider } from './types';

/**
 * Telegram Bot API provider (api.telegram.org). Edge-safe: a single fetch per recipient, no SDK.
 *
 * Carries the OWNER alerts (owner_new_booking / owner_refund_pending). The drain sets `message.text`
 * (the same one-glance summary + admin link the WhatsApp path used), and Telegram delivers it as plain
 * text with clickable links — no template approval, no per-message payment, unlike the WhatsApp Cloud API.
 *
 * `recipient` is a Telegram chat id: a GROUP chat id (recommended — put the owner + staff in one group
 * so everyone sees every booking) or a comma-separated list of chat ids to fan out to several people.
 *
 * Mirrors the other providers' stance: a channel/recipient this can't deliver FAILS (never a silent
 * success), so the outbox row stays visible and retries instead of black-holing.
 */
export class TelegramNotificationProvider implements NotificationProvider {
  readonly name = 'telegram-bot';

  constructor(private readonly config: { botToken: string }) {}

  async send(message: NotificationMessage): Promise<void> {
    if (message.channel !== 'telegram') {
      throw new Error(`Telegram provider cannot deliver channel '${message.channel}'`);
    }
    const chatIds = message.recipient
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (chatIds.length === 0) {
      throw new Error('telegram send failed: empty chat id');
    }
    const text = message.text ?? `Belle Mare Tours — ${message.template}`;

    // Send to each chat id. Owner alerts are almost always a single group chat, so this is one call;
    // when a list is configured we attempt them all and fail if ANY didn't deliver, so a partial
    // outage is visible (the row retries — a rare duplicate to the owner beats a missed booking alert).
    const failures: string[] = [];
    for (const chatId of chatIds) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            // Owner alerts carry an /admin link; suppress the big link-preview card so it stays compact.
            disable_web_page_preview: true,
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          failures.push(`${chatId}: ${res.status} ${detail.slice(0, 120)}`);
        }
      } catch (e) {
        failures.push(`${chatId}: ${e instanceof Error ? e.message : 'fetch failed'}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Telegram send failed for ${failures.length}/${chatIds.length}: ${failures.join('; ').slice(0, 200)}`,
      );
    }
  }
}
