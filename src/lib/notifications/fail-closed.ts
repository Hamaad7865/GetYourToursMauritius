import type { NotificationMessage, NotificationProvider } from './types';

/**
 * Provider used on a production-like runtime when no real email provider (Resend) is configured.
 *
 * Its `send()` THROWS, so the drain records the row `failed` (and retries it once a key is set)
 * instead of the stub's silent success which would mark every booking email `sent` and black-hole
 * it. The outbox row survives and is visible — the misconfiguration is loud, not silent.
 */
export class FailClosedNotificationProvider implements NotificationProvider {
  readonly name = 'fail-closed';

  async send(_message: NotificationMessage): Promise<void> {
    throw new Error('notifications_not_configured');
  }
}
