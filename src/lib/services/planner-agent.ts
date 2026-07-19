import { generateText, tool, type LanguageModelV1 } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { getServerEnv } from '@/lib/config/env';
import { resolveItinerary, searchPlannerPlaces, type ResolvedItinerary } from '@/lib/planner/tools';
import { MAX_STOPS } from '@/lib/planner/constraints';
import { searchBmtActivitiesForDay, type BmtCandidate } from '@/lib/planner/our-activities';
import { placeDetailsByIds } from '@/lib/maps/google-places';
import type { PlannedRoute } from '@/lib/maps/route-planning';
import type { PlannerPlace, PlannerTrip } from '@/lib/validation/planner';

/**
 * The AI Road Trip Planner co-pilot. A Gemini tool-calling agent that plans a day GROUNDED in real
 * Google Places + real drive times — it must never invent a place, a drive time or a price (those
 * come from search_places / set_itinerary, which call Google Places + the Routes API). Non-streaming
 * (generateText, multi-step) for a simple, testable contract; streaming can be layered on later.
 *
 * Two modes share this file:
 *  - single-day (no `trip` input): the original prompt + tools, byte-for-byte unchanged behaviour;
 *  - range mode (`trip` present): plans a whole date range (≤ 7 days), weaving in lunch/dinner
 *    restaurants and availability-checked Belle Mare Tours activities via search_our_activities.
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

const RANGE_SYSTEM_PROMPT = `You are ZilAi, a friendly local trip-planning assistant for a Mauritius road-trip planner. The visitor is planning a MULTI-DAY trip; plan each date of their range.

Rules:
- ONLY suggest real places returned by the search_places tool, and only Belle Mare Tours activities returned by the search_our_activities tool. Never invent places, drive times, opening hours, prices or availability.
- Plan each day around ONE region (adjacent regions are fine). NEVER mix far-apart regions in one day: North with South, or East with West. Across the trip, vary the regions so the visitor sees different parts of the island.
- A driving day has at most 6 stops INCLUDING one lunch restaurant on the route (use search_places with category Food in the day's region). Also choose one dinner restaurant for the evening (dinnerPlaceId) — it is a suggestion near where they're staying, not a route stop.
- Belle Mare Tours activities: call search_our_activities with the trip dates (and a region when you have one). Each result is availability-checked for its exact date. Recommend at most ONE per day, never the same activity on two days, and attach it to the day via activitySlug — only slugs returned by search_our_activities are valid. Mention its real price. On a day with a recommended activity, keep the driving plan light (or empty for a full-day activity). If nothing is available, say so honestly and plan a great driving day instead.
- Commit your plan with set_trip_plan, sending ONLY the days you are creating or changing (each with its date and the ordered place ids). It returns each day's real drive time plus any ids it rejected (too far from that day), dropped (over the 6-stop cap) or didn't recognise — use those exact facts and NEVER claim a rejected or dropped stop was added.
- The visitor's current day plans (listed below) are your starting point. To modify a day, send its existing stop ids PLUS/MINUS the change — never wipe a day the visitor didn't ask you to change. Vague asks ("add a beach") apply to the day they are viewing.
- If set_trip_plan reports unknownIds, drop only those ids and try again — keep every stop that resolved.
- Be warm and concise. Summarise the trip day by day, with each day's total driving time.`;

/** The visitor's current day, rendered for the system prompt so the model can keep/modify it (rather
 *  than rebuilding from scratch and silently dropping stops it was never told about). */
function currentDayContext(places: PlannerPlace[]): string {
  if (!places.length) return '';
  const lines = places.map((p, i) => `  ${i + 1}. ${p.name} [id: ${p.id}]`).join('\n');
  return `\n\nThe visitor's current day already has these stops, in order:\n${lines}\nReuse these exact ids when you call set_itinerary so they are kept.`;
}

