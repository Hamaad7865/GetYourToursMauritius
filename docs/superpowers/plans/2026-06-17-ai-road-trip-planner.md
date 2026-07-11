# AI Road Trip Planner Implementation Plan (revised — reuse-grounded)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** A standalone `/ai-road-trip-planner` page where a Gemini co-pilot builds a day-trip from a curated free-form Mauritius places dataset on a map, priced with the planner's own admin-editable flat per-vehicle rates, and converts to a REAL instant booking by reusing the existing vehicle booking flow.

**Status:** Revised after re-grounding against the latest `main` (which already ships vehicle pricing, the GYG booking flow, open-ended availability, the animated `RouteMap`, the customisable-itinerary engine, child seats, and a leads inbox). This plan now **reuses** that machinery and builds only the genuinely-new pieces.

---

## Locked decisions

- **Interaction:** standalone, additive page (the per-tour itinerary builder stays as-is).
- **Conversion:** **real instant booking** (reuse holds → `api_book` → checkout), not a lead. (Lead capture remains a possible fallback.)
- **Pricing:** the planner's **own** flat per-vehicle rates — **Standard car €95 / SUV €100 (1–4) · 6-seater €110 (5–6) · Van €150 (7–14) · Coach €250 (15–22)**, cap 22 — DISTINCT from the sightseeing rates (70/85/85/125/225, cap 25).
- **Money path:** **separate parallel path** — leave the shipped `pricing_mode='vehicle'` + `sightseeing_pricing` untouched; add a parallel `pricing_mode='vehicle_custom'` + a `planner_pricing` config read by a parallel `create_booking` branch.
- **Admin:** a new admin screen makes **both** the sightseeing config **and** the planner config editable (sightseeing is SQL-only today).
- **Grounding (data):** curated `planner_places` seed table; real Google **Distance Matrix** drive times (haversine fallback). Live Google Places discovery is out of scope (future).
- **AI:** Gemini tool-calling agent (`runPlannerTurn`), `gemini-1.5-flash`, behind the existing swappable provider seam.
- **Place-count rule:** soft warning at 6+ stops; adding still allowed.

---

## Reuse map (DO NOT rebuild)

| Need                   | Reuse                                                                                                                                                 | Path                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hold + book            | `POST /api/v1/holds` (`api_create_hold`), `POST /api/v1/bookings` (`api_book` hold-reuse), `Checkout` 3-step, sessionStorage hold (`gytm:hold:<occ>`) | `app/api/v1/holds`, `app/api/v1/bookings`, `src/components/checkout/Checkout.tsx`, `src/components/gyg/detail/BookingProvider.tsx` (`continueToCheckout`)       |
| Availability           | `daily_capacity` + `materialize_availability` + `api_list_availability` (rolling 185-day; vehicle slots count vehicles)                               | `supabase/migrations/20260616180000_availability_read_only.sql`, `src/lib/admin/availability-write.ts` (`setDailyCapacity`), `src/lib/services/availability.ts` |
| Map                    | `RouteMap` (animated driving route + fallback), `pin.ts`, `ItineraryMap`, `ItineraryTimeline`                                                         | `src/components/maps/*`, `src/components/gyg/detail/Itinerary*`                                                                                                 |
| Itinerary state        | pure `placeForStop`/`chosenRoute`/`divergesFromDefault`, `ItineraryStop`/`AltStop`                                                                    | `src/lib/itinerary/route.ts`, `src/lib/validation/tours.ts`                                                                                                     |
| Vehicle pricing engine | `pricing_mode='vehicle'` branch in `create_booking`, `sightseeingQuote` client mirror, child seats (`childSeatsCost`, €6)                             | `supabase/migrations/20260617160000_flat_vehicle_pricing.sql`, `src/lib/services/pricing.ts`                                                                    |
| Admin CRUD             | browser-client + staff RLS pattern                                                                                                                    | `src/lib/admin/categories.ts`, `src/components/admin/AdminCategories.tsx`                                                                                       |
| AI seam                | provider factory + `chat_sessions`/`chat_messages` + `ServiceContext`                                                                                 | `src/lib/ai/*`, `src/lib/services/agent.ts` (`runAgentTurn` is the stub to implement), `src/lib/config/env.ts`                                                  |
| Leads (fallback)       | `captureLead` + `/admin/leads`                                                                                                                        | `src/lib/services/leads.ts`, `src/components/admin/AdminLeads.tsx`                                                                                              |

