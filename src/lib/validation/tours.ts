import { z } from 'zod';
import { categorySchema, paginationQuerySchema, tourTypeSchema } from './common';

export const tourPriceSchema = z.object({
  id: z.string(),
  label: z.string(),
  amountEur: z.number().nonnegative(),
  maxGuests: z.number().int().positive().nullable(),
});
export type TourPrice = z.infer<typeof tourPriceSchema>;

export const tourImageSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  alt: z.string().nullable(),
  position: z.number().int(),
});
export type TourImage = z.infer<typeof tourImageSchema>;

export const tourSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  type: tourTypeSchema,
  title: z.string(),
  summary: z.string().nullable(),
  category: categorySchema,
  location: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  fromPriceEur: z.number().nonnegative().nullable(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
  heroImage: tourImageSchema.nullable(),
});
export type TourSummary = z.infer<typeof tourSummarySchema>;

export const tourDetailSchema = tourSummarySchema.extend({
  description: z.string().nullable(),
  meetingPoint: z.string().nullable(),
  pickupAvailable: z.boolean(),
  languages: z.array(z.string()),
  inclusions: z.array(z.string()),
  exclusions: z.array(z.string()),
  highlights: z.array(z.string()),
  cancellationPolicy: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  prices: z.array(tourPriceSchema),
  images: z.array(tourImageSchema),
});
export type TourDetail = z.infer<typeof tourDetailSchema>;

export const searchToursQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  category: categorySchema.optional(),
  type: tourTypeSchema.optional(),
});
export type SearchToursQuery = z.infer<typeof searchToursQuerySchema>;
