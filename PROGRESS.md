# GetYourToursMauritius — Progress & Handoff

> Session handoff doc. Read this first after a compaction. Production tours-booking
> platform for **Belle Mare Tours** (east-coast Mauritius). API-first, edge-deployed
> on Cloudflare Pages. Visual target: a **GetYourGuide clone recoloured to our brand**
> (teal primary, coral urgency, ink "top rated", **white** background, Plus Jakarta Sans).
>
> Repo: GitHub `Hamaad7865/GetYourToursMauritius` (**private**). Branch `main`.
> **Supabase is LIVE.** Full gate green: typecheck + lint + **112 tests** + build.

---

## 1. Stack & environment

- **Next.js 15.5.19** App Router, TypeScript strict, **every route `runtime='edge'`**, Tailwind 3.4.
- **Supabase** (live, see §2) reached two ways:
  - **Server `/api/v1`** via `api_*` Postgres RPCs with a Bearer JWT (verified at the edge).
  - **Browser client** (`src/lib/supabase/browser.ts`, persisted session) for web auth + admin writes, under RLS.
- **PGlite** (real Postgres WASM) for tests — no Docker/Supabase CLI. Migrations in `supabase/migrations/**` are applied in order by the harness (`tests/db/pglite.ts`).
- Payments behind a `PaymentProvider` interface: **StubPaymentProvider** (active, no Peach keys) + `PeachPaymentProvider` (placeholder, throws NotImplemented).

### Environment constraints (this Windows machine)
- Use **npm**, not pnpm.
- `npm run pages:build` FAILS on Windows (next-on-pages CLI bug). `next build` proves edge-compat; run `pages:build` under WSL/CI.
- **Build clobbers the dev server's `.next`** → always: stop preview → `rm -rf .next` → `npm run build` → `rm -rf .next` → restart preview. Building while the dev server runs causes "Failed to collect page data" errors (corrupted `.next`, not a code bug).
- Node 24, npm 11, Bash tool = Git Bash. Preview screenshots are flaky after many HMR cycles — a clean restart fixes it.

### Green gate (after every change)
`npm run typecheck && npm run lint && npm run test && npm run build` — currently **112 tests, all green**.

---

## 2. Live Supabase (wired)