**Hard rule (already the codebase norm):** prices/availability/drive-times come from the DB/Google, never the model. `create_booking` is authoritative; the client mirrors for display only.

---

## New work (BUILD)

### Parallel pricing path (`vehicle_custom`)

- Migration: add `'vehicle_custom'` to the `activities.pricing_mode` CHECK. Create `planner_pricing` single-row config (`id boolean pk default true`, `standard_minor 9500`, `suv_minor 10000`, `six_minor 11000`, `van_minor 15000`, `coach_minor 25000`, `max_party 22`, `updated_at`). Seed the one row.
- `create_booking`: add a `v_mode='vehicle_custom'` branch — identical bracket logic to the `vehicle` branch but reading `planner_pricing` (≤4 → standard/suv, ≤6 → six, ≤14 → van, ≤22 → coach; reject >22). One booking line, `quantity=1`, `pax=party`. **The existing `vehicle` branch is unchanged.**
- `api_create_hold` + `api_book`: treat `vehicle_custom` like `vehicle` for hold quantity (1 vehicle). Change the single `= 'vehicle'` checks to `in ('vehicle','vehicle_custom')`.
- `api_get_activity` / `api_search_activities`: for `vehicle_custom`, emit `pricingMode='vehicle_custom'` + a `vehiclePricing`-shaped block from `planner_pricing` (so the widget/planner mirror it). `fromPriceEur = standard_minor/100`.
- Append all to a dated `supabase/catch-up-2026-06-17-planner-pricing.sql` (idempotent) + regenerate `setup.sql`.

### Pricing — admin-editable (both configs)

- Add staff RLS to `sightseeing_pricing` **and** `planner_pricing`: `..._read using(true)` (or staff-only) + `..._staff for all using(is_staff()) with check(is_staff())`, and grant update to authenticated. (They currently have RLS on with no policies.)
- `src/lib/admin/vehicle-pricing.ts`: `loadSightseeingPricing()/updateSightseeingPricing()` + `loadPlannerPricing()/updatePlannerPricing()` (browser client, single-row update).
- `app/admin/vehicle-pricing/page.tsx` + `src/components/admin/AdminVehiclePricing.tsx`: two forms ("Sightseeing tours" / "Custom road trips"), nav link in `app/admin/layout.tsx`.

### Pure pricing logic

- `src/lib/planner/pricing.ts`: `plannerQuote(people, suv, cfg)` (mirrors the SQL `vehicle_custom` branch; planner vehicle names Standard car/SUV/6-seater/Van/Coach; cap 22) + `PLANNER_DEFAULT` + `placeCountWarning(stopCount)`. Unit-tested incl. a test pinning client/server agreement.

### Curated places

- Migration `planner_places` (`id text pk` slug, name, category, region, lat, lng, duration_min, closes_at time, blurb, image_url, position, created_at) + RLS (public read, staff write) + `api_planner_places` + seed (~15–40 real Mauritius POIs with real coords).
- `src/lib/admin/planner-places.ts` + `src/components/admin/AdminPlannerPlaces.tsx` + `app/admin/planner-places/page.tsx` (mirror categories).

### The "Custom Road Trip" bookable activity

- Seed/migration: one activity `slug='custom-road-trip'`, `type='activity'`, `category='Sightseeing tours'`, `pricing_mode='vehicle_custom'`, one option, `status='published'`. Enable `daily_capacity` (vehicles/day) so `materialize_availability` fills slots. The existing booking flow books it unchanged.

### Drive times

