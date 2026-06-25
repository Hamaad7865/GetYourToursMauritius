import { z } from 'zod';
import { paginationQuerySchema } from './common';

/** One per-user notification (in-app feed item). `data` carries machine-readable context (e.g. the
 *  booking ref) for deep-linking; `readAt` is null until the user opens it. */
export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** GET /notifications query — pagination (like /activities) + an optional unread-only filter. The flag
 *  is an explicit 'true'/'false' (not coerced) so `?unreadOnly=false` doesn't read as truthy. */
export const notificationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

/** POST /notifications/{id}/read result. */
export const markReadResultSchema = z.object({ id: z.string(), readAt: z.string() });

/** POST /notifications/read-all result — how many were flipped from unread to read. */
export const markAllReadResultSchema = z.object({ updated: z.number().int() });