- **Project ref:** `dwjkfowhrrvdiqligxcj`. `.env.local` (gitignored) has:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_URL`, `NEXT_PUBLIC_SITE_URL`, **`SUPABASE_JWT_SECRET`** (legacy HS256 secret).
- **JWT signing is ES256 (asymmetric)** — JWKS at `/auth/v1/.well-known/jwks.json`. The legacy HS256 key is the *previous* key (revoke once old tokens expire). Edge verify (`src/lib/http/auth.ts`) supports **both**: ES256→JWKS, HS256→shared secret.
- **The auto-mode classifier BLOCKS the assistant from live-DB writes** (applying migrations, creating auth users, deleting rows). Workarounds: North Tour photos as a `public/` overlay; the user runs `admin-setup.sql` themselves.
- Secrets were pasted in chat (legacy JWT secret, an old DB password, service_role) — **rotate them**.

---

## 3. Phase status

| Phase | What | Status |
|---|---|---|
| 0 | Scaffold + seams + green gate | ✅ |
| 1 | 19-table schema + RLS (deny-by-default) + atomic plpgsql RPCs (`create_hold`, `create_booking`, `append_payment_event`, `expire_holds`) + hand-authored `supabase/types.ts` + bilingual `seed/catalogue.json` (23 activities) | ✅ |
| 2 | Service layer (DB access only via `api_*` RPCs; `DbRpc` port = `supabaseRpc` prod + `pgliteRpc` tests) + `/api/v1` + OpenAPI | ✅ |
| 3 | Public catalogue: home, browse, **activity detail**, SEO/JSON-LD, sitemap | ✅ |
| — | **GYG redesign**: home (transparent header over hero + scroll-collapse), detail clone, white bg | ✅ |
| 4a | **Auth**: email + Google + Apple + Facebook; retained session; profile; bookings history | ✅ |
| — | **JWKS edge verify** (ES256) + HS256 fallback | ✅ |
| 6 (slice) | **Admin panel**: Activities CRUD + availability | ✅ |
| 4b | **Booking**: bookable activities, payment webhook, confirmation, 3-step checkout | ✅ |
| 5 | AI assistant | ⏳ not started |
| 6 (rest) | Admin dashboard / bookings table / leads | ⏳ |
| 7 | Final pass (a11y, deploy, README) | ⏳ |

---

## 4. What this session built (recent → oldest)

### Cards & photos
- **`PlaceCard`** — static card, **image-only hover zoom**, CSS photo carousel, stretched `<Link>`. Replaced `GygCard` (deleted). framer-motion removed.
- **North Tour real photos**: 5 in `public/activities/north-tour/`, overlaid via `src/lib/catalogue/local-photos.ts` (`withLocalPhotos`) on home/browse/detail — no Storage upload / DB write. Source folder `Activity Pictures/` is gitignored.
- `images: TourImage[]` on `TourSummary`; `api_search_activities` returns it (migration `20260615121500_search_images.sql`).

### Navbar / header (exactly GetYourGuide)
- `GygHeader` navbar = **Wishlist · Cart · EN/EUR € · Profile** (dropped standalone Bookings + Sign in/up buttons).
- **Profile dropdown**: signed-out → "Log in or sign up"; signed-in → My profile / **My bookings** / Log out. **Bookings only shown when signed in.**
- **Language/Currency modal** via `PreferencesProvider` — **English + Français**, EUR; persisted; navbar shows "EN/EUR €" ↔ "FR/EUR €". (Selector + persistence only; full content translation = later i18n pass.)
- Browse page uses `GygHeader` too.

### Search bar
- Shared **`SearchBar`** in the hero AND docked in the navbar on scroll. Query + two-month date calendar (Today/Tomorrow/Next weekend chips) + **Adults/Children** travellers → `/activities?q&date&adults&children`. Responsive + a11y.

### Auth (4a) — `src/components/auth/**`
- `AuthProvider`/`useAuth` (persisted session, profile upsert on first sign-in), `AuthDialog` (email + Google/Apple/Facebook, focus-restore + scroll-lock), `/auth/callback`.
- `/account` (editable profile) + `/account/bookings` (history) — read directly under RLS.

### Admin (Phase 6 Activities-CRUD slice) — `app/admin/**`, `src/components/admin/**`
- `AdminGuard` (role staff/admin). `/admin/activities` list (New/Edit/**Availability**/Delete).
- **`ActivityForm`** captures every North-Tour field: basics, slug, category (enum), type, status, location, duration, summary/description, meeting point, cancellation, pickup, highlights/inclusions/exclusions/languages, **photos (Storage upload AND URL paste)**, options + price tiers, itinerary (→ `extra` jsonb).
- **Writes go DIRECT via the authed admin client** — staff RLS grants full write on activities/images/options/prices, so **no admin RPC/migration**. (`src/lib/admin/activity-write.ts`.)
- **Availability** (`AvailabilityEditor` + `availability-write.ts`): a **daily capacity + "Make bookable" / "Stop"** — no date/time/repeat. Materialises a daily slot (**noon UTC** — timezone-stable) per option across a rolling year (idempotent upsert, updates capacity). "Stop" deletes upcoming slots **except** days with bookings/active holds.

