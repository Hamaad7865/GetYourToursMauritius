export type NotificationChannel = 'email' | 'whatsapp';

/** A file to attach to an email. `content` is base64-encoded; the provider infers the MIME type
 * from `filename` (Resend), but `contentType` may be carried for providers that accept it. */
export interface NotificationAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

/** One queued notification, as claimed from the outbox. */
export interface NotificationMessage {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  /** Pre-rendered fields. When present they are used as-is instead of re-rendering from the
   * template/payload — this is how a fully-built invoice/receipt email is delivered. */
  subject?: string;
  text?: string;
  html?: string;
  attachments?: NotificationAttachment[];
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
