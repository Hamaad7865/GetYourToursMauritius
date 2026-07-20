import { getServerEnv } from '@/lib/config/env';
import { isProductionLikeRuntime } from '@/lib/config/runtime';
import { SITE } from '@/lib/seo/site';
import type { NotificationMessage, NotificationProvider } from './types';
import { StubNotificationProvider } from './stub';
import { FailClosedNotificationProvider } from './fail-closed';
import { ResendNotificationProvider } from './resend';
import { WhatsAppNotificationProvider } from './whatsapp';
import { TelegramNotificationProvider } from './telegram';

export * from './types';

/** Routes each message to its channel's provider, so each channel configures independently.
 *  The name spells out every route (e.g. `email:resend whatsapp:fail-closed telegram:telegram-bot`)
 *  for logs and tests. */
class ChannelRouterProvider implements NotificationProvider {
  readonly name: string;

  constructor(
    private readonly channels: {
      email: NotificationProvider;
      whatsapp: NotificationProvider;
      telegram: NotificationProvider;
    },
  ) {
    this.name = `email:${channels.email.name} whatsapp:${channels.whatsapp.name} telegram:${channels.telegram.name}`;
  }

  send(message: NotificationMessage): Promise<void> {
    return this.channels[message.channel].send(message);
  }
}

/**
 * Selects the notification provider from the environment, per channel.
 *
 * Email:
 * - Resend when `RESEND_API_KEY` + `RESEND_FROM` are set (the real provider).
 * - Otherwise FAIL CLOSED on a production-like runtime: the stub's `send()` resolves doing nothing,
 *   so the drain would mark every booking email `sent` and silently black-hole it. On a real
 *   deployment we instead return a provider whose `send()` throws, so the drain marks the row
 *   `failed` (retried once a key is set) and the outbox row stays visible.
 * - Otherwise the no-op stub (local dev / CI / tests run end-to-end with no email account).
 *
 * WhatsApp (owner alerts — revived by migration 20260817000000): the Meta Cloud API provider when
 * `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` are set; the same fail-closed / stub split
 * otherwise. The trigger enqueues owner rows on this channel again — `owner_new_booking_wa` on
 * confirmed, `owner_refund_pending_wa` on refund_pending — alongside the Telegram + email copies,
 * and that redundancy is deliberate: a duplicate beats a missed booking alert. A real deployment
 * needs `OWNER_WHATSAPP_TO` as well, because `resolveOwnerRecipient` throws on it before
 * `provider.send()` is reached, on EVERY runtime (stub included) — so each confirmed booking
 * otherwise burns its 5 drain retries and parks a `failed` outbox row.
 *
 * Telegram (owner alerts): the Bot API provider when `TELEGRAM_BOT_TOKEN` is set; the same fail-closed
 * / stub split otherwise, so an unconfigured Telegram row is a VISIBLE `failed` on production — never
 * a silent success.
 */
export function getNotificationProvider(): NotificationProvider {
  const env = getServerEnv();
  const fallback = isProductionLikeRuntime(env)
    ? new FailClosedNotificationProvider()
    : new StubNotificationProvider();

  const email =
    env.RESEND_API_KEY && env.RESEND_FROM
      ? new ResendNotificationProvider({
          apiKey: env.RESEND_API_KEY,
          // Sends AS bookings@… (RESEND_FROM), a send-only identity nobody reads.
          from: env.RESEND_FROM,
          // Replies land in the monitored human inbox (info@…) instead of a black hole.
          replyTo: SITE.email,
          // Silently copy that same inbox on each customer confirmation, so the owner keeps a record
          // of the exact email + invoice the guest received (BCC — invisible to the customer).
          bcc: SITE.email,
        })
      : fallback;
  const whatsapp =
    env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
      ? new WhatsAppNotificationProvider({
          accessToken: env.WHATSAPP_ACCESS_TOKEN,
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          templateName: env.WHATSAPP_TEMPLATE_NAME,
          templateLanguage: env.WHATSAPP_TEMPLATE_LANG,
        })
      : fallback;
  const telegram = env.TELEGRAM_BOT_TOKEN
    ? new TelegramNotificationProvider({ botToken: env.TELEGRAM_BOT_TOKEN })
    : fallback;

  return new ChannelRouterProvider({ email, whatsapp, telegram });
}