### Booking + payment (4b)
- **`BookingWidget`** (GYG look): **Participants** stepper + custom **Date calendar** (greys past/today + full days) + custom **Language** dropdown (English/French). Cheapest tier/option. **"Book now"** (always shown) → `/checkout` with the selection in query params.
- **`/checkout` — 3 steps** (`src/components/checkout/Checkout.tsx`): (1) **Transport** (pickup radio + hold-spot countdown + spinner on Continue); (2) **Contact** (sign in / create account if needed; auto-advances on session); (3) **Payment** (booking with idempotency key + payment → redirect to `/bookings/[ref]`).
- **`POST /api/v1/webhooks/payments`** — the ONLY confirm path: verifies the event, appends via `append_payment_event` (service-role), idempotent. **Unauthenticated in stub mode by design** (real Peach signature closes it — don't deploy stub publicly).
- **`/bookings/[ref]`** (`BookingConfirmation`): shows the booking; stub return offers **"Complete payment (test)"** → webhook → confirmed → appears in My bookings.
- Money-path RPCs (`api_book`, `api_create_payment`, `append_payment_event`, stub) built in Phase 1–2. **Peach stubbed** (no keys).

### Tests added
- `tests/integration/admin-catalogue.test.ts` (admin write → public read, drafts hidden, edits reflected).
- `tests/integration/booking-flow.test.ts` (availability → book → pay → webhook → confirmed; seats drop; overbooking rejected; idempotent).
- `tests/unit/auth-jwt.test.ts` (ES256/JWKS).

### Adversarial reviews (multi-agent workflows)
- Phase 4a auth → 11 fixed. Search bar → 13 fixed. Booking/checkout/admin → **8 fixed** (idempotent retries, noon-UTC timezone, `stopAvailability` busy-skip, atomic activity update, session-race, friendly capacity error). 3 noted (see §6).

---

## 5. ⚠️ Setup the USER must run (classifier blocks the assistant)

Run **`supabase/admin-setup.sql`** ONCE on the live DB (Supabase SQL editor, or `npx tsx scripts/db-exec.ts supabase/admin-setup.sql`). It:
1. **Deletes all activities except `north-tour`** (permanent — user's choice).
2. **Makes an account admin** — `update profiles set role='admin'` for `boodoo.sheik786@gmail.com` (must have **signed up in the app first**).
3. Creates the public **`activity-images` Storage bucket** + staff-write/public-read policies (admin photo uploads).
> Do **not** run `npm run db:setup` afterward — it re-seeds the 23 demo activities.

### Make North Tour bookable live
`/admin/activities` → **Availability** on North Tour → set capacity → **Make bookable**. Then on the site: pick a date → **Book now** → checkout → sign in → pay → **Complete payment (test)** → confirmed under My bookings.

---

## 6. Open items / decisions pending

- **Google Maps**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is wired; user is getting a key (enable Maps JS API + Places, create + restrict by HTTP referrer, add to `.env.local` + Cloudflare env). Then wire the **pickup map in checkout** and/or swap the **itinerary map** (currently Leaflet/OSM) to Google.
- **Peach payments**: stubbed until keys (`PEACH_ENTITY_ID/ACCESS_TOKEN/WEBHOOK_SECRET`). Implement `src/lib/payments/peach.ts`.
- **Known follow-up bugs (not fixed):**
  1. **Occurrence↔activity binding** — a hand-edited `/checkout?occ=` could book a different activity's slot than the title shown (self-inflicted; DB charges the real price). Proper fix = add a slug check to `api_book` (a migration the user applies).
  2. Availability window goes stale if the page is open past midnight (cosmetic; reload fixes).
  3. `openAvailability` sends ~365×options rows in one upsert (fine normally; could time out with many options).
- **Full French translation** of UI + content (FR data exists in `activity_translations`; selector/locale persist, content not switched yet).
- **"Additional works"** the user mentioned before the next phase — ask them.
- Pending task: GYG-ify the old listing-page styling further if wanted.

---

## 7. Key files

- Detail: `app/activities/[slug]/page.tsx` · widget `src/components/gyg/detail/BookingWidget.tsx`
- Checkout: `app/checkout/page.tsx` · `src/components/checkout/Checkout.tsx`
- Webhook: `app/api/v1/webhooks/payments/route.ts` · Confirmation: `src/components/gyg/detail/BookingConfirmation.tsx`
- Admin: `app/admin/**`, `src/components/admin/**`, `src/lib/admin/{activity-write,availability-write}.ts`
- Auth: `src/components/auth/**`, edge verify `src/lib/http/auth.ts`, browser client `src/lib/supabase/browser.ts`
- Prefs/search/header: `src/components/site/{PreferencesProvider,LangCurrencyModal}.tsx`, `src/components/gyg/{GygHeader,SearchBar,PlaceCard}.tsx`
- Catalogue overlay: `src/lib/catalogue/local-photos.ts`
- Migrations: `supabase/migrations/**` · One-time setup: `supabase/admin-setup.sql`
- Memory (persists across sessions): `~/.claude/projects/.../memory/` — `gytm-build-decisions.md`, `gytm-gyg-redesign.md`.

**All work committed on `main`** (and pushed to the private GitHub repo per the prior handoff). Stub/test secrets only in `.env.local` (gitignored).
