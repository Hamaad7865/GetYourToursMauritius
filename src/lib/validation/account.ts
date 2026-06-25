import { z } from 'zod';

/** GET/PATCH /account/profile response. */
export const profileSchema = z.object({
  id: z.string(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  role: z.string(),
  memberSince: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

/** PATCH /account/profile body — only provided keys are updated; explicit null clears a field.
 *  `.strict()` rejects unknown keys. */
export const profileUpdateSchema = z
  .object({
    fullName: z.string().trim().max(120).nullish(),
    phone: z.string().trim().max(40).nullish(),
    dateOfBirth: z.string().date().nullish(),
  })
  .strict();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** POST /account/delete result. */
export const deleteAccountResultSchema = z.object({ deleted: z.literal(true) });

/** GET /account/export — the GDPR data export (stable shape; includes dateOfBirth). */
export const accountExportSchema = z.object({
  profile: z.object({
    fullName: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
  }),
  bookings: z.array(
    z.object({
      ref: z.string(),
      status: z.string(),
      date: z.string().nullable(),
      totalEur: z.number(),
      currency: z.string(),
      items: z.array(z.object({ label: z.string(), qty: z.number().int() })),
      pickup: z.string().nullable(),
      dropoff: z.string().nullable(),
      gender: z.string().nullable(),
      company: z.string().nullable(),
      country: z.string().nullable(),
      specialNotes: z.string().nullable(),
      roomOrCabin: z.string().nullable(),
      luggageDetails: z.string().nullable(),
      childSeatAge: z.number().int().nullable(),
      flightNumber: z.string().nullable(),
      arrivalTime: z.string().nullable(),
      returnDate: z.string().nullable(),
      returnTime: z.string().nullable(),
      departureFlightNumber: z.string().nullable(),
    }),
  ),
});
export type AccountExport = z.infer<typeof accountExportSchema>;