/** The whole trip, rendered for the range-mode system prompt: dates, each day's current stops (with
 *  ids the model must reuse), dinner + anchored activity, and which day the visitor is viewing. */
function currentTripContext(trip: PlannerTrip): string {
  const dayLines = trip.days
    .map((d, i) => {
      const stops = d.places.length
        ? d.places.map((p, j) => `${j + 1}. ${p.name} [id: ${p.id}]`).join(' · ')
        : 'no stops yet';
      const dinner = d.dinner ? `dinner: ${d.dinner.name} [id: ${d.dinner.id}]` : 'dinner: none';
      const activity = d.activitySlug
        ? `Belle Mare Tours activity: ${d.activitySlug}`
        : 'Belle Mare Tours activity: none';
      return `  Day ${i + 1} — ${d.date}: ${stops} | ${dinner} | ${activity}`;
    })
    .join('\n');
  return `\n\nThe trip runs ${trip.from} to ${trip.to} (${trip.days.length} days). The visitor is viewing ${trip.activeDate}.\nCurrent day plans:\n${dayLines}\nReuse these exact ids in set_trip_plan to keep a day's existing stops.`;
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
  /** Range mode: the whole multi-day trip. When present the agent plans across days. */
  trip?: PlannerTrip;
}

/** One committed day of a range-mode turn. */
export interface PlannerDayResult {
  date: string;
  places: PlannerPlace[];
  dinner: PlannerPlace | null;
  activitySlug: string | null;
  route: PlannedRoute;
  rejectedFarRegion: string[];
  droppedOverCap: string[];
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
  /** Range mode: the days committed this turn (client merges them into the trip by date). */
  days: PlannerDayResult[];
  /** Range mode: availability-checked Belle Mare Tours candidates surfaced this turn, so the client
   *  can render recommendation cards + branded markers without re-fetching. */
  recommendations: BmtCandidate[];
}

const EMPTY_RESULT: Omit<PlannerTurnResult, 'reply'> = {
  places: [],
  route: null,
  rejectedFarRegion: [],
  droppedOverCap: [],
  days: [],
  recommendations: [],
};

