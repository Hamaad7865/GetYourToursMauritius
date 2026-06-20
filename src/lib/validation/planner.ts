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

/** Request body for POST /api/ai/trip-planner — the running conversation. A normal planning chat is a
 *  handful of turns; the cap is kept low (12) so one request can't smuggle a huge transcript that
 *  inflates the billed Gemini token count per call. */
export const plannerChatInputSchema = z.object({
  messages: z.array(plannerChatMessageSchema).min(1).max(12),
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

/** Request body for POST /api/planner/optimize — pickup + the day's stops to order optimally. */
const latLngSchema = z.object({ lat: z.number(), lng: z.number() });
export const plannerOptimizeInputSchema = z.object({
  pickup: latLngSchema,
  stops: z.array(latLngSchema).min(1).max(25),
});
export type PlannerOptimizeInput = z.infer<typeof plannerOptimizeInputSchema>;
