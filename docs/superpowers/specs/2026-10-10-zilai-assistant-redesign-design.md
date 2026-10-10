# ZilAi assistant redesign — design

Date: 2026-10-10. Owner decisions recorded here were given in the session that produced this file.

## Goal

Replace the three-pane planner embedded in `/ai-road-trip-planner` with a site-wide assistant modelled
on TripAdvisor's: a "Plan with AI" button in the top bar opens a left panel on whatever page the
visitor is on; once ZilAi commits a plan, a results canvas (day sections of place cards beside a
numbered-pin map) takes over the area next to the panel. Run it on Gemini 3.1 Pro.

## Owner decisions

| Question               | Answer                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Model                  | ZilAi: Gemini 3.8 Flash at low thinking (chosen for speed, 11 Oct). Back office: 3.1 Pro   |
| Where the panel lives  | Every public page; `/ai-road-trip-planner` stays as the landing page                       |
| Extras in version one  | Menu (New chat / Recents / My trips), hearts + "Regenerate unpinned", "Compare my options" |
| Ratings on place cards | Real Google rating + count, labelled as Google's; our tours keep ours                      |
| Name                   | ZilAi                                                                                      |

## Facts established before design

- `ai@4.3.19` + `@ai-sdk/google@1.2.22` cannot drive any Gemini 3 model through a tool loop: step two
  returns `400 Function call is missing a thought_signature`. `ai@5` + `@ai-sdk/google@2` pass the same
  probe, including the repair turn that replays `response.messages`. So the model switch **is** an AI
  SDK v5 migration of the five services behind `plannerModel()` and their tests.
- 3.1 Pro is slow: ~15 s for a three-step loop with a toy prompt (3.8 Flash: ~5 s). The UI needs a real
  working state, and `GOOGLE_GENERATIVE_AI_MODEL` stays the one-line escape hatch.
