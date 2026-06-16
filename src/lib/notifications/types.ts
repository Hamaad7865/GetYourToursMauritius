export type NotificationChannel = 'email' | 'whatsapp';

/** One queued notification, as claimed from the outbox. */
export interface NotificationMessage {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
}

/**
 * Sends a notification. Selected from the environment (Resend when configured, else a no-op
 * stub for dev/CI) — the analogue of PaymentProvider, so the drain worker is provider-agnostic.
 */
export interface NotificationProvider {
  readonly name: string;
  /** Deliver one message. Throw to mark it failed (it will be retried until attempts run out). */
  send(message: NotificationMessage): Promise<void>;
}
