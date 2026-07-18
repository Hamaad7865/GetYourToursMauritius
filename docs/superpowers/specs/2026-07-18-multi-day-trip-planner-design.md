# Multi-day AI Trip Planner — "plan my whole stay"

**Date:** 2026-07-18
**Owner ask (verbatim intent):** "another sort of service or feature where the customer can plan the
whole week or choose how many days… he can choose 6th september to 10th of september… then he will talk
with the ai to plan his stay, ai can recommend restaurant activities like anything he wants and we want
to be rich in that… maybe we can put a toggle or switch to choose the week planner."

---

## What exists today (grounding)

`/ai-road-trip-planner` is a **one-day** planner:

- **ZilAi** (`src/lib/services/planner-agent.ts`) is a Gemini tool-calling agent (Vercel AI SDK
  `generateText`, `maxSteps: 4`). Its system prompt says _"build a one-day itinerary"_, capped at
  `MAX_STOPS = 6`, with region coherence (a day may not mix `far` regions — North↔South, East↔West).
- Tools: `search_places` (live **Google Places**; categories include **Food**) and `set_itinerary`
  (commits an ordered list → **real** drive time from the Routes API, plus `rejectedFarRegion` /
  `droppedOverCap` / `unknownIds`).
- **Hard discipline:** the agent must never invent a place, drive time, opening hour or price.
- It already converts: `QuoteModal` → live availability → hold → **real checkout**, sold as a private
  vehicle day-trip.
- Cost: every turn fans out to **billed** Gemini + Google Places/Routes. The route itself flags
  wallet-DoS risk; per-IP `rateLimit(req, 'ai:trip-planner', 15)` is the current control.
- Graceful fallback when no model is configured: _"I can't reach ZilAi right now…"_.

**The agent does NOT know the Belle Mare tour catalogue** — it only searches Google Places.

---

## Decisions locked with the owner

1. **The AI recommends our tours first**, using each activity's own location, then fills with places
   and restaurants.
2. **Conversion = both**: each recommended tour is individually bookable **and** the whole plan can be
   sent as an enquiry (a Lead).
3. **Persistence = shareable link, no login.** Email captured only at the "send me this plan" moment.
4. **Approach C — instant draft, then deepen.**
5. **Hotel/accommodation input: yes**, using our 45 geocoded hotels **plus Google Places** for
   anything else (Airbnb / villa / guesthouse).
6. **Max stay: 14 days.**
7. **Anchor every day** with something bookable of ours where possible (see §4 for the honesty rule).

---

## 1. Entry & the toggle

A segmented control at the top of the planner: **`One day` | `My whole stay`**.

- `One day` = today's experience, **untouched** (no regression risk to a working, converting feature).
- `My whole stay` reveals:
  - a **date range** (e.g. 6 Sept → 10 Sept), capped at **14 days**;
  - **party size** (reuses the existing party control);
  - **"Where are you staying?"** — reuses the existing `PickupSearch` component: our 45 geocoded
    transfer hotels (`api_search_transfer_hotels`) as instant quick-picks, then **live Google Places**
    (`/api/planner/places?q=`) for anything else. Returns `{name, lat, lng}`.

The accommodation coordinates matter: they let the draft keep **arrival day light and near the hotel**,
avoid a long drive on the evening they land, and keep the **departure day close** for the flight.

## 2. The instant draft (cheap, our data only)

On confirming dates we make **one Gemini call with no Google tools**, passing a compact catalogue:

- our **published activities** (id, title, slug, category, region, durationMin, priceFromEur, lat/lng), and
- the curated `planner_places` (id, name, category, region, durationMin).

It returns a **structured plan**: for each day — a region/theme, one **anchor**, 2–3 supporting stops,
and one line of "why". Rules enforced in the prompt _and_ re-validated server-side:

- **Only ids from the supplied catalogue.** Anything else is dropped (never invented).
- **One region per day**, reusing `isRegionCompatible` / `regionDistanceBand`.
- **No repeated region on consecutive days** where the catalogue allows.
- **No drive times claimed.** The draft shows region + durations only; real drive times appear when a
  day is routed (§3). This preserves the planner's never-invent discipline.

Cost: one Gemini call, **zero Google calls** → effectively free and instant. This is the "wow".

## 3. Deepening a day (where spend happens)

Tapping a day makes it the **active day** and opens ZilAi scoped to that day, seeded with the draft's
stops (the existing `itinerary` input already supports exactly this).

- Reuses `runPlannerTurn` — its one-day rules are the correct **per-day** rules.
- **New:** the day's **date** is passed, so the agent can respect opening hours and our real
  availability for that date.
- On commit → real route + drive time via the existing `set_itinerary` path.

## 4. Teaching ZilAi our tours

New tool **`search_our_tours({ region?, category?, date? })`** → queries published activities
(joined to availability for that date) → returns `{id, slug, title, category, region, durationMin,
priceFromEur, lat, lng, bookableOnDate}`.

