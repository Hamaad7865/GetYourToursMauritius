import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import type { NotificationProvider } from '@/lib/notifications/types';

const claimedSchema = z.array(
  z.object({
    id: z.string(),
    channel: z.enum(['email', 'whatsapp']),
    recipient: z.string(),
    template: z.string(),
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
);

export interface DrainResult {
  processed: number;
  sent: number;
  failed: number;
}

/**
 * Claim a batch of pending notifications, send each via the provider, and record the result.
 * Sending happens OUTSIDE the booking transaction (this is the out-of-band worker). A send that
 * throws leaves the row pending for retry until attempts run out.
 */
export async function drainNotifications(
  ctx: ServiceContext,
  provider: NotificationProvider,
  limit = 20,
): Promise<DrainResult> {
  const claimed = await callRpc(ctx, 'claim_notifications', { limit });
  const messages = claimedSchema.parse(claimed ?? []);
  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      await provider.send(message);
      await callRpc(ctx, 'mark_notification', { id: message.id, result: 'sent' });
      sent += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'send failed';
      // One-line, secret-free signal so a misconfigured provider (e.g. notifications_not_configured)
      // is loud in the logs instead of a silent black-hole. Only ids + the error message are logged.
      console.error(
        `notification send failed: id=${message.id} template=${message.template} reason=${reason}`,
      );
      await callRpc(ctx, 'mark_notification', { id: message.id, result: 'failed', error: reason });
      failed += 1;
    }
  }
  return { processed: messages.length, sent, failed };
}