- The Places field mask already includes `editorialSummary` (Google's top tier), so adding `rating` and
  `userRatingCount` (a lower tier) does not raise the Places bill.

## What does not change

- The map, the day list and the price are still drawn **only** by a commit tool (`set_itinerary` /
  `set_trip_plan`), and `needsCommitRepair` stays.
- The money path: availability → `/api/v1/holds` (itinerary travels with the hold) → `/checkout`.
  `bookDay()` moves file but not behaviour.
- Share links: `?stops=`, `?from&to&dN…`, `?fromTour=` on `/ai-road-trip-planner` keep restoring.
- Tool parameter schemas stay unbounded and null-tolerant; every clamp lives in `execute`.
- `/ai-road-trip-planner` keeps its metadata, admin SEO override and the site-wide nav link (the nav
  item stays an `<a href>`; the click is intercepted to open the panel).

## Architecture

### 1. Model + SDK (slice 1)

`ai@^5`, `@ai-sdk/google@^2`. `parameters` → `inputSchema`, `maxSteps` → `stopWhen: stepCountIs(n)`,
`LanguageModelV1` → `LanguageModelV2`, `InvalidToolArgumentsError` → `InvalidToolInputError`, test
mocks → `MockLanguageModelV2`. Default model in `src/lib/ai/google.ts` becomes
`gemini-3.1-pro-preview`.

### 2. Data and agent (slice 2)

- `PlannerPlace` gains optional `rating` / `ratingCount`; both field masks request them; the places
  cache key is bumped so cards get stars without waiting out the 30-day details TTL.
- Commit tools accept optional presentation fields, all clamped in `execute`: a day `title`, and per
  stop `why` (one or two sentences) and `tip` (the highlighted "best when…" line). The turn result
  carries them; the client stores them per place id.
- `pinnedIds` in the request: listed in the system context **and** enforced in code — a commit that
  drops a pinned stop has it re-inserted before resolving.
- `/api/planner/locality` (edge, no-store) returns whether "use my current location" may be offered,
  because the dock can no longer take it as a server prop without making cached pages vary by country.

### 3. Client state (slice 3)

`usePlannerSession()` — the state and operations now inside `PlannerShell` (catalogue, stops, days,
chat, pickup, quote, booking, saved chats, deep-link restore) plus `pinnedIds`, per-stop notes, day
titles and the canvas view (`list` | `compare`). Pure refactor first, new fields second.

`ZilAiProvider` (in `app/(site)/layout.tsx`, a few hundred bytes): `open`, `openWith(prompt, range?)`,
`close`. The heavy part, `ZilAiDock`, is `next/dynamic` with `ssr: false` and is mounted on first open —
nothing is added to any page's HTML (homepage is edge-cached; SEO window runs to ~22 Oct).

### 4. Surfaces

- **Trigger.** "Plan with AI" is a filled pill at the top right of the header on every page
  (`PlanWithAiButton`), replacing the "AI Trip Planner" link in the nav row; `MobileMenu` keeps a row
  for it. Both are still links to `/ai-road-trip-planner`; a plain click is intercepted to open the
  panel in place.
- **Panel** (`AssistantPanel`): header (menu button, "ZilAi · AI assistant", New chat, share, close);
  home state ("Let's plan your Mauritius trip", Dates / Travellers / Recents chips, composer, three
  Mauritius suggestion rows); chat thread once a turn exists; the AI disclaimer stays under the
  composer. Menu drawer: New chat, Chat, My trips, Recents with All / Itinerary / Comparison filters.
- **Canvas** (`ResultsCanvas`): "Results for “…”", Compare toggle, Regenerate unpinned, close. Left:
  day sections (title, subtitle, pick-up row, numbered cards with photo, heart, Google rating, type,
  why + highlighted tip, See details, remove, move; drive-time chips between cards; our tours as
  branded cards with real price; dinner suggestion; "Add a stop"). Right: `RouteMap` with numbered
  pins and a card rail. Bottom: the day's price and "Get quote" (existing `QuoteModal`).
- **Compare view:** the same stops as columns against rows (type, area, Google rating, time needed,
  closes, drive from previous stop, why go).
- **Landing page:** hero prompt + date range + presets feed the assistant; Features / Trust / FAQ stay.

### 5. Layout rules

| Viewport | Panel alone                                  | With canvas                                 |
| -------- | -------------------------------------------- | ------------------------------------------- |
| ≥ 1024px | 400px modal sheet from the left, page dimmed | Panel + canvas fill the viewport            |
| < 1024px | Full-screen sheet                            | Full-screen, bottom tabs: Chat / Plan / Map |

The panel is a modal: it slides over the page and never moves it. (The first build pushed the page
aside at ≥ 1440px; the owner asked for a slide-over instead, the same day.) The page's scroll is
locked while the assistant is open, Tab stays inside it, Escape or a click on the dimmed page closes
it, and following a link closes it. The assistant closes itself on `/checkout` and `/admin`.

### 6. Motion

Panel width / slide, canvas entrance, staggered card reveal, shimmer skeleton cards and a drawing route
line while ZilAi works, message entrance, heart pop, list ↔ compare crossfade. CSS keyframes keyed on
state classes (rAF-flipped transitions have failed in non-compositing tabs here). Reduced motion resets
both `transform` and `opacity`, never only `animation`.

## Error handling

- Model/tool faults keep today's behaviour: malformed tool input → apologetic reply, plan untouched;
  provider outages propagate to `apiHandler` and `error_logs`.
- A turn that fails leaves the skeleton state and restores the previous canvas.
- Missing notes or ratings render nothing rather than a placeholder.

## Testing

- Agent tests migrated to v5 mocks; new cases for title / why / tip clamping and pinned re-insertion.
- Mapper test for ratings; schema keeps accepting cached entries without them.
- Unit tests for the compare-row builder and the saved-chat filters.
- A wiring test for the shell (the panel overlays and never pushes, the page's scroll is locked,
  the canvas stays mounted, reduced motion, lazy loading, the trigger is a link), in the spirit of
  `assistant-shell-wiring.test.ts`.
- `node scripts/i18n-scan.mjs`; French for every new string.
- Browser check by DOM geometry (the page keeps its full width under the open panel) at 1600,
  1280 and 375.

## Build order

1. AI SDK v5 + Gemini 3.1 Pro.
2. Ratings, agent presentation fields, pinned enforcement, locality endpoint.
3. Session hook, provider, dock, panel, canvas, compare, landing page, nav trigger.
4. French, motion, accessibility pass, detector, handbook, full gate.

## Out of scope

Streaming replies, accounts-backed "My trips" (they stay in the visitor's browser), drag-and-drop
reordering, and any change to pricing or checkout.
