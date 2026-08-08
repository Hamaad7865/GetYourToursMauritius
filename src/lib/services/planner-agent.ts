import { generateText, tool, type LanguageModelV1 } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { getServerEnv } from '@/lib/config/env';
import { resolveItinerary, searchPlannerPlaces, type ResolvedItinerary } from '@/lib/planner/tools';
import { MAX_STOPS } from '@/lib/planner/constraints';
import { isDayKey, MAX_TRIP_DAYS } from '@/lib/planner/trip';
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
 *  - single-day (no `trip` input): the original prompt + tools, plus search_our_activities so
 *    "tell me about <activity>" questions (the map's branded pins send exactly that) ground on the
 *    real catalogue instead of being declined;
 *  - range mode (`trip` present): plans a whole date range (≤ 7 days), weaving in lunch/dinner
 *    restaurants and availability-checked Belle Mare Tours activities via search_our_activities.
 *
 * When no Gemini model is configured (the stub provider, or no key — e.g. tests/CI), it returns a
 * graceful fallback so the page still works (browse + build manually).
 */
/** The voice, shared by both modes. The earlier prompt ("be warm and concise") produced generic
 *  assistant copy — "I hope this helps you visualize your trip!" — and, worse, apologetic disclaimers
 *  about not being able to show a map, which is the one thing this agent unquestionably CAN do. */
const VOICE = `HOW YOU TALK
- Like a person who lives here, not an assistant. Short: 2–4 sentences, or one line per day when planning a trip. No preamble, no sign-off, no emoji.
- Wrap EVERY place and activity name in double asterisks so it stands out: **Blue Bay Beach**, **Catamaran Cruise – Ile Aux Cerfs**.
- Give one real reason per stop — what it is actually like, when it is best, what to watch for — not adjectives.
- Quote the real total driving time your commit tool returned, and real prices from search_our_activities. Never blur them into vagueness.
- End with ONE concrete next move as a question ("want me to swap the falls for **Le Souffleur**?"), never a menu of options.
- Never write: "I hope this helps", "Let me know if", "Feel free to", "Certainly!", "Great choice!", "As an AI", "I cannot" or "unfortunately".`;

const SYSTEM_PROMPT = `You are ZilAi — a Mauritian who plans days out for visitors, working inside the Belle Mare Tours road-trip planner. You know these roads because you drive them. Help the visitor build a day.

THE MAP IS YOURS TO DRAW
- The visitor's map, day panel and price are drawn ONLY from set_itinerary. A place you name in your reply but never commit does not exist for them: no pin, no route, no price.
- So NEVER list places in prose instead of committing them, and never tell the visitor to look a place up on another map or app. You put it on their map yourself, by calling set_itinerary.
- Never say you are unable to show a map, a route, a price or a booking. You can do all four.
- Answering a question does not end the planning. If the visitor asks about one of our tours and then asks you to plan something, plan it AND commit it.

GROUNDING — never break these
- ONLY suggest real places returned by the search_places tool. Never invent places, drive times, opening hours or prices.
- Use search_places to find candidates (by region/category/free text). A day has at most 6 stops — never propose more.
- Keep the whole day within one area or adjacent areas. NEVER mix far-apart regions in one day: North with South, or East with West. Mauritius is small but cross-island driving wastes the day.
- If the visitor asks for a place that is far from their current day's region (e.g. a North spot when the day is in the South), do NOT call set_itinerary. Keep their day exactly as it is and explain warmly that it's too far to combine in one day — suggest it as a separate trip.
- When you've chosen the day, call set_itinerary with the ordered place ids. It returns the real drive time, plus any ids it rejected (too far) or dropped (over the 6-stop cap) — use those exact facts and NEVER claim a rejected or dropped stop was added.
- If the visitor already has a day (listed below), that is your starting point. To ADD a place, call set_itinerary with the existing stop ids PLUS the new one — never replace the day with only the new place. To remove or reorder, send the full resulting list of ids. Only drop a stop the visitor explicitly asked to remove.
- If set_itinerary reports unknownIds, drop only those ids and try again — keep every stop that resolved.
- Belle Mare Tours' OWN bookable activities: when the visitor asks about one by name (tapping a branded map pin asks exactly that), call search_our_activities with q = that name. Pass dates ONLY if the visitor actually named a day; if they haven't, omit dates and ASK them which date they want — never pick one for them, never say "for <date>", and never quote seats you didn't get back. Answer only from the returned facts — price, rating, duration, and availability when you have a date. The visitor can book from the activity card in this chat.

SPREADING TOURS OVER DAYS
- When more than one of our tours is in play, or the visitor mentions staying several days, don't cram them into one day — lay them out one per day and call propose_trip_days with that split. The visitor gets a card they can accept in one tap, which turns their plan into a real multi-day trip.
- Use only slugs search_our_activities returned, at most one tour per day, in an order that works (a full-day boat trip early in the stay, a hike on a fresh morning) — and say in your reply which tour lands on which day.

${VOICE}`;

const RANGE_SYSTEM_PROMPT = `You are ZilAi — a Mauritian who plans days out for visitors, working inside the Belle Mare Tours road-trip planner. The visitor is planning a MULTI-DAY trip; plan each date of their range.

THE MAP IS YOURS TO DRAW
- Each day's map, day panel and price are drawn ONLY from set_trip_plan. A place you name in your reply but never commit does not exist for the visitor: no pin, no route, no price.
- So NEVER list places in prose instead of committing them, and never tell the visitor to look a place up on another map or app. You put them on the map yourself, by calling set_trip_plan.
- Never say you are unable to show a map, a route, a price or a booking. You can do all four.
- Answering a question does not end the planning. If the visitor asks about one of our tours and then asks you to plan days, plan them AND commit them.

GROUNDING — never break these
- ONLY suggest real places returned by the search_places tool, and only Belle Mare Tours activities returned by the search_our_activities tool. Never invent places, drive times, opening hours, prices or availability.
- Plan each day around ONE region (adjacent regions are fine). NEVER mix far-apart regions in one day: North with South, or East with West. Across the trip, vary the regions so the visitor sees different parts of the island.
- A driving day has at most 6 stops INCLUDING one lunch restaurant on the route (use search_places with category Food in the day's region). Also choose one dinner restaurant for the evening (dinnerPlaceId) — it is a suggestion near where they're staying, not a route stop.
- Commit your plan with set_trip_plan, sending ONLY the days you are creating or changing (each with its date and the ordered place ids). It returns each day's real drive time plus any ids it rejected (too far from that day), dropped (over the 6-stop cap) or didn't recognise — use those exact facts and NEVER claim a rejected or dropped stop was added.
- The visitor's current day plans (listed below) are your starting point. To modify a day, send its existing stop ids PLUS/MINUS the change — never wipe a day the visitor didn't ask you to change. Vague asks ("add a beach") apply to the day they are viewing.
- If set_trip_plan reports unknownIds, drop only those ids and try again — keep every stop that resolved.

SPREADING OUR TOURS OVER THE DAYS
- Call search_our_activities with the trip dates (and a region when you have one; when the visitor asks about ONE specific activity by name — e.g. from a branded map pin — pass q with that exact name). Each result is availability-checked for its exact date. If a result comes back with no date, it was NOT availability-checked: don't imply a day or quote seats, ask which date they mean.
- Spread the tours ACROSS the trip: at most ONE per day, never the same one on two days, matched to that day's region, attached to its day via activitySlug — only slugs returned by search_our_activities are valid. Mention its real price and say plainly which day it lands on.
- On a day with a tour, keep the driving plan light (or empty for a full-day tour). If nothing is available, say so honestly and plan a great driving day instead.

${VOICE}`;

/** Sent back to the model when a turn searched for places but never committed them — the failure the
 *  visitor experiences as "ZilAi described a lovely day and the map stayed empty". */
function commitNudge(commitTool: string): string {
  return (
    `You named places but never called ${commitTool}, so the visitor's map is still empty and none of ` +
    `that plan exists for them. Call ${commitTool} now with the ordered place ids you chose — including ` +
    `the stops already in their day — then reply in one or two sentences saying what you put on their ` +
    `map. Do not tell them to look the places up elsewhere.`
  );
}

/** The tools that actually put something on the visitor's map. */
const COMMIT_TOOLS = new Set(['set_itinerary', 'set_trip_plan']);

/** Every tool name the model called across a turn's steps, in order. */
function toolNames(
  steps: ReadonlyArray<{ readonly toolCalls: ReadonlyArray<{ readonly toolName: string }> }>,
): string[] {
  return steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
}

/** Whether a turn actually put something on the map. */
function committedInSteps(
  steps: ReadonlyArray<{ readonly toolCalls: ReadonlyArray<{ readonly toolName: string }> }>,
): boolean {
  return toolNames(steps).some((n) => COMMIT_TOOLS.has(n));
}

/** True when the model went looking for places and then never put any on the map — the turn shape
 *  behind "ZilAi described a lovely day and nothing appeared". A turn that never searched is just a
 *  conversation (a question about one of our tours, a refusal to cross the island) and is left alone. */
function needsCommitRepair(
  steps: ReadonlyArray<{ readonly toolCalls: ReadonlyArray<{ readonly toolName: string }> }>,
): boolean {
  return toolNames(steps).includes('search_places') && !committedInSteps(steps);
}

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

/** One day of a proposed multi-day split (single-day mode). The client renders it as a card the
 *  visitor can accept, which is what actually creates the trip — the agent never mutates their
 *  plan behind a proposal. */
export interface ProposedTripDay {
  date: string;
  activitySlug: string | null;
  activityTitle: string | null;
  note: string | null;
}

/** A whole proposed trip: contiguous dates from `from` to `to`, one tour at most per day. */
export interface ProposedTrip {
  from: string;
  to: string;
  days: ProposedTripDay[];
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
  /** Single-day mode: a multi-day split ZilAi is OFFERING (tours laid out one per day). Null unless
   *  it called propose_trip_days this turn. Accepting it is the visitor's tap, never ours. */
  proposedTrip: ProposedTrip | null;
}

const EMPTY_RESULT: Omit<PlannerTurnResult, 'reply'> = {
  places: [],
  route: null,
  rejectedFarRegion: [],
  droppedOverCap: [],
  days: [],
  recommendations: [],
  proposedTrip: null,
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
  // Single-day mode: a multi-day split ZilAi is offering. Held, not applied — creating the trip is
  // the visitor's tap on the card.
  let proposed: ProposedTrip | null = null;
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

  // Shared by BOTH modes. Range planning weaves these into trip days; single-day mode uses it to
  // ground "tell me about <activity>" questions (a branded map-pin tap sends exactly that), so the
  // model answers with real price/rating/seat facts instead of declining or inventing them. In
  // single-day mode there are no trip dates, so any well-formed date the model extracts from the
  // conversation is checked (validDates is empty ⇒ the filter below keeps everything).
  const searchOurActivitiesTool = tool({
    description:
      "Search Belle Mare Tours' own bookable activities. With dates, every result is availability-checked for its date (real seats). OMIT dates when the visitor has not said when they want to go — you then get catalogue facts (price, duration, rating) with no availability, and you must ask them which date. Optionally filter by region, category keyword, and/or q — a free-text title match for questions about one specific activity.",
    parameters: z.object({
      dates: z
        .array(z.string())
        .max(7)
        .optional()
        .describe(
          'Dates to check, YYYY-MM-DD. Omit entirely if the visitor has not chosen a date.',
        ),
      region: z.string().optional().describe('North|South|East|West|Central'),
      category: z.string().optional().describe('e.g. Catamaran|Hiking|Snorkeling'),
      q: z
        .string()
        .optional()
        .describe('Free-text activity title match, e.g. "Catamaran Sunset Cruise"'),
    }),
    execute: async ({ dates, region, category, q }) => {
      // No dates ⇒ one unchecked lookup that reports catalogue facts only. Never substitute a
      // default day: quoting seats for a date the visitor never picked presents a choice as already
      // made, which is the bug this branch exists to prevent.
      if (!dates?.length) {
        const candidates = await searchBmtActivitiesForDay(
          ctx,
          { date: null, region: region ?? null, category: category ?? null, q: q ?? null },
          apiKey,
        );
        for (const c of candidates) surfacedBmt.set(c.slug, c);
        return {
          results: [
            {
              date: null,
              activities: candidates.map((c) => ({
                slug: c.slug,
                title: c.title,
                category: c.category,
                region: c.region,
                fromPriceEur: c.fromPriceEur,
                ratingAvg: c.ratingAvg,
                ratingCount: c.ratingCount,
                durationMinutes: c.durationMinutes,
                minAdvanceDays: c.minAdvanceDays,
              })),
            },
          ],
          note: 'No date given, so these are NOT availability-checked. Do not state or imply a date, and do not quote seats — ask the visitor which date they want, then call this tool again with it.',
        };
      }
      const wanted = [...new Set(dates)].filter((d) => validDates.size === 0 || validDates.has(d));
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
          seatsLeft: number | null;
          durationMinutes: number | null;
        }>;
      }> = [];
      for (const date of wanted) {
        if (availabilityDatesUsed >= MAX_AVAILABILITY_DATES_PER_TURN) break;
        availabilityDatesUsed += 1;
        const candidates = await searchBmtActivitiesForDay(
          ctx,
          { date, region: region ?? null, category: category ?? null, q: q ?? null },
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
      return {
        results,
        note: results.length
          ? undefined
          : trip
            ? 'No dates checked — use trip dates.'
            : 'No dates checked — pass real dates (YYYY-MM-DD).',
      };
    },
  });

  const singleDayTools = {
    search_places: searchPlacesTool,
    search_our_activities: searchOurActivitiesTool,
    set_itinerary: tool({
      description:
        'Commit the chosen day as an ordered list of place ids. Returns the real total drive time, any unknown ids, ids rejected as too far from the day, and ids dropped over the 6-stop cap.',
      // No `.min(1)`: an empty array used to fail the SDK's argument validation BEFORE execute ran,
      // and AI_InvalidToolArgumentsError escaped as an unhandled 500 — the visitor saw the planner
      // break because the MODEL made a mistake. (Logged in error_logs on 2026-08-01.) A model slip is
      // a conversational problem, not a server fault: accept the call, refuse to act on it, and hand
      // back a fact the model can recover from on its next turn.
      parameters: z.object({ placeIds: z.array(z.string()).max(MAX_STOPS) }),
      execute: async ({ placeIds }) => {
        if (placeIds.length === 0) {
          // Deliberately does NOT commit: an empty list would otherwise wipe a day the visitor has
          // already built. `committed` is left untouched, so the existing itinerary survives.
          return {
            error: 'no_place_ids',
            message:
              'set_itinerary was called with no place ids, so the day is unchanged. Call ' +
              'search_places first, then call set_itinerary again with the ordered ids you want — ' +
              'including the stops already in the day if you are adding to it.',
          };
        }
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
    propose_trip_days: tool({
      description:
        'Offer the visitor a multi-day split — our tours laid out one per day, in order. Use it when more than one of our tours is in play, or when they mention staying several days. This does NOT change their plan: it renders a card they can accept in one tap, which is what creates the trip. Dates are real calendar days (YYYY-MM-DD).',
      // No `.min`/`.max` on the array and no length cap on `note`: an out-of-range argument fails the
      // SDK's validation BEFORE execute runs and escapes as an unhandled 500, so a model slip would
      // break the planner rather than the proposal. Everything is clamped inside instead.
      parameters: z.object({
        days: z.array(
          z.object({
            date: z.string().describe('YYYY-MM-DD, one calendar day of their stay'),
            activitySlug: z
              .string()
              .optional()
              .describe('A slug search_our_activities returned — never invent one'),
            note: z.string().optional().describe('One short line on what that day looks like'),
          }),
        ),
      }),
      execute: async ({ days }) => {
        const seenDate = new Set<string>();
        const seenSlug = new Set<string>();
        const kept: ProposedTripDay[] = [];
        const droppedDates: string[] = [];
        const droppedSlugs: string[] = [];
        for (const day of days) {
          if (kept.length >= MAX_TRIP_DAYS) break;
          if (!isDayKey(day.date) || seenDate.has(day.date)) {
            droppedDates.push(day.date);
            continue;
          }
          seenDate.add(day.date);
          // A slug survives only if search_our_activities surfaced it THIS turn and no earlier day
          // took it — the visitor must never be offered a tour we can't actually sell them that day.
          let activitySlug: string | null = null;
          let activityTitle: string | null = null;
          if (day.activitySlug) {
            const candidate = surfacedBmt.get(day.activitySlug);
            if (candidate && !seenSlug.has(day.activitySlug)) {
              seenSlug.add(day.activitySlug);
              activitySlug = candidate.slug;
              activityTitle = candidate.title;
            } else {
              droppedSlugs.push(day.activitySlug);
            }
          }
          kept.push({
            date: day.date,
            activitySlug,
            activityTitle,
            note: day.note?.trim().slice(0, 140) || null,
          });
        }
        if (kept.length < 2) {
          proposed = null;
          return {
            error: 'not_enough_days',
            message:
              'A split needs at least two real dates (YYYY-MM-DD). Ask the visitor which days they ' +
              'are here, then call propose_trip_days again — their plan is unchanged.',
          };
        }
        kept.sort((a, b) => a.date.localeCompare(b.date));
        proposed = { from: kept[0]!.date, to: kept[kept.length - 1]!.date, days: kept };
        return {
          proposed: kept.map((d) => ({ date: d.date, activity: d.activityTitle })),
          ...(droppedDates.length ? { droppedDates } : {}),
          ...(droppedSlugs.length
            ? {
                droppedSlugs,
                note: 'Those slugs were not returned by search_our_activities this turn, or were already used on an earlier day, so they were dropped. Do not mention them as booked.',
              }
            : {}),
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
    search_our_activities: searchOurActivitiesTool,
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

  const system = trip
    ? RANGE_SYSTEM_PROMPT + currentTripContext(trip)
    : SYSTEM_PROMPT + currentDayContext(input.itinerary ?? []);
  const tools = trip ? rangeTools : singleDayTools;

  const result = await generateText({
    model,
    system,
    messages: input.messages,
    tools,
    // Each step can call a BILLED tool (search_places → Google Places, set_itinerary → Routes API), so
    // this bounds the billed fan-out per turn. Single-day: search → commit → reply, so 4 leaves
    // headroom for one retry. Range mode plans up to 7 days (region searches + Food searches + our
    // activities + commit + a retry), so it gets a higher — still hard — cap.
    maxSteps: trip ? 12 : 4,
  });

  // ── the plan has to reach the map ──
  // A turn that searched for places and then only DESCRIBED them leaves the visitor with a wall of
  // prose and an empty map. Gemini reaches for this whenever a turn drifts into answering mode —
  // observed verbatim as "I cannot directly display a map for you. However, you can easily find these
  // locations on any map application by searching for their names". The prompt now forbids it; this is
  // the net under the prompt. One bounded repair turn, only on that exact turn shape, and it keeps the
  // original reply if the model still won't commit — a stubborn model must never break the chat.
  let reply = result.text;
  if (needsCommitRepair(result.steps)) {
    try {
      const repair = await generateText({
        model,
        system,
        messages: [
          ...input.messages,
          ...result.response.messages,
          { role: 'user' as const, content: commitNudge(trip ? 'set_trip_plan' : 'set_itinerary') },
        ],
        tools,
        maxSteps: 3,
      });
      // Only adopt the repair's words if it actually committed — otherwise the visitor would get a
      // second helping of the same prose with the map still empty.
      if (committedInSteps(repair.steps) && repair.text.trim()) reply = repair.text;
    } catch {
      /* the repair is best-effort — the visitor still gets the original reply */
    }
  }

  const itinerary = committed as ResolvedItinerary | null;
  const days = [...committedDays.values()].sort((a, b) => a.date.localeCompare(b.date));
  // Only surface candidates the client needs: every candidate shown this turn (cards render from
  // these), deduped by slug.
  const recommendations = [...surfacedBmt.values()];
  return {
    reply,
    places: itinerary ? itinerary.places : [],
    route: itinerary ? itinerary.route : null,
    rejectedFarRegion: itinerary ? itinerary.rejectedFarRegion.map((p) => p.name) : [],
    droppedOverCap: itinerary ? itinerary.droppedOverCap.map((p) => p.name) : [],
    days,
    recommendations,
    proposedTrip: proposed as ProposedTrip | null,
  };
}
