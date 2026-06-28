import { z } from 'zod';
import { paginationQuerySchema } from './common';

/** GET /transfers/hotels query — typeahead `q` + pagination. */
export const transferHotelsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
});
export type TransferHotelsQuery = z.infer<typeof transferHotelsQuerySchema>;

/** A bookable airport-transfer hotel: DB-authoritative slug/name/region/zone, enriched with display
 *  extras (area/coords/duration/from-price) from generated content (null when no content exists). */
export const transferHotelSchema = z.object({
  slug: z.string(),
  name: z.string(),
  region: z.string(),
  zone: z.string(),
  area: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  durationMin: z.number().int().nullable(),
  fromPriceEur: z.number().nonnegative().nullable(),
});
export type TransferHotel = z.infer<typeof transferHotelSchema>;

/** A curated point-to-point area, with server-authoritative region + airport zone. */
export const transferAreaSchema = z.object({
  name: z.string(),
  region: z.string(),
  zone: z.string(),
});
export type TransferArea = z.infer<typeof transferAreaSchema>;

/** GET /transfers/quote query. Transfers price by TOTAL passenger count (`pax`); `suv` upgrades the
 *  ≤4-pax bracket; `tripType=return` applies the configured discount. */
export const transferQuoteQuerySchema = z
  .object({
    transferSlug: z.enum(['airport-transfer', 'hotel-transfer']),
    dropoffSlug: z.string().trim().max(120).optional(),
    dropoffArea: z.string().trim().max(120).optional(),
    pickupSlug: z.string().trim().max(120).optional(),
    pickupArea: z.string().trim().max(120).optional(),
    // Coordinates of a free Google-Places end — the server derives the region from them (hotel_end_region,
    // slug→coords→area) exactly as api_book does, so the quote equals the booked charge.
    pickupLat: z.coerce.number().min(-90).max(90).optional(),
    pickupLng: z.coerce.number().min(-180).max(180).optional(),
    dropoffLat: z.coerce.number().min(-90).max(90).optional(),
    dropoffLng: z.coerce.number().min(-180).max(180).optional(),
    pax: z.coerce.number().int().min(1).max(1000).default(1),
    suv: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    tripType: z.enum(['one_way', 'return']).default('one_way'),
  })
  .strict()
  // A destination is required so a quote can never silently fall back to a Zone-1 fare.
  .refine((q) => q.transferSlug !== 'airport-transfer' || Boolean(q.dropoffSlug || q.dropoffArea), {
    message: 'airport-transfer requires dropoffSlug or dropoffArea',
    path: ['dropoffArea'],
  })
  .refine(
    (q) =>
      q.transferSlug !== 'hotel-transfer' ||
      (Boolean(q.pickupSlug || q.pickupArea) && Boolean(q.dropoffSlug || q.dropoffArea)),
    { message: 'hotel-transfer requires both a pickup and a dropoff (slug or area)', path: ['dropoffArea'] },
  );
export type TransferQuoteQuery = z.infer<typeof transferQuoteQuerySchema>;

/** The transfer fare estimate — equal to what api_book charges for the same inputs. */
export const transferQuoteSchema = z.object({
  totalEur: z.number().nonnegative(),
  vehicle: z.string(),
  zoneOrBand: z.string(),
  tripType: z.string(),
  oneWayEur: z.number().nonnegative(),
  returnDiscountPct: z.number().int(),
});
export type TransferQuote = z.infer<typeof transferQuoteSchema>;
