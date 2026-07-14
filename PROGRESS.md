# Belle Mare Tours — Progress & Handoff

> Session handoff doc. Read this first after a compaction. Production tours-booking
> platform for **Belle Mare Tours** (east-coast Mauritius). API-first, edge-deployed
> on Cloudflare Pages. Visual target: a **GetYourGuide clone recoloured to our brand**
> (teal primary, coral urgency, ink "top rated", **white** background, Plus Jakarta Sans).
>
> Repo: GitHub `Hamaad7865/Belle Mare Tours` (**private**). Branch `main`.
> **Supabase is LIVE.** Full gate green: typecheck + lint + **121 tests** + build.

---

## 0. ⚠️ DO THIS FIRST — apply `supabase/catch-up.sql` to the live DB

The live Supabase DB **drifted** — two migrations were never applied (they were run out of
order). A diagnostic confirmed the live DB has `121000, 121200, 121400, 121700, 121900` but is
**missing `121600` (booking admin guards) and `20260616120000` (open availability)**. The
symptom the user hit: **"Something went wrong" when enabling availability on South East Tour** —
because the live `activities` table has **no `daily_capacity` column** yet.

**Fix:** run **`supabase/catch-up.sql`** ONCE in the Supabase SQL editor (or
`npx tsx scripts/db-exec.ts supabase/catch-up.sql`). It is an idempotent `begin … commit` bundle
of migrations `121300 + 121600 + 20260616120000`, **verified to re-apply cleanly** on a
fully-migrated DB (so it's safe even if part of it is already there). After it runs, "Make
bookable" works on every activity.

**Going forward:** apply migrations in **filename order**. (Offered a `npm run db:status` helper to
compare applied vs. on-disk — not yet built.)

---

## 1. Stack & environment

- **Next.js 15.5.19** App Router, TypeScript strict, **every route `runtime='edge'`**, Tailwind 3.4.
- **Supabase** (live, see §2) reached two ways:
  - **Server `/api/v1`** via `api_*` Postgres RPCs with a Bearer JWT (verified at the edge).
  - **Browser client** (`src/lib/supabase/browser.ts`, persisted session) for web auth + admin writes, under RLS.
- **PGlite** (real Postgres WASM) for tests — no Docker/Supabase CLI. Migrations in `supabase/migrations/**` are applied in order by the harness (`tests/db/pglite.ts`).
- Payments behind a `PaymentProvider` interface: **StubPaymentProvider** (active, no Peach keys) + `PeachPaymentProvider` (placeholder, throws NotImplemented).
- **Client-side stores** (localStorage + event-synced reactive hooks): cart `gytm:cart` (`src/lib/cart/useCart.ts`), wishlist `gytm:wishlist` (`src/lib/wishlist/useWishlist.ts`).

### Environment constraints (this Windows machine)

- Use **npm**, not pnpm.
- `npm run pages:build` FAILS on Windows (next-on-pages CLI bug). `next build` proves edge-compat; run `pages:build` under WSL/CI.
- **Build clobbers the dev server's `.next`** → always: stop preview → `rm -rf .next` → `npm run build` → `rm -rf .next` → restart preview. Building while the dev server runs causes "Failed to collect page data" errors (corrupted `.next`, not a code bug). Symptom of a corrupted dev `.next`: blank/opacity-0 hero, images not loading — restart preview to fix.
- Node 24, npm 11, Bash tool = Git Bash. Preview screenshots are flaky after many HMR cycles — a clean restart fixes it. After a preview restart a 1px broken viewport can appear → resize to 1440×900.

### Green gate (after every change)

`npm run typecheck && npm run lint && npm run test && npm run build` — currently **121 tests, all green** (21 test files).

---

## 2. Live Supabase (wired)

- **Project ref:** `dwjkfowhrrvdiqligxcj`. `.env.local` (gitignored) has:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_URL`, `NEXT_PUBLIC_SITE_URL`, **`SUPABASE_JWT_SECRET`** (legacy HS256 secret).
- **JWT signing is ES256 (asymmetric)** — JWKS at `/auth/v1/.well-known/jwks.json`. The legacy HS256 key is the _previous_ key (revoke once old tokens expire). Edge verify (`src/lib/http/auth.ts`) supports **both**: ES256→JWKS, HS256→shared secret.
- **The auto-mode classifier BLOCKS the assistant from live-DB writes** (applying migrations, creating auth users, deleting rows). Workarounds: North Tour photos as a `public/` overlay; the user runs `admin-setup.sql` / `catch-up.sql` themselves.
- **Live DB has drifted** — see §0. Missing `121600` + `20260616120000`; apply `catch-up.sql`.
- Secrets were pasted in chat (legacy JWT secret, an old DB password, service_role) — **rotate them**.

---

## 3. Phase status

| Phase     | What                                                                                                                                                                                                                          | Status         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 0         | Scaffold + seams + green gate                                                                                                                                                                                                 | ✅             |
| 1         | 19-table schema + RLS (deny-by-default) + atomic plpgsql RPCs (`create_hold`, `create_booking`, `append_payment_event`, `expire_holds`) + hand-authored `supabase/types.ts` + bilingual `seed/catalogue.json` (23 activities) | ✅             |
| 2         | Service layer (DB access only via `api_*` RPCs; `DbRpc` port = `supabaseRpc` prod + `pgliteRpc` tests) + `/api/v1` + OpenAPI                                                                                                  | ✅             |
| 3         | Public catalogue: home, browse, **activity detail**, SEO/JSON-LD, sitemap                                                                                                                                                     | ✅             |
| —         | **GYG redesign**: home (transparent header over hero + scroll-collapse), detail clone, white bg                                                                                                                               | ✅             |
| —         | **Animated lagoon hero** (image-free CSS/SVG) + **search-in-navbar** + **per-category home sections** + sliding **photo pile**                                                                                                | ✅             |
| 4a        | **Auth**: email + Google + Apple + Facebook; retained session; profile; bookings history; **login/logout toasts**                                                                                                             | ✅             |
| —         | **JWKS edge verify** (ES256) + HS256 fallback                                                                                                                                                                                 | ✅             |
| —         | **Wishlist** (hearts everywhere + `/wishlist`) + **functional cart** (`/cart`, add-to-cart, line items, hold timer)                                                                                                           | ✅             |
| 6 (slice) | **Admin panel**: Activities CRUD + **open-ended daily-capacity availability**                                                                                                                                                 | ✅             |
| 4b        | **Booking**: bookable activities, payment webhook, confirmation, 3-step checkout                                                                                                                                              | ✅             |
| —         | **Per-group pricing** (opt-in flag for island tours: `ceil(people/max_guests) × amount`)                                                                                                                                      | ✅             |
| 5         | AI assistant                                                                                                                                                                                                                  | ⏳ not started |
| 6 (rest)  | Admin dashboard / bookings table / leads                                                                                                                                                                                      | ⏳             |
| 7         | Final pass (a11y, deploy, README)                                                                                                                                                                                             | ⏳             |

---

## 4. What THIS session built (newest first)

### Open-ended availability — the daily-capacity model (replaces the 365-day cap)

- **Problem the user reported:** "every time I have to make it enable again" — the old model
  pre-generated a rolling year of occurrences, so it looked like it reverted, and re-enabling each
  year was annoying.
- **New model:** an activity is bookable on **any future day** when `activities.daily_capacity`
  is set (e.g. `10`). **No yearly re-enable.** A day is **full once its bookings reach the
  capacity**.
- **`supabase/migrations/20260616120000_open_availability.sql`** — adds `activities.daily_capacity int`,
  an idempotent unique constraint `session_occurrences (activity_option_id, starts_at)`, and rewrites
  **`api_list_availability`** as `SECURITY DEFINER VOLATILE` that **lazily materialises** day-slots
  on read (write-on-read): for a published activity with `daily_capacity > 0` it fills any missing
  day in `[today, today+185]` (one slot/option/day at **noon UTC**), bounded so an anon read can
  never trigger a huge fill; the window rolls forward as `current_date` advances. `seatsLeft =
greatest(capacity − used_capacity, 0)`. **Includes today** (same-day bookable). Gated to
  `status='published'` so drafts never leak.
- **`src/lib/admin/availability-write.ts`** — `setDailyCapacity(activityId, capacity)` (sets
  `daily_capacity` + propagates to future occurrences), `loadAvailabilityState` (reads it),
  `stopAvailability` (clears `daily_capacity`, **closes** booked/held future days `status='closed'`,
  deletes empty ones — never strands a confirmed booking or live hold).
- **`src/components/admin/AvailabilityEditor.tsx`** — just a capacity number + **Make bookable** /
  **Update capacity** / **Stop availability**. Copy: "Bookable on every future date — a day fills
  up once {capacity} guests have booked it." Added **`errMessage(err, fallback)`** so the panel
  surfaces the **real** Supabase/PostgREST error (those aren't `Error` instances) instead of a
  generic "Something went wrong" — this is how the live-DB drift was diagnosed.
- **Review (14 confirmed, fixed in `aad0377`):** same-day fill, noon-UTC-day dedupe guard so a
  legacy/seed slot at another time blocks a duplicate, `stopAvailability` closes booked days,
  `seatsLeft` clamp ≥ 0, bounded 185-day horizon + a short edge cache on the availability route.
- **Tests:** `api-functions.test.ts` now asserts open-ended materialisation, idempotency (2nd read
  = same window, no dupes), and same-day (9 tests in that file).

### Functional cart

- **`src/lib/cart/useCart.ts`** (NEW) — localStorage `gytm:cart`, event-synced reactive hook.
- **`src/components/cart/CartView.tsx`** + **`/cart`** — line items, hold-timer prune at 00:00,
  **"Estimated total"**, stepper with `lineCap` (seats + tier cap), AA-contrast badge.
- **`BookingWidget`** gained **Add to cart**; **`Checkout`** reconciles a `serverTotal` (the `total`
  query param is validated, the server price wins).
- **Review (10 confirmed, fixed in `0e24fbe`):** stepper cap, server-total reconcile, cart
  `aria-label`, badge `text-ink` contrast, HoldTimer prune, "Estimated total" label.

### Wishlist

- **`src/lib/wishlist/useWishlist.ts`** (NEW) + **`WishlistView.tsx`** + **`/wishlist`** +
  **`WishHeart.tsx`**; the heart is on the home tiles AND the `/activities` listing **`ActivityCard`**.

### Account toasts + Bookings icon

- **`AuthProvider`** fires a **login toast** (user-id transition + `hadStored` localStorage check +
  foreground guard) AND a **logout toast**. `ToastProvider` wraps `AuthProvider` in `app/layout.tsx`.
- Signed-in **Bookings** entry; upcoming/past split; resilient bookings page.

### Animated lagoon hero (image-free) + search-in-navbar + photo pile

- **`src/components/gyg/GygHero.tsx`** — **no photo**. A pure **CSS/SVG animated backdrop**:
  `isolate` + `-z-10` + `mix-blend-mode:screen` lagoon blobs drifting over a depth gradient, an SVG
  wave, scrims + vignette. (Built in pure CSS deliberately — **not** framer-motion. The `isolate`
  fix is what stopped the hero rendering blank.) Headline is **Fraunces italic** "lagoon,".
- **Search moved into the navbar**; the hero texts sit in its place under the navbar.
- **`src/components/gyg/HeroGallery.tsx`** (NEW) — a CSS **polaroid photo pile** (the "flick-through"
  the user asked for) on the hero's right; nested-transform entrance + float, `aria-hidden`,
  `hidden lg:block`. Bottom whitespace tightened.
- **`app/globals.css`** — keyframes `drift`, `waveDrift`, `hgIn`, `hgFloat`; `.lagoon-blob` /
  `.lagoon-wave`; reduced-motion disables all of it.
- **`app/layout.tsx`** — Fraunces loaded with `style: ['normal','italic']`.
- **Per-category home sections** (`ae7791c`) — the home page now groups tiles by category.

### Per-group pricing (opt-in)

- `c3076ed` — island-tour options can price **per group**: `ceil(people / max_guests) × amount`.
  Gated by a `group_pricing` flag on the activity (scoped opt-in, so per-person tests stay intact).
  Added `daily_capacity` + `group_pricing` to `ActivitiesRow`/`Insert` in `src/lib/supabase/types.ts`.

> Earlier-session work (premium logo/home, GYG redesign, auth, admin CRUD, booking+payment) is in §4-prior below.

---

## 4-prior. What earlier sessions built (recent → oldest)

### Cards & photos

- **`PlaceCard`** — static card, **image-only hover zoom**, CSS photo carousel, stretched `<Link>`. Replaced `GygCard` (deleted). framer-motion removed.
- **North Tour real photos**: 5 in `public/activities/north-tour/`, overlaid via `src/lib/catalogue/local-photos.ts` (`withLocalPhotos`) on home/browse/detail — no Storage upload / DB write. Source folder `Activity Pictures/` is gitignored.
- `images: TourImage[]` on `TourSummary`; `api_search_activities` returns it (migration `20260615121500_search_images.sql`).

### Navbar / header (exactly GetYourGuide)

- `GygHeader` navbar = **Wishlist · Cart · EN/EUR € · Profile** (dropped standalone Bookings + Sign in/up buttons).
- **Profile dropdown**: signed-out → "Log in or sign up"; signed-in → My profile / **My bookings** / Log out. **Bookings only shown when signed in.**
- **Language/Currency modal** via `PreferencesProvider` — **English + Français**, EUR; persisted; navbar shows "EN/EUR €" ↔ "FR/EUR €". (Selector + persistence only; full content translation = later i18n pass.)
- Browse page uses `GygHeader` too.

### Auth (4a) — `src/components/auth/**`

- `AuthProvider`/`useAuth` (persisted session, profile upsert on first sign-in), `AuthDialog` (email + Google/Apple/Facebook, focus-restore + scroll-lock), `/auth/callback`.
- `/account` (editable profile) + `/account/bookings` (history) — read directly under RLS.

### Admin (Phase 6 Activities-CRUD slice) — `app/admin/**`, `src/components/admin/**`

- `AdminGuard` (role staff/admin). `/admin/activities` list (New/Edit/**Availability**/Delete).
- **`ActivityForm`** captures every North-Tour field: basics, slug, category (enum), type, status, location, duration, summary/description, meeting point, cancellation, pickup, highlights/inclusions/exclusions/languages, **photos (Storage upload AND URL paste)**, options + price tiers, itinerary (→ `extra` jsonb).
- **Writes go DIRECT via the authed admin client** — staff RLS grants full write on activities/images/options/prices, so **no admin RPC/migration**. (`src/lib/admin/activity-write.ts`.)

