# GetYourToursMauritius — Build Progress / Session Handoff

Status snapshot for resuming after a context compaction. **Phases 0–2 complete & reviewed; Phase 3a complete & reviewed.** Everything below is committed on branch `main`. Full gate is green: `npm run typecheck && npm run lint && npm run test && npm run build` (**81 tests**).

## What this is

Production tours-booking platform for **Belle Mare Tours** (east-coast Mauritius), brand **GetYourToursMauritius**. API-first (a future mobile app reuses the backend unchanged). 8 phases (0–7); we verify (typecheck+lint+build+test) and usually run an adversarial bug-review after each phase, fixing before advancing.

## Environment constraints (important)

- **Use `npm`** (not pnpm — corepack EPERM on this Windows box). Node 24, npm 11. The Bash tool is **Git Bash**.
- **No Docker / Supabase CLI** → DB is tested with **PGlite** (real Postgres in WASM, in-process). `supabase/types.ts` is **hand-authored** (regenerate with `supabase gen types` once a real project exists).
- **`npm run pages:build` fails on Windows** (`spawn npx ENOENT` in next-on-pages) — edge-safety is otherwise proven; run under WSL/CI.
- `.npmrc` has `legacy-peer-deps=true` (next-on-pages caps peer at next ≤15.5.2; we stay on patched 15.5.19).
- **No real Supabase project yet.** Pages/services are wired but can't fetch real data locally; tests use the PGlite shim.

## Stack

Next.js 15.5.19 (App Router, TS strict, all server code `runtime='edge'`) · Tailwind 3.4 (brand tokens as **RGB channels** in `app/globals.css` → `tailwind.config.ts`) · Supabase (Postgres + RLS) accessed **only via `api_*` RPCs** · Peach Payments (stubbed) · Vercel AI SDK (stub; `AI_PROVIDER` env) · Zod everywhere · `jose` (JWT HS256) · `zod-openapi` · `@cloudflare/next-on-pages` (**deprecated — consider OpenNext in Phase 7**) · Vitest + PGlite + `@electric-sql/pglite`.

## Locked architecture decisions (do NOT re-litigate)

