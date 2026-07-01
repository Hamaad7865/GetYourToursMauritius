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
  // Age band (admin-set) for the GetYourGuide-style party selector. Null on non-age tiers. `.nullish().catch`
  // so a payload from a DB without the age columns still parses (degrades to a non-age tier).
  minAge: z.number().int().nonnegative().nullish().catch(null),
  maxAge: z.number().int().nonnegative().nullish().catch(null),
});
export type TourPrice = z.infer<typeof tourPriceSchema>;

/** Global sightseeing vehicle-pricing config, returned for vehicle-mode tours so the booking widget
 *  mirrors the server's exact numbers (price is still recomputed server-side at booking time). */
export const vehiclePricingSchema = z.object({
  sedanEur: z.number().nonnegative(),
  suvEur: z.number().nonnegative(),
  familyEur: z.number().nonnegative(),
  vanEur: z.number().nonnegative(),
  coasterEur: z.number().nonnegative(),
  maxParty: z.number().int().positive(),
});
export type VehiclePricing = z.infer<typeof vehiclePricingSchema>;

/** One band's flat fares (minor units), for the region-based transport add-on. Mirrors
 *  transport_band_pricing; only returned for per_person / per_group tours with pickup. */
export const transportBandFareSchema = z.object({
  sedanMinor: z.number().nonnegative(),
  suvMinor: z.number().nonnegative(),
  familyMinor: z.number().nonnegative(),
  vanMinor: z.number().nonnegative(),
  coasterMinor: z.number().nonnegative(),
});
/** Fares keyed by band (same|near|far). */
export const transportBandsSchema = z.record(z.string(), transportBandFareSchema);
export type TransportBands = z.infer<typeof transportBandsSchema>;
/** Unordered region-pair (`${lo}|${hi}`) -> near|far. */
export const regionDistancesSchema = z.record(z.string(), z.enum(['near', 'far']));
export type RegionDistances = z.infer<typeof regionDistancesSchema>;

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
  // Minimum advance booking (lead time) in days. Listing cards show a "Book N+ days ahead" badge when
  // > 1. `.default(1).catch(1)` so a summary from a DB without the column reads as the old behaviour.
  minAdvanceDays: z.number().int().nonnegative().default(1).catch(1),
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

/** A swappable alternative place for a stop (no nested options — one level deep). */
export const altStopSchema = z.object({
  title: z.string(),
  area: z.string().nullable().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});
export type AltStop = z.infer<typeof altStopSchema>;

export const itineraryStopSchema = z.object({
  title: z.string(),
  area: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  /** Alternatives the customer can pick INSTEAD of this stop's primary place. */
  options: z.array(altStopSchema).optional(),
});
export type ItineraryStop = z.infer<typeof itineraryStopSchema>;

/** A custom, editable highlights badge ({ icon, title, subtitle }) shown on the activity page. */
export const activityBadgeSchema = z.object({
  icon: z.string(),
  title: z.string(),
  subtitle: z.string().default(''),
});
export type ActivityBadge = z.infer<typeof activityBadgeSchema>;

/** GetYourGuide-style presentational extras (itinerary, know-before-you-go, overview). */
export const activityExtraSchema = z.object({
  itinerary: z.array(itineraryStopSchema).optional(),
  importantInfo: z.array(z.string()).optional(),
  availability: z.string().nullable().optional(),
  startWindow: z.string().nullable().optional(),
  returnWindow: z.string().nullable().optional(),
  badges: z.array(activityBadgeSchema).optional(),
});
export type ActivityExtra = z.infer<typeof activityExtraSchema>;

export const tourDetailSchema = tourSummarySchema.extend({
  description: z.string().nullable(),
  meetingPoint: z.string().nullable(),
  pickupAvailable: z.boolean(),
  // Home/boarding region + coords for the region-based transport add-on. `.nullish().catch` so the page
  // still renders against a DB where the transport migration hasn't been applied yet.
  region: z.string().nullish().catch(null),
  lat: z.number().nullish().catch(null),
  lng: z.number().nullish().catch(null),
  // Global transport fare tables, returned only for per_person / per_group tours that offer pickup.
  transportBands: transportBandsSchema.nullish().catch(undefined),
  regionDistances: regionDistancesSchema.nullish().catch(undefined),
  // Airport transfer: the zone × vehicle fare matrix (keyed `zone1`/`zone2`) + the return discount,
  // returned only for the airport-transfer product (`isAirportTransfer`). `.catch` so an old-shaped
  // (region-keyed) payload degrades gracefully.
  isAirportTransfer: z.boolean().default(false).catch(false),
  airportFares: z.record(z.string(), transportBandFareSchema).nullish().catch(undefined),
  returnDiscountPct: z.number().int().nullish().catch(undefined),
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
  /** Present only for vehicle-mode (sightseeing) tours — the flat per-vehicle prices. `.catch` so an
   *  old-shaped config (before the flat-pricing catch-up runs on live) degrades to the defaults
   *  instead of crashing the page. */
  vehiclePricing: vehiclePricingSchema.nullish().catch(undefined),
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
  /** "From" price range in EUR (matched against the displayed fromPriceEur). */
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  /** Duration range in minutes. */
  durationMin: z.coerce.number().int().nonnegative().optional(),
  durationMax: z.coerce.number().int().nonnegative().optional(),
  /** Minimum average rating (0–5). */
  minRating: z.coerce.number().min(0).max(5).optional(),
});
export type SearchToursQuery = z.infer<typeof searchToursQuerySchema>;

/** GET /activities/facets query — the q/category/type scope to compute slider bounds for. */
export const facetsQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  category: categorySchema.optional(),
  type: tourTypeSchema.optional(),
});
export type FacetsQuery = z.infer<typeof facetsQuerySchema>;

/** Filter-slider bounds for the current scope. Null when the scope is empty. */
export const facetsSchema = z.object({
  priceMinEur: z.number().nullable(),
  priceMaxEur: z.number().nullable(),
  durationMin: z.number().int().nullable(),
  durationMax: z.number().int().nullable(),
});
export type Facets = z.infer<typeof facetsSchema>;

/** A browse category (mirror of the public `categories` read). */
export const categorySummarySchema = z.object({
  name: z.string(),
  slug: z.string(),
  imageUrl: z.string().nullable(),
});
export type CategorySummary = z.infer<typeof categorySummarySchema>;

export const availabilityQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
