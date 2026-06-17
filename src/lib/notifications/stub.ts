import type { NotificationMessage, NotificationProvider } from './types';

/**
 * No-op provider for local dev, CI and tests — there is no email account, so it simply resolves
 * and the drain marks the row sent. Lets the full enqueue → drain path run end-to-end offline.
 */
export class StubNotificationProvider implements NotificationProvider {
  readonly name = 'stub';

  async send(_message: NotificationMessage): Promise<void> {
    // intentionally does nothing
  }
}
