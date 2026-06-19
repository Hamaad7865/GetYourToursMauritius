# GYTM session handoff — 2026-06-19

> Written before a context compaction. Everything below is **merged into `main`** unless marked
> "pending / your side". `main` is in sync with `origin/main`. Green gate (typecheck + lint + 297
> tests) was clean at the end of the session.

---

## TL;DR of what shipped this session

1. **A 6-item bug/feature batch** (booking widget + AI planner).
2. **Full French (FR) translation + USD currency** for the customer-facing app.
3. **A correctness audit** (oversell/undersell focus) → **5 confirmed bugs fixed**. No oversell found.
4. **Two CI/deploy fixes**: a seed timezone flake, and the Cloudflare `/_not-found` build error.
5. **Decision: deploy via Cloudflare Pages + `@cloudflare/next-on-pages` (Path A).**

---

## 1. The 6-item batch (done, merged)

Done one-by-one with a review after each (the user's cadence).

- **Bug — date popover clipping.** `BookingWidget` calendar was a 640px dual-month popover overflowing
  the 374px booking column. Collapsed to a single 320px month (`w-[min(92vw,20rem)]`).
- **Bug — option card spacing.** Added `mt-6` to `BookingOptionCard` root (margins collapse, neighbours
  keep their 24px).
- **Feature — "Make this tour your own" CTA → AI planner hand-off.** New edge route
  `app/api/planner/from-tour/route.ts` resolves a tour's itinerary stop titles → real Google places (via
  `resolvePlaceByText` + the pure `resolveTourStops` in `src/lib/planner/from-tour.ts`). `PlannerShell`
  gained a `?fromTour=<slug>` deep-link branch.
- **Feature — AI-planner promo card.** `src/components/catalogue/PlannerPromoCard.tsx` (coral **NEW**
  badge) leads the "Private Sightseeing tours" listing **and** its home rail. `isSightseeingCategory()`
  matches the live "Private Sightseeing tours" + the fallback name. `ActivityGrid` takes a `leadingCard`.
- **Feature — planner pickup type-to-search + drop-off.** `PickupSearch` combobox (5 base presets + live
  `/api/planner/places?q=` search); pickup pinned **"P"** first on the map, drop-off **"D"** last (one-way
  route, no return leg). `computePlannerRoute` gained an optional `end`. `RouteMap` gained a `labels` prop
  (endpoints "P"/"D", stops 1..n) — non-breaking (tour pages keep numeric labels). Pickup + drop-off ride
  the checkout query → `pickupLocation` on the booking.
- **Feature — mobile "Get my quote" centred modal + baby-seat option.** `QuoteModal` is now centred
  (`animate-pop`) with a baby/child-seat stepper (first free, €6 each, live estimate). Wired `childSeats`
  through `PlannerShell.bookDay`.

A **pre-push adversarial review** caught 6 issues (all fixed before merge): `pickupLocation` 200-char clamp,
`QuoteModal` a11y (wired the `useDialog` APG hook), the child-seat total reconciliation, and the drop-off
state machine (owned in `PlannerShell` so it survives the mobile tab remount + clearTrip).

---

## 2. French + USD i18n (done, merged)

**Architecture (important — read before touching i18n):**

- Locale + display currency live in **cookies** (`gytm_lang`, `gytm_ccy`) so server pages localise +
  price at SSR. See `src/lib/i18n/config.ts`.
- **gettext-style** `t('English source')` → French map in `src/lib/i18n/messages.ts` (the English string IS
  the key; missing keys fall back to English). `translate()` is pure; server uses `getT()` from
  `src/lib/i18n/server.ts` (reads cookie), client uses `useT()` from `PreferencesProvider`.
- Currency: live EUR→USD from **Frankfurter** (`getUsdRate()` in `src/lib/money/fx.ts`, no API key, cached
  daily, safe fallback). `<Price eur={n}/>` (`src/components/site/Price.tsx`) is a **client island** so a
  currency switch updates every price instantly. **Bookings are charged in EUR; USD is display-only** —
  checkout shows a "Vous serez débité en EUR" note.
