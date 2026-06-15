# GetYourToursMauritius — Build Progress / Session Handoff

Snapshot for resuming after a context compaction. Branch `main`, local == remote on GitHub (`Hamaad7865/GetYourToursMauritius`, **private**). **Supabase is LIVE.** Full gate green: `npm run typecheck && npm run lint && npm run test && npm run build` (**102 tests**).

> ⚠️ There are **uncommitted working-tree changes** (the home header transparent-over-hero behaviour) — see [Uncommitted WIP](#uncommitted-wip-not-on-github-yet). Everything else below is committed.

## What this is

Production tours-booking platform for **Belle Mare Tours** (east-coast Mauritius), brand **GetYourToursMauritius**. API-first. 8 phases (0–7). Phases 0–3 done; now mid a **GetYourGuide-clone UI redesign** (home + detail done; listing page not yet; Phase 4 auth/booking not started).

## Current status at a glance

| Area                                          | Status                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| Backend (schema, RLS, RPCs, /api/v1, OpenAPI) | ✅ Phases 0–2                                                          |
| Supabase project (live) + data wired          | ✅ app reads live data                                                 |
| Home page — GYG clone (our brand)             | ✅ (header transparent-hero WIP uncommitted)                           |
| Activity **detail** page — GYG clone          | ✅ heavily polished against `north-tour`                               |
| **Listing** page (`/activities`)              | ⚠️ still old Phase-3b style (header/cards inconsistent)                |
| Auth / sign-in / session / **My bookings**    | ❌ Phase 4, not started (header icons are placeholders → /account 404) |
| Booking flow                                  | ⚠️ interim **"Reserve on WhatsApp"** CTA only                          |

## Environment constraints (important)

- **Use `npm`** (not pnpm — corepack EPERM). Node 24. Bash tool = Git Bash. Windows 11.
- **No Docker / Supabase CLI** → DB is tested with **PGlite** (real Postgres WASM, in-process). `src/lib/supabase/types.ts` is hand-authored.
- **`npm run build` and `next dev` share `.next`** → running a build while the dev/preview server is up **clobbers its CSS** (page renders unstyled). Workflow: **stop the preview → `npm run build` → `rm -rf .next` → restart preview.**
- **Preview MCP (`mcp__Claude_Preview__*`) is flaky**: servers die between turns, viewport resets/collapses to ~7px, and client hydration goes stale after many HMR cycles (a clean stop + `rm -rf .next` + start fixes hydration). Verify via `preview_eval` measurements; screenshots often time out. The user reviews in their own Chrome — give changes then say "hard-refresh (Ctrl+Shift+R)".
- `.npmrc` has `legacy-peer-deps=true`.

## Supabase (LIVE)

- Project ref **`dwjkfowhrrvdiqligxcj`**, region eu-central-1. URL `https://dwjkfowhrrvdiqligxcj.supabase.co`.
- Credentials are in **`.env.local`** (gitignored): `SUPABASE_DB_URL` (session-pooler, `aws-1-eu-central-1.pooler.supabase.com:5432`), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy `eyJ…anon`), `SUPABASE_SERVICE_ROLE_KEY`.
- **STILL MISSING: `SUPABASE_JWT_SECRET`** (Settings → API → JWT Settings → Reveal — a plain string, NOT a `eyJ…` token). Needed for Phase 4 edge token verification. Ask the user for it.
- **Security TODO (flagged to user):** the DB password + service_role key were pasted in chat — they should reset the DB password and roll the JWT secret.
- **How the schema got applied (no CLI):** `npm run setup:sql` bundles all migrations+seed into `supabase/setup.sql`; `npm run db:setup` (`scripts/db-setup.ts`) applies it over the connection string via the `pg` package (tolerant parser handles `@`/`:` in passwords; hints to use the IPv4 session pooler, not the IPv6 direct host). `scripts/db-exec.ts <file…>` runs arbitrary SQL files (used for patches). Guide: `SUPABASE_SETUP.md`.
- **Dev fallback:** when no Supabase env is set (non-prod), `src/lib/http/context.ts#selectDb` uses `src/lib/dev/seed-rpc.ts` (serves `seed/catalogue.json` with picsum/placeholder enrichment) so the catalogue renders without a project.

### 🔴 Critical bug fixed this session