/** Availability lookups are DB RPCs fanned out per date — bound the whole turn, not just one call. */
const MAX_AVAILABILITY_DATES_PER_TURN = 14;

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
      ...EMPTY_RESULT,
    };
  }

  const apiKey = mapsKey();
  const trip = input.trip;
  let committed: ResolvedItinerary | null = null;
  // Places returned by search_places this turn, reused by set_itinerary so committing doesn't re-fetch.
  // Seeded with the current day/trip so the model can re-commit its existing stops (add/reorder)
  // without a re-search — otherwise those ids resolve as unknown and the day gets wiped.
  const discovered = new Map<string, PlannerPlace>();
  for (const p of input.itinerary ?? []) discovered.set(p.id, p);
  for (const d of trip?.days ?? []) {
    for (const p of d.places) discovered.set(p.id, p);
    if (d.dinner) discovered.set(d.dinner.id, d.dinner);
  }

  // Range mode bookkeeping: committed days (last write per date wins), surfaced BMT candidates (the
  // ONLY slugs a commit may anchor — the model can't invent an activity), and a per-turn availability
  // budget so one chat turn can't fan out unbounded DB lookups.
  const committedDays = new Map<string, PlannerDayResult>();
  const surfacedBmt = new Map<string, BmtCandidate>();
  const validDates = new Set((trip?.days ?? []).map((d) => d.date));
  const existingByDate = new Map((trip?.days ?? []).map((d) => [d.date, d.places]));
  const anchoredByDate = new Map(
    (trip?.days ?? []).flatMap((d) => (d.activitySlug ? [[d.date, d.activitySlug] as const] : [])),
  );
  let availabilityDatesUsed = 0;

  const searchPlacesTool = tool({
    description:
      'Search real Mauritius places (live Google Places) by free text, category and/or region.',
    parameters: z.object({
      query: z.string().optional(),
      category: z
        .string()
        .optional()
        .describe('Beach|Waterfall|Viewpoint|Nature|Culture|Garden|Island|Market|Landmark|Food'),
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
  });

  const singleDayTools = {
    search_places: searchPlacesTool,
    set_itinerary: tool({
      description:
        'Commit the chosen day as an ordered list of place ids. Returns the real total drive time, any unknown ids, ids rejected as too far from the day, and ids dropped over the 6-stop cap.',
      parameters: z.object({ placeIds: z.array(z.string()).min(1).max(MAX_STOPS) }),
      execute: async ({ placeIds }) => {
        const resolved = await resolveItinerary(
          placeIds,
          discovered,
          apiKey,
          input.itinerary ?? [],
        );
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

  /** Resolve one place id (dinner) from this turn's discoveries, else a single Place Details call. */
  async function resolveOnePlace(id: string): Promise<PlannerPlace | null> {
    const known = discovered.get(id);
    if (known) return known;
    if (!apiKey) return null;
    try {
      const [place] = await placeDetailsByIds([id], apiKey);
      if (place) discovered.set(place.id, place);
      return place ?? null;
    } catch {
      return null;
    }
  }

  const rangeTools = {
    search_places: searchPlacesTool,
    search_our_activities: tool({
      description:
        "Search Belle Mare Tours' own bookable activities for specific trip dates. Every result is availability-checked for its date (real seats). Optionally filter by region and/or category keyword.",
      parameters: z.object({
        dates: z.array(z.string()).min(1).max(7).describe('Trip dates to check, YYYY-MM-DD'),
        region: z.string().optional().describe('North|South|East|West|Central'),
        category: z.string().optional().describe('e.g. Catamaran|Hiking|Snorkeling'),
      }),
      execute: async ({ dates, region, category }) => {
        const wanted = [...new Set(dates)].filter(
          (d) => validDates.size === 0 || validDates.has(d),
        );
        const results: Array<{
          date: string;
          activities: Array<{
            slug: string;
            title: string;
            category: string;
            region: string | null;
            fromPriceEur: number | null;
            ratingAvg: number | null;
            ratingCount: number;
            seatsLeft: number;
            durationMinutes: number | null;
          }>;
        }> = [];
        for (const date of wanted) {
          if (availabilityDatesUsed >= MAX_AVAILABILITY_DATES_PER_TURN) break;
          availabilityDatesUsed += 1;
          const candidates = await searchBmtActivitiesForDay(
            ctx,
            { date, region: region ?? null, category: category ?? null },
            apiKey,
          );
          for (const c of candidates) surfacedBmt.set(c.slug, c);
          results.push({
            date,
            activities: candidates.map((c) => ({
              slug: c.slug,
              title: c.title,
              category: c.category,
              region: c.region,
              fromPriceEur: c.fromPriceEur,
              ratingAvg: c.ratingAvg,
              ratingCount: c.ratingCount,
              seatsLeft: c.seatsLeft,
              durationMinutes: c.durationMinutes,
            })),
          });
        }
        return { results, note: results.length ? undefined : 'No dates checked — use trip dates.' };
      },
    }),
    set_trip_plan: tool({
      description:
        "Commit the plan for one or more trip days (only the days you are creating or changing). Each day: its date, the ordered place ids (lunch included), an optional dinnerPlaceId, and an optional activitySlug from search_our_activities. Returns each day's real drive time and any unknown/rejected/dropped ids.",
      parameters: z.object({
        days: z
          .array(
            z.object({
              date: z.string().describe('One of the trip dates, YYYY-MM-DD'),
              placeIds: z.array(z.string()).max(MAX_STOPS),
              dinnerPlaceId: z.string().optional(),
              activitySlug: z.string().optional(),
            }),
          )
          .min(1)
          .max(7),
      }),
      execute: async ({ days }) => {
        const perDay: Array<Record<string, unknown>> = [];
        const unknownDates: string[] = [];
        // One activity is never recommended twice in a trip: a slug is blocked if any OTHER day —
        // committed this turn or pre-existing — already anchors it.
        const slugElsewhere = (date: string, slug: string): boolean => {
          for (const [d, result] of committedDays) {
            if (d !== date && result.activitySlug === slug) return true;
          }
          for (const [d, s] of anchoredByDate) {
            if (d !== date && s === slug) return true;
          }
          return false;
        };

        for (const day of days) {
          if (!validDates.has(day.date)) {
            unknownDates.push(day.date);
            continue;
          }
          const resolved = await resolveItinerary(
            day.placeIds,
            discovered,
            apiKey,
            existingByDate.get(day.date) ?? [],
          );
          const dinner = day.dinnerPlaceId ? await resolveOnePlace(day.dinnerPlaceId) : null;

          let activitySlug: string | null = null;
          let activityNote: string | undefined;
          if (day.activitySlug) {
            const known =
              surfacedBmt.has(day.activitySlug) ||
              anchoredByDate.get(day.date) === day.activitySlug;
            if (!known) {
              activityNote = `activitySlug ${day.activitySlug} was not returned by search_our_activities — dropped.`;
            } else if (slugElsewhere(day.date, day.activitySlug)) {
              activityNote = `activitySlug ${day.activitySlug} is already used on another day — dropped.`;
            } else {
              activitySlug = day.activitySlug;
            }
          }

          committedDays.set(day.date, {
            date: day.date,
            places: resolved.places,
            dinner,
            activitySlug,
            route: resolved.route,
            rejectedFarRegion: resolved.rejectedFarRegion.map((p) => p.name),
            droppedOverCap: resolved.droppedOverCap.map((p) => p.name),
          });
          perDay.push({
            date: day.date,
            stops: resolved.places.map((p) => p.name),
            unknownIds: resolved.unknownIds,
            rejectedFarRegion: resolved.rejectedFarRegion.map((p) => p.name),
            droppedOverCap: resolved.droppedOverCap.map((p) => p.name),
            totalDriveMinutes: resolved.route.totalMinutes,
            dinner: dinner?.name ?? null,
            ...(dinner === null && day.dinnerPlaceId ? { unknownDinnerId: day.dinnerPlaceId } : {}),
            activitySlug,
            ...(activityNote ? { activityNote } : {}),
          });
        }
        return { days: perDay, ...(unknownDates.length ? { unknownDates } : {}) };
      },
    }),
  };

  const result = await generateText({
    model,
    system: trip
      ? RANGE_SYSTEM_PROMPT + currentTripContext(trip)
      : SYSTEM_PROMPT + currentDayContext(input.itinerary ?? []),
    messages: input.messages,
    tools: trip ? rangeTools : singleDayTools,
    // Each step can call a BILLED tool (search_places → Google Places, set_itinerary → Routes API), so
    // this bounds the billed fan-out per turn. Single-day: search → commit → reply, so 4 leaves
    // headroom for one retry. Range mode plans up to 7 days (region searches + Food searches + our
    // activities + commit + a retry), so it gets a higher — still hard — cap.
    maxSteps: trip ? 12 : 4,
  });

  const itinerary = committed as ResolvedItinerary | null;
  const days = [...committedDays.values()].sort((a, b) => a.date.localeCompare(b.date));
  // Only surface candidates the client needs: every candidate shown this turn (cards render from
  // these), deduped by slug.
  const recommendations = [...surfacedBmt.values()];
  return {
    reply: result.text,
    places: itinerary ? itinerary.places : [],
    route: itinerary ? itinerary.route : null,
    rejectedFarRegion: itinerary ? itinerary.rejectedFarRegion.map((p) => p.name) : [],
    droppedOverCap: itinerary ? itinerary.droppedOverCap.map((p) => p.name) : [],
    days,
    recommendations,
  };
}
