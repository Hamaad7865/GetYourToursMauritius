import { z } from 'zod';

/** The seven original categories — now the seed/fallback list, not a closed set. Categories
 *  are managed dynamically in the `categories` table, so validation accepts any non-empty
 *  category name rather than a fixed enum. */
export const TOUR_CATEGORIES = [
  'Catamaran cruises',
  'Île aux Cerfs',
  'Dolphin swims',
  'Sea walks & diving',
  'Parasailing',
  'Sightseeing tours',
] as const;

export const categorySchema = z.string().min(1).max(80);
export type Category = string;

export const tourTypeSchema = z.enum(['activity', 'transport']);
export type TourType = z.infer<typeof tourTypeSchema>;

export const tourStatusSchema = z.enum(['draft', 'published']);
export type TourStatus = z.infer<typeof tourStatusSchema>;

export const bookingStatusSchema = z.enum([
  'draft',
  'held',
  'payment_pending',
  'confirmed',
  'completed',
  'cancelled',
  'expired',
  'refund_pending',
  'refunded',
  'failed',
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const paymentStateSchema = z.enum([
  'pending',
  'paid',
  'partially_refunded',
  'refunded',
  'failed',
]);
export type PaymentState = z.infer<typeof paymentStateSchema>;

export const bookingSourceSchema = z.enum(['web', 'ai_chat', 'whatsapp']);
export type BookingSource = z.infer<typeof bookingSourceSchema>;

export const localeSchema = z.enum(['en', 'fr']);
export type Locale = z.infer<typeof localeSchema>;

export const paginationQuerySchema = z.object({
  // Upper-bounded so a huge `?page=` can't overflow the int4 OFFSET arithmetic in the api_* SQL
  // (which surfaced as a 502 instead of a clean validation error).
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const errorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** Wraps a data schema in the standard success envelope shape. */
export function successEnvelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    ok: z.literal(true),
    data,
    meta: paginationMetaSchema.optional(),
  });
}
