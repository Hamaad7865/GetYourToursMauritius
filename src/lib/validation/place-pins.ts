import { z } from 'zod';

/** POST /api/v1/admin/place-pins — ask for map pins for itinerary stop names (staff, Tours section). */
export const placePinsRequestSchema = z.object({
  names: z.array(z.string().trim().min(1).max(200)).min(1).max(12),
});

const pinSchema = z.object({ lat: z.number(), lng: z.number() });

/** Keyed by the name as sent. null = no place found (or a generic phrase that is not a place); a name
 *  missing from the map = the lookup failed in transit — ask again on the next save. */
export const placePinsResponseSchema = z.object({
  pins: z.record(z.string(), pinSchema.nullable()),
});
export type PlacePinsResponse = z.infer<typeof placePinsResponseSchema>;