System-prompt addition: _prefer a Belle Mare tour when one genuinely suits the day; they are bookable._

**Anchoring rule (owner: anchor every day).** Every day leads with something bookable of ours where one
fits. On a genuine rest/beach day the anchor is presented as an **offer, not padding** — e.g. _"fancy
exploring? a rental car for the day"_ or a transfer — rather than inserting a tour that doesn't suit.
The agent still may not claim a fit that isn't real; the honesty rule outranks the anchoring rule.

## 5. Data prerequisite — geocode the tours

Live check (2026-07-18): **43 published activities, only 1 has `lat`/`lng`**; 42 have a text `location`,
28 have a `region`.

- **One-off backfill:** geocode `location` → `lat`/`lng` (the hotels were geocoded the same way), then
  derive `region` via the existing `region_from_coords`.
- **Admin:** surface coordinates on the activity editor so new tours get them.
- Until a tour has coordinates it is **excluded from anchoring** (it can't be honestly placed or routed).

## 6. Conversion

- Each tour in a day renders as a **bookable card** → existing availability → hold → `/checkout`, with
  that day's **date pre-filled**. One booking at a time (multi-item checkout stays out of scope).
- A persistent **"Send me this plan"** → email (+ optional WhatsApp) → `api_capture_lead` with the full
  day-by-day plan JSON and the share link → lands in **Leads** and fires the existing owner alert.

## 7. Persistence & sharing

New table **`trip_plans`**: `id`, `token` (short, unguessable), `date_from`, `date_to`, `party`,
`stay_name`/`stay_lat`/`stay_lng`, `plan` (jsonb), `email` (nullable), `created_at`, `updated_at`.

- Public **read by token only** (RLS); no login. Autosaves as the plan changes.
- URL **`/trip/<token>`** — shareable with a partner/family.
- The token is a capability (like a booking ref). No PII beyond what the traveller supplies.

## 8. Cost & abuse controls

- Draft = 1 Gemini call, no Google. Deepening = the existing bounded agent (`maxSteps: 4`).
- **14-day cap**; a per-plan cap on draft regenerations.
- Existing per-IP `ai:trip-planner` limit applies; a separate, tighter limit for the draft endpoint.
- **Re-flag Turnstile at the edge** — this is a public, anonymous, billed surface.

## 9. Testing

- **Pure/unit:** draft validation (ids outside the catalogue dropped; one region per day; consecutive-day
  region spread; day count = range length; 14-day cap), token generation, plan (de)serialisation.
- **Integration (PGlite):** `trip_plans` RLS (readable by token, not enumerable), `search_our_tours`
  returns only published + coordinate-bearing tours, lead capture carries the plan.
- **Agent:** scripted-model tests for the per-day turn with `search_our_tours` (mirrors the existing
  planner-agent tests) — no billed calls in CI.
- Full gate: typecheck, lint, format, `test:coverage`, build (`pages:build` in CI).

## 10. Out of scope for v1 (YAGNI)

Paying for a whole week in one transaction (multi-item checkout), booking restaurants or hotels,
real-time restaurant reservations, and PDF export of the plan. Each is its own project.

## 11. Go-live prerequisites (owner)

1. **Fund Gemini/Google billing** — ZilAi currently returns the offline fallback, so nothing AI-driven
   can be demoed until this is restored.
2. **Run the tour geocoding backfill** (§5).

## 12. Build order (each phase ships something real)

| Phase | What lands                                                                                           | Why this order                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **0** | Geocoding backfill + admin coordinates field + expose `lat`/`lng`/`region` on the tour DTO           | Hard prerequisite for anchoring; also improves the existing maps. **No AI needed — can start today even with billing down.** |
| **1** | The toggle, date range (14-day cap), accommodation input, `trip_plans` + share link, empty day cards | A usable multi-day shell that persists and shares, with zero AI spend                                                        |
| **2** | `search_our_tours` + the instant draft (our data only, no Google calls)                              | The "wow" moment; cheap. Needs Phase 0 for anchoring                                                                         |
| **3** | Per-day deepening via the grounded agent (date-aware) + bookable tour cards                          | Where real drive times, restaurants and bookings arrive                                                                      |
| **4** | "Send me this plan" → Lead + owner alert                                                             | Captures the travellers who want the week quoted                                                                             |

Phases 0 and 1 are independent of the Gemini billing situation.

## 13. Risks

| Risk                                             | Mitigation                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| Billed fan-out on a public endpoint (wallet DoS) | Free draft, bounded deepening, day cap, per-IP limits, Turnstile      |
| Anchoring every day reads as pushy               | Anchor as an _offer_ on rest days; honesty rule outranks anchoring    |
| Draft quality with only 1 geocoded tour          | Geocoding backfill is a hard prerequisite; un-geocoded tours excluded |
| Plan lost / not attributable                     | Token-addressed `trip_plans` + autosave; lead captures the plan       |
| Regression to the working one-day planner        | Toggle isolates it; `One day` path untouched                          |