### Booking + payment (4b)

- **`BookingWidget`** (GYG look): **Participants** stepper + custom **Date calendar** (greys past/today + full days) + custom **Language** dropdown (English/French). Cheapest tier/option. **"Book now"** (always shown) → `/checkout` with the selection in query params.
- **`/checkout` — 3 steps** (`src/components/checkout/Checkout.tsx`): (1) **Transport** (pickup radio + hold-spot countdown + spinner on Continue); (2) **Contact** (sign in / create account if needed; auto-advances on session); (3) **Payment** (booking with idempotency key + payment → redirect to `/bookings/[ref]`).
- **`POST /api/v1/webhooks/payments`** — the ONLY confirm path: verifies the event, appends via `append_payment_event` (service-role), idempotent. **Unauthenticated in stub mode by design** (real Peach signature closes it — don't deploy stub publicly).
- **`/bookings/[ref]`** (`BookingConfirmation`): shows the booking; stub return offers **"Complete payment (test)"** → webhook → confirmed → appears in My bookings.
- Money-path RPCs (`api_book`, `api_create_payment`, `append_payment_event`, stub) built in Phase 1–2. **Peach stubbed** (no keys).

### Tests (earlier)

- `tests/integration/admin-catalogue.test.ts`, `tests/integration/booking-flow.test.ts`, `tests/unit/auth-jwt.test.ts` (ES256/JWKS).

---

## 5. ⚠️ Setup the USER must run (classifier blocks the assistant)

**FIRST: apply `supabase/catch-up.sql`** (see §0 — syncs the drifted live DB).

Then **`supabase/admin-setup.sql`** ONCE on the live DB (Supabase SQL editor, or `npx tsx scripts/db-exec.ts supabase/admin-setup.sql`). It:

1. **Deletes all activities except `north-tour`** (permanent — user's choice).
2. **Makes an account admin** — `update profiles set role='admin'` for `boodoo.sheik786@gmail.com` (must have **signed up in the app first**).
3. Creates the public **`activity-images` Storage bucket** + staff-write/public-read policies (admin photo uploads).
   > Do **not** run `npm run db:setup` afterward — it re-seeds the 23 demo activities.

### Make an activity bookable live

`/admin/activities` → **Availability** → set **daily capacity** → **Make bookable**. Then on the site: pick a date → **Book now** (or **Add to cart**) → checkout → sign in → pay → **Complete payment (test)** → confirmed under My bookings. _(Needs `catch-up.sql` applied first, or you'll hit "no `daily_capacity` column".)_

---

## 6. Open items / decisions pending

- **Spawned background task `task_58a735ac`** — `updateActivity` recreates an activity's options on
  every edit, which can break a **booked** activity (FK churn on `session_occurrences`/`booking_items`).
  Pre-existing; queued as its own session.
- **Mobile hero search gap** — the navbar search is `hidden … sm:flex`, so phones show no search in
  the hero region. The user said "it should look like this on mobile" but **no reference image
  arrived** — awaiting it before designing the mobile hero/search.
- **Google Maps**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is wired; user is getting a key (enable Maps JS API + Places, create + restrict by HTTP referrer, add to `.env.local` + Cloudflare env). Then wire the **pickup map in checkout** and/or swap the **itinerary map** (currently Leaflet/OSM) to Google.
- **Peach payments**: stubbed until keys (`PEACH_ENTITY_ID/ACCESS_TOKEN/WEBHOOK_SECRET`). Implement `src/lib/payments/peach.ts`.
- **`npm run db:status` helper** — offered, not built: compare applied migrations vs. on-disk to catch drift early.
- **Known follow-up bugs (not fixed):**
  1. **Occurrence↔activity binding** — a hand-edited `/checkout?occ=` could book a different activity's slot than the title shown (self-inflicted; DB charges the real price). Proper fix = add a slug check to `api_book` (a migration the user applies).
  2. Availability window goes stale if the page is open past midnight (cosmetic; reload fixes).
- **Full French translation** of UI + content (FR data exists in `activity_translations`; selector/locale persist, content not switched yet).
- AI assistant (Phase 5), admin dashboard/bookings table/leads (Phase 6 rest), final pass (Phase 7) all still to do.

---

## 7. Key files

- Home/hero: `src/components/gyg/GygHero.tsx` · photo pile `src/components/gyg/HeroGallery.tsx` · `app/globals.css` (lagoon keyframes) · `app/layout.tsx` (Fraunces italic + ToastProvider)
- Cart: `src/lib/cart/useCart.ts` · `src/components/cart/CartView.tsx` · `app/cart/page.tsx`
- Wishlist: `src/lib/wishlist/useWishlist.ts` · `src/components/.../WishlistView.tsx` · `WishHeart.tsx` · `ActivityCard.tsx`
- Availability: `supabase/migrations/20260616120000_open_availability.sql` · `src/lib/admin/availability-write.ts` · `src/components/admin/AvailabilityEditor.tsx` · route `app/api/v1/activities/[slug]/availability/route.ts`
- Detail: `app/activities/[slug]/page.tsx` · widget `src/components/gyg/detail/BookingWidget.tsx`
- Checkout: `app/checkout/page.tsx` · `src/components/checkout/Checkout.tsx`
- Webhook: `app/api/v1/webhooks/payments/route.ts` · Confirmation: `src/components/gyg/detail/BookingConfirmation.tsx`
- Admin: `app/admin/**`, `src/components/admin/**`, `src/lib/admin/{activity-write,availability-write}.ts`
- Auth: `src/components/auth/**`, edge verify `src/lib/http/auth.ts`, browser client `src/lib/supabase/browser.ts`
- Prefs/search/header: `src/components/site/{PreferencesProvider,LangCurrencyModal}.tsx`, `src/components/gyg/{GygHeader,SearchBar,PlaceCard}.tsx`
- Catalogue overlay: `src/lib/catalogue/local-photos.ts`
- Migrations: `supabase/migrations/**` · **Drift fix: `supabase/catch-up.sql`** · One-time setup: `supabase/admin-setup.sql`
- Memory (persists across sessions): `~/.claude/projects/.../memory/` — `gytm-build-decisions.md`, `gytm-gyg-redesign.md`.

**All work committed on `main`** (latest: `2cbbf54` catch-up.sql). Stub/test secrets only in `.env.local` (gitignored).
