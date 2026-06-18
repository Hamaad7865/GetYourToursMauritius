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

/** One turn in the planner chat. Tool/system turns are server-managed, so the client only sends these. */
export const plannerChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

/** Request body for POST /api/ai/trip-planner — the running conversation. */
export const plannerChatInputSchema = z.object({
  messages: z.array(plannerChatMessageSchema).min(1).max(40),
});
export type PlannerChatInput = z.infer<typeof plannerChatInputSchema>;

/** Request body for POST /api/ai/place-insights — the day's places to write insights about. */
export const placeInsightsInputSchema = z.object({
  places: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        category: z.string().max(60),
        region: z.string().max(60),
      }),
    )
    .min(1)
    .max(12),
});
export type PlaceInsightsInput = z.infer<typeof placeInsightsInputSchema>;
