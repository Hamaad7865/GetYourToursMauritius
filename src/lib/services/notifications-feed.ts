import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import {
  markAllReadResultSchema,
  markReadResultSchema,
  notificationSchema,
  type Notification,
  type NotificationsQuery,
} from '@/lib/validation/notifications';

const feedSchema = z.object({
  items: z.array(notificationSchema),
  total: z.number().int(),
});

/**
 * The signed-in user's notification feed (newest first), with offset pagination and an optional
 * unread-only filter. Owner-scoped by api_my_notifications (auth.uid()). This is a lean, feed-only
 * service kept separate from the heavy outbound drain service (services/notifications.ts) so the edge
 * route doesn't pull in invoice/PDF/email code.
 */
export async function listNotifications(
  ctx: ServiceContext,
  query: NotificationsQuery,
): Promise<{ items: Notification[]; total: number }> {
  const data = await callRpc(ctx, 'api_my_notifications', {
    unreadOnly: query.unreadOnly ?? false,
    page: query.page,
    pageSize: query.pageSize,
  });
  return feedSchema.parse(data ?? { items: [], total: 0 });
}

/** Mark one notification read (owner-scoped; 403 if not the owner, 404 if missing). Idempotent. */
export async function markNotificationRead(
  ctx: ServiceContext,
  id: string,
): Promise<z.infer<typeof markReadResultSchema>> {
  const data = await callRpc(ctx, 'api_mark_notification_read', { id });
  return markReadResultSchema.parse(data);
}

/** Mark all of the caller's unread notifications read; returns the number changed. */
export async function markAllNotificationsRead(
  ctx: ServiceContext,
): Promise<z.infer<typeof markAllReadResultSchema>> {
  const data = await callRpc(ctx, 'api_mark_all_notifications_read', {});
  return markAllReadResultSchema.parse(data);
}
