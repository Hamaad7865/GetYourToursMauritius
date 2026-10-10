import {
  generateText,
  tool,
  stepCountIs,
  InvalidToolInputError,
  NoSuchToolError,
  type LanguageModel,
} from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { executedToolNames, toolExecutionFault } from '@/lib/ai/tool-faults';
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
- When you mention driving, quote the real time BETWEEN STOPS your commit tool returned, and call it that. The drive from the visitor's pick-up and back is on top of it and is shown in their plan, so never call your figure the day's total. Quote real prices from search_our_activities. Never blur either into vagueness.
- End with ONE concrete next move as a question ("want me to swap the falls for **Le Souffleur**?"), never a menu of options.
- Never write: "I hope this helps", "Let me know if", "Feel free to", "Certainly!", "Great choice!", "As an AI", "I cannot" or "unfortunately".`;

/** What the commit tools also carry, and what hearted stops mean. Shared by both modes: the result
 *  cards are filled from these fields, so a plan committed without them renders as bare names. */
const CARDS_AND_HEARTS = `THE RESULT CARDS
- Every commit also carries what is printed on the visitor's result cards. Send a short "title" for the day (what it is, e.g. "Blue Bay and the wild south coast" — no date, no "Day 1") and, for EVERY stop, a "notes" entry: "why" is one or two plain sentences on what the stop is actually like and what to do there; "tip" is one short line on when or for whom it works best ("Best first thing, before the tour buses", "Skip it after heavy rain").
- Write them the way you talk: specific, no adjectives doing the work, no place name repeated back, no asterisks.

HEARTED STOPS
- Stops listed as hearted are ones the visitor chose to keep. They stay in the plan whatever else changes — never drop, replace or move them to another day.
- "Regenerate" means: keep every hearted stop and replace the others with DIFFERENT real places from search_places, then commit.`;

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

${CARDS_AND_HEARTS}

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

${CARDS_AND_HEARTS}

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

/** Said when a turn ends with the model having fumbled its tool calls rather than answered. */
const LOST_THREAD_REPLY =
  "Sorry — I lost my thread there. Could you say that again? Everything you've planned so far is safe.";

/** The tools that actually put something on the visitor's map. */
const COMMIT_TOOLS = new Set(['set_itinerary', 'set_trip_plan']);

type LoopSteps = Parameters<typeof executedToolNames>[0];

/** Whether a turn actually put something on the map. A commit call the SDK rejected as malformed
 *  never ran, so it does not count. */
function committedInSteps(steps: LoopSteps): boolean {
  return executedToolNames(steps).some((n) => COMMIT_TOOLS.has(n));
}

/** True when the model went looking for places and then never put any on the map — the turn shape
 *  behind "ZilAi described a lovely day and nothing appeared". A turn that never searched is just a
 *  conversation (a question about one of our tours, a refusal to cross the island) and is left alone. */
function needsCommitRepair(steps: LoopSteps): boolean {
  return executedToolNames(steps).includes('search_places') && !committedInSteps(steps);
}

/** The visitor's current day, rendered for the system prompt so the model can keep/modify it (rather
 *  than rebuilding from scratch and silently dropping stops it was never told about). */
function currentDayContext(places: PlannerPlace[], pinned: ReadonlySet<string>): string {
  if (!places.length) return '';
  const lines = places
    .map((p, i) => `  ${i + 1}. ${p.name} [id: ${p.id}]${pinned.has(p.id) ? ' (hearted)' : ''}`)
    .join('\n');
  return `\n\nThe visitor's current day already has these stops, in order:\n${lines}\nReuse these exact ids when you call set_itinerary so they are kept.`;
}

/** The whole trip, rendered for the range-mode system prompt: dates, each day's current stops (with
 *  ids the model must reuse), dinner + anchored activity, and which day the visitor is viewing. */