`supabaseRpc` extracted `client.rpc` into a detached variable → `this` lost → every real-Supabase call threw `Cannot read properties of undefined (reading 'rest')` → 502. Only surfaced once a live project existed (all tests use the PGlite adapter). Fixed by binding to the client (`6c1ce0b`); guarded by `tests/unit/supabase-rpc.test.ts`.

## Stack

Next.js 15.5.19 (App Router, TS strict, all server code `runtime='edge'`) · Tailwind 3.4 (tokens RGB channels; **`--color-cream` is now `255 255 255` = white** — site background was switched from cream to white) · Supabase via **`api_*` RPCs only** · Peach (stub) · Vercel AI SDK (stub) · Zod · `jose` · `zod-openapi` · Vitest + PGlite. **New deps:** `pg` (db scripts), `leaflet` + `@types/leaflet` (itinerary map), `@types/google.maps` (for future Google Maps switch).

## Locked architecture decisions (do NOT re-litigate)

- Framework-agnostic service layer (`src/lib/services/**`, zero Next imports); narrow `DbRpc` port with `supabaseRpc` (prod) + `pgliteRpc` (tests) running identical SQL.
- Concurrency-safe booking core (`session_occurrences` + `booking_holds`, computed availability, atomic plpgsql RPCs); event-sourced `payment_events` ledger; multi-operator data / single-brand storefront; RLS deny-by-default; bigint money.
- **GYG-clone UI, our colours:** full GetYourGuide layout/effects recoloured to teal (primary) / coral (urgency·sale) / ink ("Top rated"). White background. Bold Plus Jakarta Sans headings (no Fraunces on GYG pages). Components under `src/components/gyg/**`.

## Schema (`supabase/migrations/`)

20 columns of note: the 19 tables from Phase 1, **plus** `activities.extra jsonb` (migration `20260615121400_activity_extra.sql`) holding GYG presentational extras: `{ itinerary:[{title,area,tags[],lat,lng}], importantInfo:[…], availability, startWindow, returnWindow }`. `api_get_activity` returns `extra`; `TourDetail.extra` (Zod) in `src/lib/validation/tours.ts` (incl. `itineraryStopSchema` with lat/lng/tags). Content patches live in `supabase/patches/` (north-tour content, itinerary tags, coords).

`api_*` (single jsonb arg): `api_search_activities`, `api_get_activity` (+extra), `api_list_availability`, `api_book`, `api_create_payment`, `api_get_booking`, `api_capture_lead`, `booking_json`.

## GYG redesign — what's built

**`src/components/gyg/`** (all our brand):

- `GygHeader.tsx` (client) — sticky/transparent header. `heroMode` (home), `sticky`, `showSearch` props. On home it should overlay the hero transparent then go solid-white + hide the nav row on scroll (**this exact behaviour is the uncommitted WIP**). Detail page passes `sticky={false}` (non-sticky) but keeps the search.
- `GygHero.tsx` — branded teal-gradient hero + big search (no-JS GET form).
- `Rail.tsx` (client) — horizontal scroll-snap with ‹ › arrows; scrollbar hidden via the `.no-bar` utility added to `app/globals.css`.
- `GygCard.tsx` — GYG product card (heart, Top-rated badge, location, meta, rating, From price/unit) with stretched-link so the `WishHeart` stays clickable.
- `WishHeart.tsx`, `RecordView.tsx`, `ContinuePlanning.tsx` — localStorage wishlist + recently-viewed "Continue planning" rail.
- `detail/Gallery.tsx` (client) — 1-big + 2×2 grid, "View all photos" lightbox. Height `sm:h-[360px]` (landscape; do NOT make it viewport-tall — that squeezes the images).
- `detail/BookingCard.tsx` (client) — sticky widget (badge, From price, participants/date/language, total, "Reserve on WhatsApp" interim CTA).
- `detail/Sections.tsx` — `QuickFacts` (2-col icon-tile grid + "Loved by travellers" banner), `Overview`, `Itinerary` (uses RouteMap), `Includes`.
- `detail/RouteMap.tsx` (client) — **Leaflet + OpenStreetMap** map with a pin per itinerary stop, route polyline, re-center button. No API key. Owner wants **Google Maps** eventually (needs a Maps API key + billing; `@types/google.maps` already installed).
- `detail/ItineraryTimeline.tsx` (client) — collapses to first stops with "Show full itinerary" toggle when >3 locations.
- `detail/SeeMore.tsx`, `detail/ShareButton.tsx`.

