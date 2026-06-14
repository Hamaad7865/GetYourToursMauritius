import { z } from 'zod';
import { categorySchema, tourStatusSchema, tourTypeSchema } from '@/lib/validation/common';

/** Shape of seed/catalogue.json — validated before it is turned into SQL. */
export const seedPriceSchema = z.object({
  label: z.string(),
  amount_minor: z.number().int().nonnegative(),
  max_guests: z.number().int().positive().nullable(),
});

export const seedOptionSchema = z.object({
  name: z.string(),
  prices: z.array(seedPriceSchema),
});

export const seedTranslationSchema = z.object({
  title: z.string(),
  summary: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const seedImageSchema = z.object({
  url: z.string(),
  alt: z.string().nullable(),
  position: z.number().int(),
});

export const seedActivitySchema = z.object({
  slug: z.string().min(1),
  type: tourTypeSchema,
  category: categorySchema,
  title: z.string().min(1),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  meeting_point: z.string().nullable(),
  duration_minutes: z.number().int().positive().nullable(),
  pickup_available: z.boolean(),
  highlights: z.array(z.string()),
  inclusions: z.array(z.string()),
  exclusions: z.array(z.string()),
  status: tourStatusSchema,
  fr: seedTranslationSchema.nullable().optional(),
  options: z.array(seedOptionSchema),
  images: z.array(seedImageSchema),
});

export const seedOperatorSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  contact_email: z.string().nullable(),
  phone: z.string().nullable(),
});

export const catalogueSchema = z.object({
  _meta: z.unknown().optional(),
  operator: seedOperatorSchema,
  activities: z.array(seedActivitySchema),
});

export type Catalogue = z.infer<typeof catalogueSchema>;
export type SeedActivity = z.infer<typeof seedActivitySchema>;
export type SeedOperator = z.infer<typeof seedOperatorSchema>;
