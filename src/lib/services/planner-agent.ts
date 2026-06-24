import { generateText, tool, type LanguageModelV1 } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { getServerEnv } from '@/lib/config/env';
import { resolveItinerary, searchPlannerPlaces, type ResolvedItinerary } from '@/lib/planner/tools';
import { MAX_STOPS } from '@/lib/planner/constraints';
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
const SYSTEM_PROMPT = `You are ZilAi, a friendly local trip-planning assistant for a Mauritius road-trip planner. Help the visitor build a one-day itinerary.

Rules:
- ONLY suggest real places returned by the search_places tool. Never invent places, drive times, opening hours or prices.
- Use search_places to find candidates (by region/category/free text). A day has at most 6 stops — never propose more.
- Keep the whole day within one area or adjacent areas. NEVER mix far-apart regions in one day: North with South, or East with West. Mauritius is small but cross-island driving wastes the day.
- If the visitor asks for a place that is far from their current day's region (e.g. a North spot when the day is in the South), do NOT call set_itinerary. Keep their day exactly as it is and explain warmly that it's too far to combine in one day — suggest it as a separate trip.
- When you've chosen the day, call set_itinerary with the ordered place ids. It returns the real drive time, plus any ids it rejected (too far) or dropped (over the 6-stop cap) — use those exact facts and NEVER claim a rejected or dropped stop was added.
- If the visitor already has a day (listed below), that is your starting point. To ADD a place, call set_itinerary with the existing stop ids PLUS the new one — never replace the day with only the new place. To remove or reorder, send the full resulting list of ids. Only drop a stop the visitor explicitly asked to remove.
- If set_itinerary reports unknownIds, drop only those ids and try again — keep every stop that resolved.
- Be warm and concise. Mention the total driving time.`;

/** The visitor's current day, rendered for the system prompt so the model can keep/modify it (rather
 *  than rebuilding from scratch and silently dropping stops it was never told about). */
function currentDayContext(places: PlannerPlace[]): string {
  if (!places.length) return '';
  const lines = places.map((p, i) => `  ${i + 1}. ${p.name} [id: ${p.id}]`).join('\n');
  return `\n\nThe visitor's current day already has these stops, in order:\n${lines}\nReuse these exact ids when you call set_itinerary so they are kept.`;
}

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
  /** The day the visitor currently has on screen (a preloaded tour, a preset, or one built earlier).
   *  Passed so the model can keep/modify it; its places also seed the resolver so their ids commit
   *  without a re-search. */
  itinerary?: PlannerPlace[];
}
export interface PlannerTurnResult {
  reply: string;
  /** The committed itinerary's full places (empty if the model didn't set one this turn). The client
   *  adds these to its catalogue, so live Google places render on the map without a re-fetch. */
  places: PlannerPlace[];
  /** Server-computed route for the committed itinerary, or null. */
  route: PlannedRoute | null;
  /** Names of stops the model proposed that were rejected as too far from the day's region. */
  rejectedFarRegion: string[];
  /** Names of stops dropped because the day was already at the 6-stop cap. */
  droppedOverCap: string[];
}

export async function runPlannerTurn(
  ctx: ServiceContext,
  input: PlannerTurnInput,
  // Injectable so the agent loop can be tested with a scripted model; defaults to the real Gemini.
  modelOverride?: LanguageModelV1 | null,
): Promise<PlannerTurnResult> {
  const model = modelOverride ?? plannerModel(ctx);
  if (!model) {
    return {
      reply:
        "I can't reach ZilAi right now — but you can still browse the places and build your day on the map, and I'll price it instantly.",
      places: [],
      route: null,
      rejectedFarRegion: [],
      droppedOverCap: [],
    };
  }

  const apiKey = mapsKey();
  let committed: ResolvedItinerary | null = null;
  // Places returned by search_places this turn, reused by set_itinerary so committing doesn't re-fetch.
  // Seeded with the current day so the model can re-commit its existing stops (add/reorder) without a
  // re-search — otherwise those ids resolve as unknown and the day gets wiped down to the new place.
  const discovered = new Map<string, PlannerPlace>();
  for (const p of input.itinerary ?? []) discovered.set(p.id, p);

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
        'Commit the chosen day as an ordered list of place ids. Returns the real total drive time, any unknown ids, ids rejected as too far from the day, and ids dropped over the 6-stop cap.',
      parameters: z.object({ placeIds: z.array(z.string()).min(1).max(MAX_STOPS) }),
      execute: async ({ placeIds }) => {
        const resolved = await resolveItinerary(placeIds, discovered, apiKey, input.itinerary ?? []);
        committed = resolved;
        return {
          stops: resolved.places.map((p) => p.name),
          unknownIds: resolved.unknownIds,
          rejectedFarRegion: resolved.rejectedFarRegion.map((p) => p.name),
          droppedOverCap: resolved.droppedOverCap.map((p) => p.name),
          totalDriveMinutes: resolved.route.totalMinutes,
          estimate: resolved.route.estimate,
        };
      },
    }),
  };

  const result = await generateText({
    model,
    system: SYSTEM_PROMPT + currentDayContext(input.itinerary ?? []),
    messages: input.messages,
    tools,
    // Each step can call a BILLED tool (search_places → Google Places, set_itinerary → Routes API), so
    // this bounds the billed fan-out per turn. A normal plan is: search_places → set_itinerary → reply,
    // so 4 leaves headroom for one retry (e.g. dropping unknownIds) without uncapped tool loops.
    maxSteps: 4,
  });

  const itinerary = committed as ResolvedItinerary | null;
  return {
    reply: result.text,
    places: itinerary ? itinerary.places : [],
    route: itinerary ? itinerary.route : null,
    rejectedFarRegion: itinerary ? itinerary.rejectedFarRegion.map((p) => p.name) : [],
    droppedOverCap: itinerary ? itinerary.droppedOverCap.map((p) => p.name) : [],
  };
}
