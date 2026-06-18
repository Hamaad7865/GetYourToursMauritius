import { generateText, tool, type LanguageModelV1 } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { getServerEnv } from '@/lib/config/env';
import { resolveItinerary, searchPlannerPlaces, type ResolvedItinerary } from '@/lib/planner/tools';
import type { PlannedRoute } from '@/lib/maps/route-planning';
import type { PlannerPlace } from '@/lib/validation/planner';

/**
 * The AI Road Trip Planner co-pilot. A Gemini tool-calling agent that plans a day GROUNDED in real
 * Google Places + real drive times — it must never invent a place, a drive time or a price (those
 * come from search_places / set_itinerary, which call Google Places + the Routes API). Non-streaming
 * (generateText, multi-step) for a simple, testable contract; streaming can be layered on later.
 *
 * When no Gemini model is configured (the stub provider, or no key — e.g. tests/CI), it returns a
 * graceful fallback so the page still works (browse + build manually).
 */
const SYSTEM_PROMPT = `You are the friendly local co-pilot for a Mauritius road-trip planner. Help the visitor build a one-day itinerary.

Rules:
- ONLY suggest real places returned by the search_places tool. Never invent places, drive times, opening hours or prices.
- Use search_places to find candidates (by region/category/free text). Keep a day realistic: 3–5 stops.
- When you've chosen the day, call set_itinerary with the ordered place ids. It returns the real drive time and any warning — use those exact facts in your reply.
- If set_itinerary reports unknownIds, drop them and try again with valid ids from search_places.
- Be warm and concise. Mention the total driving time. If it warns about too many stops, gently suggest trimming.`;

/** Build the real Gemini model, or null when unconfigured (stub provider / missing key). */
export function plannerModel(ctx: ServiceContext): LanguageModelV1 | null {
  if (ctx.ai.name !== 'google') return null;
  const env = getServerEnv();
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) return null;
  return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(ctx.ai.model);
}

function mapsKey(): string | null {
  const env = getServerEnv();
  return env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
}

export interface PlannerTurnInput {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}
export interface PlannerTurnResult {
  reply: string;
  /** The committed itinerary's full places (empty if the model didn't set one this turn). The client
   *  adds these to its catalogue, so live Google places render on the map without a re-fetch. */
  places: PlannerPlace[];
  /** Server-computed route for the committed itinerary, or null. */
  route: PlannedRoute | null;
  warning: string | null;
}

export async function runPlannerTurn(ctx: ServiceContext, input: PlannerTurnInput): Promise<PlannerTurnResult> {
  const model = plannerModel(ctx);
  if (!model) {
    return {
      reply:
        "I can't reach the AI co-pilot right now — but you can still browse the places and build your day on the map, and I'll price it instantly.",
      places: [],
      route: null,
      warning: null,
    };
  }

  const apiKey = mapsKey();
  let committed: ResolvedItinerary | null = null;
  // Places returned by search_places this turn, reused by set_itinerary so committing doesn't re-fetch.
  const discovered = new Map<string, PlannerPlace>();

  const tools = {
    search_places: tool({
      description: 'Search real Mauritius places (live Google Places) by free text, category and/or region.',
      parameters: z.object({
        query: z.string().optional(),
        category: z.string().optional().describe('Beach|Waterfall|Viewpoint|Nature|Culture|Garden|Island|Market|Landmark|Food'),
        region: z.string().optional().describe('North|South|East|West|Central'),
      }),
      execute: async (args) => {
        const places = await searchPlannerPlaces(args, apiKey);
        for (const p of places) discovered.set(p.id, p);
        return places.slice(0, 12).map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          region: p.region,
          durationMin: p.durationMin,
          closesAt: p.closesAt,
          blurb: p.blurb,
        }));
      },
    }),
    set_itinerary: tool({
      description:
        'Commit the chosen day as an ordered list of place ids. Returns the real total drive time, any unknown ids, and a warning if there are too many stops.',
      parameters: z.object({ placeIds: z.array(z.string()).min(1).max(12) }),
      execute: async ({ placeIds }) => {
        const resolved = await resolveItinerary(placeIds, discovered, apiKey);
        committed = resolved;
        return {
          stops: resolved.places.map((p) => p.name),
          unknownIds: resolved.unknownIds,
          totalDriveMinutes: resolved.route.totalMinutes,
          estimate: resolved.route.estimate,
          warning: resolved.warning,
        };
      },
    }),
  };

  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: input.messages,
    tools,
    maxSteps: 6,
  });

  const itinerary = committed as ResolvedItinerary | null;
  return {
    reply: result.text,
    places: itinerary ? itinerary.places : [],
    route: itinerary ? itinerary.route : null,
    warning: itinerary ? itinerary.warning : null,
  };
}