- `src/lib/maps/haversine.ts` (`haversineLeg`) + `src/lib/maps/distance.ts` (`getDistanceMatrix`, server fetch, `ProviderError` on failure) + `src/lib/services/route-planning.ts` (`planRoute`: Distance Matrix → haversine fallback + 24h cache). Add server env `GOOGLE_MAPS_API_KEY` (fallback to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`).

### AI co-pilot

- `src/lib/ai/planner-tools.ts` (handlers call services only: `search_places`→`listPlannerPlaces`, `plan_route`→`planRoute`, `vehicle_price`→`plannerQuote`, `place_count_warning`). `src/lib/ai/planner-agent.ts` (`streamText` + tools, grounded system prompt). Implement `runPlannerTurn` in `src/lib/services/agent.ts`; persist to `chat_sessions`/`chat_messages`. `app/api/ai/trip-planner/route.ts` (edge, streaming `Response`).

### Standalone page

- `app/ai-road-trip-planner/page.tsx` (server shell: `GygHeader` + `<PlannerShell/>` + `SiteFooter`). `src/components/planner/`: `PlannerShell` (client root, state), `ChatCopilot`, `ItineraryPanel`, `PlacesDrawer`, `MapView` (wraps `RouteMap`), `BookingBar`/`QuoteModal`, `usePlannerData`. Recreate the Claude design; mobile-first.
- **Deep-link prefill** `?stops=a,b,c&tour=Name`; **shareable URL** reflecting current stops.
- **Book now** → replicate `continueToCheckout` against the Custom Road Trip occurrence for the chosen date/party/suv, stashing the AI-built route under a planner-scoped key, then `/checkout` (reusing the booking flow + child seats + custom_itinerary).

---

## Milestones (each ends green: typecheck + lint + test + build)

1. **M1 — Parallel pricing path + admin editors.** `vehicle_custom` mode + `planner_pricing` config + `create_booking`/`api_book`/`api_create_hold`/catalogue branches; staff RLS on both configs; `plannerQuote`/`placeCountWarning` pure logic; admin editor for both configs. Tests pin sightseeing (unchanged) AND planner prices + child seats. **(Sensitive — money path. Detail first.)**
2. **M2 — Curated places + admin.** `planner_places` table + seed + RLS + `api_planner_places`; admin editor.
3. **M3 — Custom Road Trip activity.** Seed the bookable vehicle_custom activity; enable availability; integration test books it end-to-end through the existing flow at planner prices.
4. **M4 — AI co-pilot.** `runPlannerTurn` + tools + streaming route + Distance Matrix/haversine; stub-AI tests.
5. **M5 — Standalone page + booking conversion.** The page + components (reusing `RouteMap`/timeline), deep-link prefill, shareable URL, Book-now → real booking; preview verification.

Order: M1 → (M2 ∥ M4-prep) → M3 (needs M1) → M4 (needs M2) → M5 (needs M1–M4).

---

## Prerequisites

- Enable **Distance Matrix API** on the Google project (M4). Add `GOOGLE_MAPS_API_KEY` to `env.ts` + `.env.example`.
- Every new migration is appended idempotently to a dated `supabase/catch-up-*.sql` and folded into `setup.sql` (per the repo's DB-sync convention). [[gytm-db-sync]]
- Tests: extend `tests/db/rpc.ts` ALLOWED set for any new `api_*` (`api_planner_places`). Pin vehicle prices in `tests/integration/security-fixes.test.ts` (existing vehicle-pricing test home) + a new `tests/unit/planner-pricing.test.ts`.

---

## Key risks / notes

- **`vehicle_custom` must be added everywhere `'vehicle'` is special-cased** (hold qty, booking line, catalogue DTO, client `pricingMode` handling). Grep `'vehicle'` before finishing M1.
- **Planner sessionStorage key** must NOT collide with the tour builder's `gytm:itinerary:<slug>`; the Custom Road Trip slug differs, but verify `Checkout` reads the right key (it gates on `from=widget`).
- **child seats** apply uniformly (€6 each, first free) — the planner inherits this for free.
- Live DB is drift-managed via `catch-up-*.sql`; never assume the live DB auto-applies migrations.
