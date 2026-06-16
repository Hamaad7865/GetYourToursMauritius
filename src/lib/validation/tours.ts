import { z } from 'zod';
import { categorySchema, paginationQuerySchema, tourTypeSchema } from './common';

// Catalogue DTOs — these match the `api_*` Postgres function output exactly.

/** How an activity is priced: per head, per group (ceil), or one flat price by the vehicle the
 *  party needs (sightseeing tours). */
export const pricingModeSchema = z.enum(['per_person', 'per_group', 'vehicle']);
export type PricingMode = z.infer<typeof pricingModeSchema>;

export const tourPriceSchema = z.object({
  id: z.string(),
  label: z.string(),
  amountEur: z.number().nonnegative(),
  maxGuests: z.number().int().positive().nullable(),
});
export type TourPrice = z.infer<typeof tourPriceSchema>;

/** Global sightseeing vehicle-pricing config, returned for vehicle-mode tours so the booking widget
 *  mirrors the server's exact numbers (price is still recomputed server-side at booking time). */
export const vehiclePricingSchema = z.object({
  perBlockEur: z.number().nonnegative(),
  suvFlatEur: z.number().nonnegative(),
  blockSize: z.number().int().positive(),
  maxParty: z.number().int().positive(),
});
export type VehiclePricing = z.infer<typeof vehiclePricingSchema>;

export const tourImageSchema = z.object({
  id: z.string(),
  url: z.string(),
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
  // max_guests of the cheapest tier. For per_group it's the group size ("up to N"); for vehicle
  // it's the smallest vehicle's capacity. Nullish so older summaries still parse.
  fromPriceMaxGuests: z.number().int().positive().nullish(),
  // How fromPriceEur is billed: per_person (× people), per_group (× ceil(people / size)), or
  // vehicle (one flat price for the vehicle that fits the party). Defaults so older DBs parse.
  pricingMode: pricingModeSchema.default('per_person'),
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
  heroImage: tourImageSchema.nullable(),
  images: z.array(tourImageSchema).default([]),
});
export type TourSummary = z.infer<typeof tourSummarySchema>;

export const tourOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  prices: z.array(tourPriceSchema),
});
export type TourOption = z.infer<typeof tourOptionSchema>;

export const tourTranslationSchema = z.object({
  title: z.string().nullable(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
});

export const reviewSchema = z.object({
  id: z.string(),
  author: z.string(),
  rating: z.number().int(),
  text: z.string().nullable(),
  createdAt: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;

export const itineraryStopSchema = z.object({
  title: z.string(),
  area: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});
export type ItineraryStop = z.infer<typeof itineraryStopSchema>;

/** GetYourGuide-style presentational extras (itinerary, know-before-you-go, overview). */
export const activityExtraSchema = z.object({
  itinerary: z.array(itineraryStopSchema).optional(),
  importantInfo: z.array(z.string()).optional(),
  availability: z.string().nullable().optional(),
  startWindow: z.string().nullable().optional(),
  returnWindow: z.string().nullable().optional(),
});
export type ActivityExtra = z.infer<typeof activityExtraSchema>;

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
  extra: activityExtraSchema.default({}),
  images: z.array(tourImageSchema),
  options: z.array(tourOptionSchema),
  translations: z.record(z.string(), tourTranslationSchema),
  reviews: z.array(reviewSchema),
  /** Present only for vehicle-mode (sightseeing) tours — the global pricing rule's numbers. */
  vehiclePricing: vehiclePricingSchema.nullish(),
});
export type TourDetail = z.infer<typeof tourDetailSchema>;

export const availabilitySlotSchema = z.object({
  occurrenceId: z.string(),
  activityOptionId: z.string(),
  optionName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  capacity: z.number().int(),
  seatsLeft: z.number().int(),
  status: z.string(),
});
export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;

export const searchToursQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  category: categorySchema.optional(),
  type: tourTypeSchema.optional(),
});
export type SearchToursQuery = z.infer<typeof searchToursQuerySchema>;

export const availabilityQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
