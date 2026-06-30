import { z } from 'zod';

/** A rental vehicle as returned by `api_list_rental_vehicles` (active fleet, camelCased, EUR amounts).
 *  This is the public shape the /rent page renders; admin write types live in src/lib/admin/rental.ts. */
export const rentalVehicleSchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  seats: z.number().int(),
  transmission: z.string().nullable(),
  airCon: z.boolean(),
  imageUrl: z.string().nullable(),
  dailyRateEur: z.number(),
  depositEur: z.number(),
  sort: z.number().int(),
});
export type RentalVehicle = z.infer<typeof rentalVehicleSchema>;

export const rentalVehiclesSchema = z.array(rentalVehicleSchema);