**Pages:** `app/page.tsx` (GYG home: header + hero + Continue rail + per-category rails) and `app/activities/[slug]/page.tsx` (GYG detail) are rebuilt. **`app/activities/page.tsx` (listing) is NOT yet converted** — still SiteHeader/ActivityGrid (Phase 3b). Detail-page layout: gallery (left) + sticky booking (right), content below; title one line; description right under the gallery; non-sticky header.

## North Tour (the demo activity)

`north-tour` was enriched with the operator's **real content** (description, 6 highlights, 12 includes, 4 excludes, 5+1 itinerary stops with tags + coords, €70 "Private group up to 4", extra overview, 4.8/126 rating) via `supabase/patches/`. Gallery currently uses **picsum placeholders**. **Real photos provided** in `Activity Pictures/North Tours/` (central-market.jpg, cover-pamplemousse-garden.jpg, pereybere-beach.jpg, shutterstock_443614957.jpg, …) — **next step: upload to Supabase Storage and update `activity_images.url`** (the folder is untracked/local).

## Uncommitted WIP (NOT on GitHub yet)

`git status` shows **`src/components/gyg/GygHeader.tsx`** and **`src/components/gyg/GygHero.tsx`** modified — the home header that **overlays the hero transparently at the top, then turns solid white + hides the "Things to do" nav row on scroll** (per the owner's last request, matching GYG). Header changed to `position: fixed` in heroMode; `GygHero` got extra top padding (`pt-32 sm:pt-40`) to clear it; bg uses `bg-white` (not `bg-white/97`, which wasn't generating). **Verified:** initial state correct (transparent + nav shown + white logo at top), no console errors, typecheck/lint pass, 102 tests pass. **NOT verified:** the scroll reaction (transparent→white, nav hide, search dock) — the flaky preview wouldn't hydrate reliably, but the scroll-listener pattern is the same one that worked in the owner's browser earlier. **TODO: confirm in a real browser, then `npm run build` (preview stopped) + commit + push.** (A stray `/*  */` edit to `envelope.ts` was reverted.)

## Key commits (newest first)

`20f1322` richer quick-facts + loved banner · `9f1728e` hide rail scrollbar · `00e0dc6` gallery landscape height · `c1122dd`/`bca165e`/`16d3ccb`/`9b256b9`/`5eded04`/`482c2bd` detail-page polish rounds · `c05f1a7` Leaflet pin map · `5ae487e` GYG detail page + extra column · `6a7a699` GYG home · `6c1ce0b` **supabaseRpc bind fix** · `ee7f884`/`9a7504d` Supabase setup tooling · `7905035` dev seed adapter · `44ec050` Phase 3b review · `e4abc8a` Phase 3b pages.

## What's next (suggested order)

1. **Finish & commit the home header WIP** (verify scroll behaviour in real Chrome).
2. **Upload the real North Tour photos** (Supabase Storage) → swap `activity_images.url`.
3. **GYG-ify the listing page** (`app/activities/page.tsx`) using `GygHeader` + `GygCard` + rails — last inconsistent page in the flow.
4. **Google Maps** (optional, needs key) — swap the Leaflet tile layer / use Maps JS API for the route.
5. **Phase 4 — auth + bookings** (the owner explicitly wants GYG-style: sign in → retained session → profile → **Bookings** history): Supabase email + Google auth, session-aware header (wire the placeholder Wishlist/Cart/Bookings/Sign-up), `/account` + "My bookings" page, the real 4-step checkout replacing the WhatsApp CTA, Peach behind the stub. **Needs the JWT secret first.**
6. Phases 5 (AI assistant), 6 (admin `/admin`), 7 (a11y/SEO/deploy — consider OpenNext over the deprecated next-on-pages).

## Pointers

- Memory: `~/.claude/projects/C--Projects-GetYourToursMauritius/memory/` — `gytm-build-decisions.md`, `gytm-gyg-redesign.md` (detail-page layout rules: non-sticky header + search, gallery-left/booking-right, pin map, white bg).
- Setup: `SUPABASE_SETUP.md`. Scripts: `db:setup`, `db:exec` (via `tsx scripts/db-exec.ts`), `setup:sql`, `seed:gen`, `openapi:write`.
- Test harness: `tests/db/{pglite.ts,auth-shim.sql,seed.ts,rpc.ts,route-context.ts}`. Plan: `~/.claude/plans/content-import-seed-data-reactive-dragonfly.md`.
- Preview launch config: `.claude/launch.json` (`npm run dev`).