- **Framework-agnostic service layer** (`src/lib/services/**`, zero Next imports, ESLint-enforced). `ServiceContext.db` is a narrow **`DbRpc` port**; two adapters run the SAME SQL: `supabaseRpc` (prod) + `pgliteRpc` (tests) → zero mock divergence.
- **Concurrency-safe booking core**: `session_occurrences` (concrete inventory) + `booking_holds` (15-min expiry, idempotency_key). `available = capacity − Σ confirmed booking_items − Σ active non-expired holds`. **Never decrement.** Atomic via `plpgsql` RPCs with `SELECT … FOR UPDATE` (PostgREST can't do app-level txns). On payment, **re-checks capacity under lock**; if the seat was resold (hold expired), routes to `refund_pending` instead of overselling.
- **Event-sourced payment ledger**: `payment_events` is append-only and the source of truth; `payments`/`bookings` carry a cached projection. Confirmation comes **only** from the verified webhook (Phase 4), never a success page. Prices come from the **DB only**. Client-supplied idempotency key + server fallback.
- **Multi-operator data model, single-brand storefront** (Belle Mare Tours), staff-managed (no third-party operator logins yet). **Commission deferred** (`agency_commission_minor=0`, `operator_payout_minor=total`).
- **Options/pricing**: `activity → activity_options` (variants) → `activity_option_prices` (Adult/Child/etc. tiers). `booking_items` ref occurrence+tier+qty.
- **Bilingual**: `activity_translations` (EN primary in `activities` + FR rows).
- **RLS deny-by-default on every table**; `payment_events`/`audit_logs` insert-only; a `profiles` role-guard trigger blocks privilege escalation; bookings/payments created only via SECURITY DEFINER RPCs.
- Money columns are **bigint** (minor units / cents).

## Schema (19 tables) — `supabase/migrations/`

operators, profiles, activities, activity_translations, activity_images, activity_options, activity_option_prices, session_occurrences, booking_holds, bookings, booking_items, payments, payment_events, notification_outbox, audit_logs, leads, reviews, chat_sessions, chat_messages.

**Core RPCs**: `create_hold`, `create_booking`, `append_payment_event`, `expire_holds`, `release_hold`, `used_capacity`, `is_staff`.
**Service-facing `api_*`** (single jsonb arg, return jsonb): `api_search_activities`, `api_get_activity`, `api_list_availability` (INVOKER/RLS), `api_book`, `api_create_payment`, `api_get_booking`, `api_capture_lead`, `booking_json`.

## REST — `/api/v1` (`app/api/v1/**`)

`GET /activities`, `GET /activities/{slug}`, `GET /activities/{slug}/availability` (public); `POST /bookings` (guest ok); `POST /payments` (auth required); `GET /bookings/{ref}` (auth); `POST /leads`; `GET /openapi`. JWT validated-if-present for reads. Consistent envelope (`{ok,data,meta}` / `{ok:false,error}`), scoped CORS, `openapi.json` emitted.

## Done per phase

- **Phase 0** — scaffold: tooling, brand tokens, service-layer seams, test harness.
- **Phase 1** — data model: 19 tables + RLS + atomic RPCs + bilingual seed (`seed/catalogue.json`, 23 activities from visitemaurice.com EN/FR; `npm run seed:gen` → `supabase/seed.sql`) + hand-authored types. Reviewed: 16 bugs found, 14 fixed.
- **Phase 2** — service layer + `/api/v1` + OpenAPI. Reviewed: 5 bugs; fixed guest-payment authz hole (+ a SQL `null=null` NULL gotcha) and db-error mapping.
- **Phase 3a** — public **home page** (edge SSR) + component library (`src/components/{site,marketing,catalogue,ui,seo}`) + SEO (TravelAgency + Product JSON-LD, `serializeJsonLd` is XSS-safe) + `app/sitemap.ts` + `app/robots.ts` + Cache-Control headers. Reviewed: fixed JSON-LD stored-XSS.

## Key commits (newest first)

`ef6b403` 3a review (JSON-LD XSS) · `1f8579b` 3a home+SEO · `d2c9e80` P2 review fixes · `bbd1eda` P2 service+api · `7633f77` P1 review fixes (14) · `a340ed7` P1 seed+types · `265cc42` P1 harden · `a050b2f` P1 core · `3a33de0` P0 scaffold.

## Known issues / deferred (honest)

- **Concurrency NOT truly tested** (PGlite single-connection) — locks verified by logic, not racing transactions. **`supabaseRpc` transport untested** vs real PostgREST (e.g. whether a `RAISE` message reaches `mapDbError` intact). `auth.uid()`/roles are a PGlite **emulation**. `pg_cron` (hold expiry, outbox) and an edge e2e never run. → all need a real Supabase project + `wrangler pages dev`.
- Idempotency race → **409, not atomic-return** (correct on retry).
- Guest booking unreadable by its creator until Phase 4 (secure-token guest checkout).
- ZodError on rpc-output drift → 500 (low). FK hard-delete semantics → soft-delete in admin phase. `create_hold` stale-replay (guarded downstream). Reviews unmoderated.
- `/activities`, `/account` links **404 until Phase 3b/4**. CDN cache safe **only while the header is anonymous** (Phase 4 personalization must be client-side). next-on-pages header emission unverified until deploy.

## What's next

- **Phase 3b** — activity/transport **detail page** (gallery, highlights, included/excluded, meeting point, itinerary, reviews, FAQ, "you might also like", **sticky booking panel**) + **browse/filter** page (`/activities`). Build against the design at `design-reference/BelleMareTours-handoff.zip` → `Activity Detail.dc.html` (extract to `.design-tmp/`, gitignored).
- **Phase 4** — auth (email + Google) + account area + booking flow UI + Peach hosted checkout + verified webhook (`/api/v1/webhooks/peach` → `append_payment_event`) + confirmation/voucher + reconciliation job.
- **Phase 5** — AI assistant (widget + `/api/chat` agent loop + DB-backed tools).
- **Phase 6** — admin panel `/admin` (design: `Back Office.dc.html`).
- **Phase 7** — a11y, full test run, SEO check, deploy config + README, env wiring.

## Pointers

- Plan: `~/.claude/plans/content-import-seed-data-reactive-dragonfly.md`. Memory: `~/.claude/projects/C--Projects-GetYourToursMauritius/memory/` (`gytm-build-decisions.md`).
- Test DB harness: `tests/db/{pglite.ts,auth-shim.sql,seed.ts,rpc.ts,route-context.ts}`.
- Scripts: `npm run seed:gen`, `import:catalogue`, `openapi:write`, `gen:types`.
