import { z } from 'zod';

/** The seven operator categories (English primary). */
export const TOUR_CATEGORIES = [
  'Catamaran cruises',
  'Île aux Cerfs',
  'Dolphin swims',
  'Sea walks & diving',
  'Parasailing',
  'Island tours',
  'Airport transfers',
] as const;

export const categorySchema = z.enum(TOUR_CATEGORIES);
export type Category = z.infer<typeof categorySchema>;

export const tourTypeSchema = z.enum(['activity', 'transport']);
export type TourType = z.infer<typeof tourTypeSchema>;

export const tourStatusSchema = z.enum(['draft', 'published']);
export type TourStatus = z.infer<typeof tourStatusSchema>;

export const localeSchema = z.enum(['en', 'fr']);
export type Locale = z.infer<typeof localeSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
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