- Switching language/currency writes the cookie + `router.refresh()` so server pages re-render; client
  components react via context.
- **NOT translated** (by design): place names, map pins, itinerary stop titles, DB tour
  titles/descriptions, category names, brand names.
- Coverage: **642 dictionary keys** across the whole customer-facing app, produced by a **9-agent
  workflow** fan-out (each agent owned disjoint files, returned FR entries I merged). A precise audit
  confirmed **every `t()` key in the code exists in the dictionary** (zero English-fallback leaks).
- **Admin stays English** (scope decision).

---

## 3. Correctness audit + the 5 fixes (done, merged via PR #28)

A 6-dimension multi-agent audit (each finding adversarially re-verified). **Headline: the inventory engine
is sound — no oversell, no double-booking, no data corruption.** `create_hold` takes `SELECT … FOR UPDATE`
on the occurrence; `used_capacity` = confirmed bookings + active non-expired holds.

The 5 confirmed bugs, **all fixed**:

| Sev | Bug | Fix |
|---|---|---|
| HIGH | Same-day undersell (server advertised/held today's slot) | **Tomorrow-earliest** (Mauritius): `api_list_availability` lower clamp, `create_hold` `occurrence_too_soon` guard, planner min-date → tomorrow. Widget was already tomorrow-only. |
| HIGH | Cart checkout inherited a stale widget hold → false "expired" + wrong-booking replay | Only read the stashed hold on `from=widget`; ignore a past expiry; clear it after booking. (`Checkout.tsx`) |
| MEDIUM | Authed caller could adopt + read a guest booking via key replay (F23 PII) | Email-match proof now applies to **any** caller replaying an unowned booking (`api_book` guard precondition). |
| LOW | per_group uncapped tier: widget showed 1 group, cart/server charged per head | Widget per-head fallback (`BookingProvider`) + admin requires a cap on every tier (`activity-write.ts`). |
| LOW | `release_hold` callable by any logged-in user | Revoked from `public`/`authenticated`. |

SQL fixes are in **`supabase/migrations/20260719120000_audit_fixes.sql`** (dated to sort AFTER the existing
July-18 migration) + mirrored into **`supabase/catch-up.sql`**. New test: `tests/integration/audit-fixes.test.ts`.

**⚠️ PENDING / YOUR SIDE: re-run `supabase/catch-up.sql` on the live Supabase DB** to apply the SQL fixes
(tomorrow-earliest, F23, release_hold). It's idempotent.

---

## 4. CI / deploy fixes (done, merged)

- **Seed timezone flake.** `src/lib/seed/sql.ts` anchored sample occurrences to UTC `current_date + 1`,
  which near the UTC/Mauritius boundary is "today" in Mauritius → the new tomorrow-guard rejected it →
  the seed-based booking tests failed only when CI ran late-UTC/early-Mauritius. Now anchored to
  `(now() at time zone 'Indian/Mauritius')::date + 1`. Regenerated `supabase/seed.sql` (`npm run seed:gen`).
- **Cloudflare `/_not-found` build error.** The root layout read `cookies()` for the SSR locale, making
  **every** route dynamic — including the implicit `/_not-found`, which `next-on-pages` can't build with
  runtime logic. **Fix:** route group. The cookie-reading providers moved to **`app/(site)/layout.tsx`**;
  the **root `app/layout.tsx` is now a STATIC shell** (html/body/fonts/JsonLd only); the global
  **`app/not-found.tsx` is self-contained** (no providers). Verified locally: `next build` reports
  **`○ /_not-found` (static)** and every page `ƒ` (dynamic/edge). The provider syncs `document.lang`
  client-side (the root `<html lang>` is now static "en").

---

## 5. Deploy plan — Path A: Cloudflare Pages + next-on-pages (decided)

The repo is **already configured** for Pages (`wrangler.toml` → `pages_build_output_dir =
".vercel/output/static"`, `package.json` → `"pages:build": "npx @cloudflare/next-on-pages"`). The failing
Cloudflare project was a **Worker** running `npm run build` + `npx wrangler versions upload` (a mismatch).

**⚠️ PENDING / YOUR SIDE:** create a **Pages** project (Workers & Pages → Create → Pages → Connect to Git →
`GetYourToursMauritius`):
- Production branch: `main`
- Framework preset: **None**
- **Build command: `npm run pages:build`** ← the key change (NOT `npm run build`)
- **Build output directory: `.vercel/output/static`**
- Env var `NODE_VERSION = 22` + Supabase/secret vars (full list in `src/lib/config/env.ts`)
- **No deploy command** (Pages auto-deploys the output dir)

`next-on-pages` only runs on Linux (it's broken on Windows: `spawn bash/npx ENOENT`), so the real build
happens on Cloudflare. With `/_not-found` now static, the earlier error is resolved.

Future option: migrate to **`@opennextjs/cloudflare`** (Workers, the newer recommended path) post-launch —
contained change, no urgency.

---

## Gotchas / notes for future-you

- **Migration-revert-drift is real.** A later-dated migration's `create or replace` silently reverts an
  earlier one. New migrations must sort AFTER the latest existing (currently `20260719120000`). The
  `tests/integration/catch-up-parity.test.ts` guards this — it caught me dating a fix June-19 when a
  July-18 migration existed. **Mirror every function change into `catch-up.sql`** (appended last).
- **Mauritius (GMT+4) vs UTC day boundary** has bitten 3×. Anything bucketing by "day" must anchor to
  `Indian/Mauritius` (materialize_availability, api_list_availability, create_hold guard, the seed).
- **next-on-pages can't build a dynamic `/_not-found`.** Keep the root layout static (route group) and the
  global not-found self-contained.
- **Tests apply only `supabase/migrations/*` in filename order** (PGlite); the parity test layers
  `catch-up.sql` on top. `setup.sql` is the fresh-install base, not used by tests.
- **Forward-looking for Peach (payments):** a hold has a ~30-min TTL and reserves the seat only while
  active. When payment is wired, the **capture/confirm step must re-check capacity** before finalizing —
  otherwise a hold expiring mid-payment reopens an oversell window. Not a bug today (payment isn't wired).

---

## Key decisions made this session

- **No same-day bookings** — earliest is tomorrow (Mauritius). Enforced server + client.
- **USD is display-only**; bookings charged in EUR.
- **French = customer-facing app only**; admin stays English.
- **Frankfurter** for FX (free, no key).
- **Cloudflare Pages + next-on-pages** for deploy.
- **Root layout static via `(site)` route group.**

---

## Commit / PR reference (on `main`)

- `ab86fbf` Merge PR #28 (audit fixes + seed TZ + route-group build fix)
- `34ef7d4` route group (static root layout) · `fb2a4ed` edge not-found (superseded by route group)
- `8be1cf4` seed Mauritius TZ · `3a176aa` the 5 audit fixes
- `f6928de` i18n FR fan-out (54 files) · `136fb17` i18n + USD foundation
- `d05bda9` planner pre-push review fixes
- earlier merges: planner hand-off / promo / pickup-dropoff / quote modal; booking-widget layout

PR #28: https://github.com/Hamaad7865/GetYourToursMauritius/pull/28 (merged)

---

## Outstanding (your side)

1. **Create the Cloudflare Pages project** with the settings in §5.
2. **Re-run `supabase/catch-up.sql`** on the live DB (the audit SQL fixes).
3. Launch target remains **2026-07-29**. Peach payment integration still the long pole (see memory
   `gytm-go-live`); remember the capacity re-check note above when wiring it.