function currentTripContext(trip: PlannerTrip, pinned: ReadonlySet<string>): string {
  const dayLines = trip.days
    .map((d, i) => {
      const stops = d.places.length
        ? d.places
            .map(
              (p, j) => `${j + 1}. ${p.name} [id: ${p.id}]${pinned.has(p.id) ? ' (hearted)' : ''}`,
            )
            .join(' · ')
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

/** Build the real Gemini model, or null when unconfigured (stub provider / missing key). This is
 *  the back-office model (admin assistant, quote extraction, SEO fix) — the name is historical. */
export function plannerModel(ctx: ServiceContext): LanguageModel | null {
  if (ctx.ai.name !== 'google') return null;
  const env = getServerEnv();
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) return null;
  return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(ctx.ai.model);
}

/**
 * The model for calls a VISITOR is waiting on: ZilAi's planning turns and its place insights.
 *
 * Measured 2026-10-11 on the same search → commit → reply loop: Gemini 3.1 Pro 17.7 s, Pro at low
 * thinking 12.8 s, Gemini 3.8 Flash 19.1 s, Flash at low thinking 5.8 s. The lesson is in the third
 * figure: Flash is NOT faster on its own — left to think as much as it likes it was slower than Pro.
 * The speed comes from the pair, so the two travel together: this model, with
 * {@link visitorModelOptions}. The owner chose it over Pro for the public assistant; the back
 * office stays on Pro.
 */
const VISITOR_MODEL_DEFAULT = 'gemini-3.8-flash';

function visitorModelId(): string {
  return getServerEnv().GOOGLE_GENERATIVE_AI_FAST_MODEL ?? VISITOR_MODEL_DEFAULT;
}

export function visitorModel(ctx: ServiceContext): LanguageModel | null {
  if (ctx.ai.name !== 'google') return null;
  const env = getServerEnv();
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) return null;
  return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(visitorModelId());
}

/** Provider options that go with {@link visitorModel}: low thinking. `thinkingLevel` only exists
 *  from Gemini 3 on, so a model id pinned to an older family is sent no option rather than one the
 *  API would reject. */
export function visitorModelOptions():
  | { google: { thinkingConfig: { thinkingLevel: 'low' } } }
  | undefined {
  return /^gemini-(?:[3-9]|\d{2,})/.test(visitorModelId())
    ? { google: { thinkingConfig: { thinkingLevel: 'low' } } }
    : undefined;
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
  /** Stops the visitor has hearted. Kept by instruction AND by the commit tools (see `keepPinned`). */
  pinnedIds?: string[];
}

/** What ZilAi wrote about one stop for its result card. */
export interface PlannerStopNote {
  placeId: string;
  /** One or two sentences on what the stop is like. */
  why: string | null;
  /** The highlighted "best when…" line. */
  tip: string | null;
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
  /** ZilAi's name for the day ("Blue Bay and the wild south coast"), or null if it sent none. */
  title: string | null;
  /** Card text for the day's stops; a stop may have none. */
  notes: PlannerStopNote[];
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
  /** Single-day mode: ZilAi's name for the committed day, or null. */
  title: string | null;
  /** Single-day mode: card text for the committed stops. */
  notes: PlannerStopNote[];
}

const EMPTY_RESULT: Omit<PlannerTurnResult, 'reply'> = {
  places: [],
  route: null,
  rejectedFarRegion: [],
  droppedOverCap: [],
  days: [],
  recommendations: [],
  proposedTrip: null,
  title: null,
  notes: [],
};

/** Availability lookups are DB RPCs fanned out per date — bound the whole turn, not just one call. */
const MAX_AVAILABILITY_DATES_PER_TURN = 14;

/**
 * How many place ids one commit will actually RESOLVE. The day's real cap is MAX_STOPS and
 * filterItinerary enforces it, but resolving is what costs money (unknown ids become Place Details
 * calls), so the over-cap ids the model sends still need a ceiling — just not one that throws.
 * Headroom above MAX_STOPS so a list padded with ids that turn out to be unknown or far-region can
 * still fill a day.
 */
const MAX_RESOLVED_PLACE_IDS = MAX_STOPS * 2;

/**
 * Bound a model-supplied id list without rejecting the call. Anything past the ceiling is handed
 * back by name so the model can be told what was ignored instead of being handed an exception.
 */
function boundPlaceIds(requested: string[]): { placeIds: string[]; ignoredOverLimit: string[] } {
  return {
    placeIds: requested.slice(0, MAX_RESOLVED_PLACE_IDS),
    ignoredOverLimit: requested.slice(MAX_RESOLVED_PLACE_IDS),
  };
}

/** A model-written line made safe to print on a card: markdown emphasis and stray whitespace
 *  removed, cut to length. Null when nothing is left. Clamped here, never in the tool schema. */
function cardText(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

type RawNote = { placeId: string; why?: string | null; tip?: string | null };

/** Keep only notes for stops that actually made it into the day (one per stop, last wins). */
function stopNotes(raw: RawNote[] | null | undefined, places: PlannerPlace[]): PlannerStopNote[] {
  const kept = new Set(places.map((p) => p.id));
  const byId = new Map<string, PlannerStopNote>();
  for (const n of raw ?? []) {
    if (!kept.has(n.placeId)) continue;
    const why = cardText(n.why, 280);
    const tip = cardText(n.tip, 140);
    if (why || tip) byId.set(n.placeId, { placeId: n.placeId, why, tip });
  }
  return [...byId.values()];
}

/**
 * Put back any hearted stop the model left out of a commit. `existing` is the day as the visitor
 * has it; a hearted stop missing from `requested` is re-inserted at its old position (so the day
 * keeps its shape), unless it is in `elsewhere` — placed on another day by the same call.
 */
function keepPinned(
  requested: string[],
  existing: PlannerPlace[],
  pinned: ReadonlySet<string>,
  elsewhere: ReadonlySet<string> = new Set(),
): { placeIds: string[]; restored: string[] } {
  if (pinned.size === 0) return { placeIds: requested, restored: [] };
  const placeIds = [...requested];
  const restored: string[] = [];
  existing.forEach((p, index) => {
    if (!pinned.has(p.id) || placeIds.includes(p.id) || elsewhere.has(p.id)) return;
    placeIds.splice(Math.min(index, placeIds.length), 0, p.id);
    restored.push(p.name);
  });
  return { placeIds, restored };
}

export async function runPlannerTurn(
  ctx: ServiceContext,
  input: PlannerTurnInput,
  // Injectable so the agent loop can be tested with a scripted model; defaults to the real Gemini.
  modelOverride?: LanguageModel | null,
): Promise<PlannerTurnResult> {
  const model = modelOverride ?? visitorModel(ctx);
  const providerOptions = visitorModelOptions();
  if (!model) {
    return {
      reply:
        "I can't reach ZilAi right now — but you can still browse the places and build your day on the map, and I'll price it instantly.",
      ...EMPTY_RESULT,
    };
  }

  const apiKey = mapsKey();
  const trip = input.trip;
  const pinned: ReadonlySet<string> = new Set(input.pinnedIds ?? []);
  let committed: ResolvedItinerary | null = null;
  let committedTitle: string | null = null;
  let committedNotes: PlannerStopNote[] = [];
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
    // `.nullish()` throughout, not `.optional()`: the model writes an explicit null for "no filter"
    // as readily as it omits the key, and only one of those two survives `.optional()`. See the note
    // on set_trip_plan — a constraint in the parameters is a 500, the same constraint in execute is a
    // fact the model can act on. Nulls are laundered back to undefined here, at the boundary, so
    // PlacesSearchArgs stays undefined-only.
    inputSchema: z.object({
      query: z.string().nullish(),
      category: z
        .string()
        .nullish()
        .describe('Beach|Waterfall|Viewpoint|Nature|Culture|Garden|Island|Market|Landmark|Food'),
      region: z.string().nullish().describe('North|South|East|West|Central'),
    }),
    execute: async ({ query, category, region }) => {
      const places = await searchPlannerPlaces(
        { query: query ?? undefined, category: category ?? undefined, region: region ?? undefined },
        apiKey,
      );
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
    // Unbounded and null-tolerant for the reasons given on set_trip_plan. The `.max(7)` that used to
    // sit on `dates` bought nothing it wasn't already getting: execute dedupes, drops any date outside
    // the trip, and stops at MAX_AVAILABILITY_DATES_PER_TURN — so an over-long list costs the same
    // whether it is refused or trimmed, and refusing it costs the visitor the whole turn.
    inputSchema: z.object({
      dates: z
        .array(z.string())
        .nullish()
        .describe(
          'Dates to check, YYYY-MM-DD. Omit entirely if the visitor has not chosen a date.',
        ),
      region: z.string().nullish().describe('North|South|East|West|Central'),
      category: z.string().nullish().describe('e.g. Catamaran|Hiking|Snorkeling'),
      q: z
        .string()
        .nullish()
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
        'Commit the chosen day as an ordered list of place ids. Returns the real driving time between the stops, any unknown ids, ids rejected as too far from the day, and ids dropped over the 6-stop cap.',
      // No bounds of any kind here — not `.min(1)`, and (since 2026-08-08) not `.max(MAX_STOPS)`
      // either. A bound in the PARAMETERS fails the SDK's argument validation BEFORE execute runs,
      // and AI_InvalidToolArgumentsError escapes as an unhandled 500 — the visitor sees the planner
      // break because the MODEL made a mistake. A model slip is a conversational problem, not a
      // server fault: accept the call, refuse to act on the bad part, and hand back a fact the model
      // can recover from on its next turn. Both slips are logged in error_logs (empty array
      // 2026-08-01; seven ids against a six-stop cap 2026-08-08).
      //
      // The cap itself is not lost — it moves one layer in, where it was always enforced anyway:
      // filterItinerary caps the day at MAX_STOPS and names what it dropped, which this tool already
      // reports as droppedOverCap and its own description already promises.
      inputSchema: z.object({
        placeIds: z.array(z.string()),
        title: z.string().nullish().describe('A short name for the day — no date'),
        notes: z
          .array(
            z.object({
              placeId: z.string(),
              why: z.string().nullish().describe('One or two sentences: what the stop is like'),
              tip: z.string().nullish().describe('One short line: when or for whom it is best'),
            }),
          )
          .nullish()
          .describe('Card text, one entry per stop'),
      }),
      execute: async ({ placeIds: asked, title, notes }) => {
        // Hearted stops the model left out go back in BEFORE the cap is applied, so the cap trims
        // an unhearted stop rather than one the visitor asked to keep.
        const { placeIds: requested, restored } = keepPinned(asked, input.itinerary ?? [], pinned);
        const { placeIds, ignoredOverLimit } = boundPlaceIds(requested);
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
        committedTitle = cardText(title, 80);
        committedNotes = stopNotes(notes, resolved.places);
        return {
          stops: resolved.places.map((p) => p.name),
          unknownIds: resolved.unknownIds,
          rejectedFarRegion: resolved.rejectedFarRegion.map((p) => p.name),
          droppedOverCap: resolved.droppedOverCap.map((p) => p.name),
          ...(ignoredOverLimit.length ? { ignoredOverLimit } : {}),
          ...(restored.length
            ? {
                keptHearted: restored,
                note: 'The visitor hearted those stops, so they were kept in the day. Do not say you removed them.',
              }
            : {}),
          // Stop to stop only: the server does not know the pick-up, and the visitor's plan adds
          // that leg and the way back. Named for what it is so the model cannot pass it off as the
          // whole day's driving — it once told a visitor "25 minutes" beside a plan showing 3h 20.
          driveMinutesBetweenStops: resolved.route.totalMinutes,
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
      //
      // `.nullish()` for the same reason `.min`/`.max` are absent, and it is the half that is easy to
      // miss: `.optional()` admits `undefined` but NOT `null`, and Gemini writes an explicit
      // `"activitySlug": null` for "no tour that day" as readily as it omits the key. That exact slip,
      // on that exact field name, is what 500'd set_trip_plan on 2026-08-08 (error_logs). A day with no
      // tour is the COMMON case for this tool, so it would have been the common failure.
      inputSchema: z.object({
        days: z.array(
          z.object({
            date: z.string().describe('YYYY-MM-DD, one calendar day of their stay'),
            activitySlug: z
              .string()
              .nullish()
              .describe('A slug search_our_activities returned — never invent one'),
            note: z.string().nullish().describe('One short line on what that day looks like'),
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
        "Commit the plan for one or more trip days (only the days you are creating or changing). Each day: its date, the ordered place ids (lunch included), an optional dinnerPlaceId, and an optional activitySlug from search_our_activities. Returns each day's real driving time between its stops and any unknown/rejected/dropped ids.",
      // Deliberately unbounded and null-tolerant, for the same reason as set_itinerary above: every
      // constraint expressed HERE turns a model slip into an unhandled 500, while the same constraint
      // expressed in execute becomes a fact the model can act on. Specifically:
      //  - `.nullish()`, not `.optional()` — Gemini writes `"activitySlug": null` for "no activity on
      //    this day" rather than omitting the key, and `.optional()` admits undefined but not null.
      //    Both fields are already read for truthiness below, so null needs no other handling.
      //    (error_logs, 2026-08-08.)
      //  - no `.min(1)` / `.max(7)` on days — an empty commit is answered with an empty result, and
      //    the real bound is validDates: a date outside the trip is reported as unknownDates before
      //    anything billed runs, so a model sending fifty days still costs at most the trip's length.
      //  - no `.max(MAX_STOPS)` on placeIds — capped by filterItinerary and reported as droppedOverCap.
      inputSchema: z.object({
        days: z.array(
          z.object({
            date: z.string().describe('One of the trip dates, YYYY-MM-DD'),
            placeIds: z.array(z.string()),
            dinnerPlaceId: z.string().nullish(),
            activitySlug: z.string().nullish(),
            title: z.string().nullish().describe('A short name for the day — no date'),
            notes: z
              .array(
                z.object({
                  placeId: z.string(),
                  why: z.string().nullish().describe('One or two sentences: what the stop is like'),
                  tip: z.string().nullish().describe('One short line: when or for whom it is best'),
                }),
              )
              .nullish()
              .describe('Card text, one entry per stop'),
          }),
        ),
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

        // Collapse repeats before doing any work. `committedDays.set` already means "last write per
        // date wins", so keeping only the last entry for a date is the same plan — but it is also
        // what keeps the billed fan-out bounded now that the parameters no longer cap the array:
        // resolving a day calls the Routes API, so fifty copies of one date would otherwise be fifty
        // route calls for one day's plan. After this, the loop runs at most once per trip date.
        const byDate = new Map<string, (typeof days)[number]>();
        for (const day of days) byDate.set(day.date, day);
        // Every stop this call places anywhere — a hearted stop the model moved to another day is
        // not "missing" from its old one.
        const placedThisCall = new Set([...byDate.values()].flatMap((d) => d.placeIds));

        for (const day of byDate.values()) {
          if (!validDates.has(day.date)) {
            unknownDates.push(day.date);
            continue;
          }
          const elsewhere = new Set([...placedThisCall].filter((id) => !day.placeIds.includes(id)));
          const { placeIds: requested, restored } = keepPinned(
            day.placeIds,
            existingByDate.get(day.date) ?? [],
            pinned,
            elsewhere,
          );
          const { placeIds, ignoredOverLimit } = boundPlaceIds(requested);
          const resolved = await resolveItinerary(
            placeIds,
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
            title: cardText(day.title, 80),
            notes: stopNotes(day.notes, dinner ? [...resolved.places, dinner] : resolved.places),
          });
          perDay.push({
            date: day.date,
            stops: resolved.places.map((p) => p.name),
            unknownIds: resolved.unknownIds,
            rejectedFarRegion: resolved.rejectedFarRegion.map((p) => p.name),
            droppedOverCap: resolved.droppedOverCap.map((p) => p.name),
            ...(ignoredOverLimit.length ? { ignoredOverLimit } : {}),
            driveMinutesBetweenStops: resolved.route.totalMinutes,
            dinner: dinner?.name ?? null,
            ...(dinner === null && day.dinnerPlaceId ? { unknownDinnerId: day.dinnerPlaceId } : {}),
            activitySlug,
            ...(activityNote ? { activityNote } : {}),
            ...(restored.length ? { keptHearted: restored } : {}),
          });
        }
        return { days: perDay, ...(unknownDates.length ? { unknownDates } : {}) };
      },
    }),
  };

  const system = trip
    ? RANGE_SYSTEM_PROMPT + currentTripContext(trip, pinned)
    : SYSTEM_PROMPT + currentDayContext(input.itinerary ?? [], pinned);
  const tools = trip ? rangeTools : singleDayTools;

  let reply: string;
  try {
    const result = await generateText({
      model,
      providerOptions,
      system,
      messages: input.messages,
      tools,
      // Each step can call a BILLED tool (search_places → Google Places, set_itinerary → Routes API), so
      // this bounds the billed fan-out per turn. Single-day: search → commit → reply, so 4 leaves
      // headroom for one retry. Range mode plans up to 7 days (region searches + Food searches + our
      // activities + commit + a retry), so it gets a higher — still hard — cap.
      stopWhen: stepCountIs(trip ? 12 : 4),
    });
    // A tool that threw while running (Places down, an availability RPC failing) is a real fault.
    // The SDK would let the model apologise over it; re-raise it so it reaches error_logs instead.
    const fault = toolExecutionFault(result.steps);
    if (fault !== undefined) throw fault;
    reply = result.text;

    // ── the plan has to reach the map ──
    // A turn that searched for places and then only DESCRIBED them leaves the visitor with a wall of
    // prose and an empty map. Gemini reaches for this whenever a turn drifts into answering mode —
    // observed verbatim as "I cannot directly display a map for you. However, you can easily find these
    // locations on any map application by searching for their names". The prompt now forbids it; this is
    // the net under the prompt. One bounded repair turn, only on that exact turn shape, and it keeps the
    // original reply if the model still won't commit — a stubborn model must never break the chat.
    if (needsCommitRepair(result.steps)) {
      try {
        const repair = await generateText({
          model,
          providerOptions,
          system,
          messages: [
            ...input.messages,
            ...result.response.messages,
            {
              role: 'user' as const,
              content: commitNudge(trip ? 'set_trip_plan' : 'set_itinerary'),
            },
          ],
          tools,
          stopWhen: stepCountIs(3),
        });
        // Only adopt the repair's words if it actually committed — otherwise the visitor would get a
        // second helping of the same prose with the map still empty.
        if (committedInSteps(repair.steps) && repair.text.trim()) reply = repair.text;
      } catch {
        /* the repair is best-effort — the visitor still gets the original reply */
      }
    }
  } catch (err) {
    // Last line of defence for the malformed-tool-call class. Since AI SDK v5 the loop absorbs these
    // itself (the model is shown the error and retries), so this catch should now never fire for
    // them — it stays because that is a property of a dependency, not of this code.
    //
    // Scoped to exactly the two errors that mean "the MODEL sent something malformed". A Gemini
    // outage, a quota refusal or a Places failure is a real fault and must keep propagating to
    // apiHandler — it belongs in error_logs, where a graceful reply would hide it (tool failures are
    // re-raised above for exactly that reason). The repair turn has its own catch-all, so nothing
    // from that best-effort call reaches here.
    if (!InvalidToolInputError.isInstance(err) && !NoSuchToolError.isInstance(err)) throw err;
    reply = LOST_THREAD_REPLY;
  }
  // Under AI SDK v5 a malformed tool call no longer throws: the model is shown the error and tries
  // again, and a model that keeps fumbling simply runs out of steps with nothing said. An empty
  // bubble is worse than an honest one — and whatever it committed before the fumble still stands.
  if (!reply.trim()) reply = LOST_THREAD_REPLY;

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
    title: itinerary ? committedTitle : null,
    notes: itinerary ? committedNotes : [],
  };
}
