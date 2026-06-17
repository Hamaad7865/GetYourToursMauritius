import { z } from 'zod';

/** A curated road-trip place (from `planner_places` via `api_planner_places`). */
export const plannerPlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  region: z.string(),
  lat: z.number(),
  lng: z.number(),
  durationMin: z.number().int(),
  closesAt: z.string().nullable(),
  blurb: z.string().nullable(),
  imageUrl: z.string().nullable(),
});

export type PlannerPlace = z.infer<typeof plannerPlaceSchema>;
