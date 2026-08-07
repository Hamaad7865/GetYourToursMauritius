import { z } from 'zod';

/**
 * Saved-card metadata returned to the account screen. The opaque Peach `registrationId` token is
 * DELIBERATELY absent — it never leaves the server (the reuse flow reads it via the service-role
 * `api_list_card_tokens`).
 */
export const savedCardSchema = z.object({
  id: z.string(),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  expMonth: z.number().nullable(),
  expYear: z.number().nullable(),
  createdAt: z.string(),
});
export type SavedCard = z.infer<typeof savedCardSchema>;

export const deleteSavedCardResultSchema = z.object({ id: z.string(), deleted: z.literal(true) });
