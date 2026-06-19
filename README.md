# GetYourToursMauritius

Production tours-booking platform for **Belle Mare Tours** (east-coast Mauritius): a server-rendered SEO catalogue, online booking + payments, an AI booking assistant, and an owner admin panel. **API-first** — the same token-authenticated backend is built to be reused by a future mobile app with no backend/DB changes.

> **Status: Phases 0–1 complete.** Phase 0 = the edge-safe, API-first walking skeleton. Phase 1 = the modular-monolith data model: 19 tables with RLS on every one, atomic booking-core RPCs (holds + computed capacity + event-sourced payment ledger), the bilingual catalogue seed, and generated DB types — all verified against real Postgres (PGlite) with 48 tests. Public catalogue, booking/payments, AI assistant and admin land in later phases. See [the build plan](#build-phases).
>
> Without Docker/Supabase CLI locally, schema/RLS/RPCs are tested via **PGlite** (real Postgres in-process). Migrations live in `supabase/migrations/`; the seed is `seed/catalogue.json` → `npm run seed:gen` → `supabase/seed.sql`.

## Stack

| Concern               | Choice                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Framework             | Next.js 15 (App Router, TypeScript strict)                                                 |
| Styling               | Tailwind CSS, brand tokens from the Claude Design export                                   |
| Deploy target         | Cloudflare Pages via `@cloudflare/next-on-pages` (edge/Workers runtime)                    |
| Data / Auth / Storage | Supabase (Postgres + RLS, email + Google auth, Storage) via the JS client (HTTP/PostgREST) |
| Payments              | Peach Payments (hosted checkout + verified webhook) — behind a stubbable interface         |
| AI                    | Vercel AI SDK (`ai`), provider via `AI_PROVIDER` env (default: Google Gemini Flash)        |
| Validation            | Zod at every boundary                                                                      |
| Tests                 | Vitest (unit + integration), Playwright (e2e)                                              |

## Architecture

The cardinal rule: the service layer (`src/lib/services`) is **framework-agnostic** (zero Next.js imports, enforced by ESLint) so the backend can be lifted into a mobile/Node context unchanged. Route handlers and server components are thin adapters that call the service layer.

```
app/                         # Next.js App Router — the only Next-coupled layer
  api/v1/.../route.ts         #   versioned REST endpoints (all runtime = 'edge')
src/lib/
  services/                   # business logic: pricing, tours, bookings, availability, …
  supabase/                   # createUserClient(jwt) (RLS as caller) + admin (service-role)
  payments/                   # PaymentProvider interface + Peach impl + deterministic stub
  ai/                         # AiProvider interface + Google + stub (provider via env)
  validation/                 # Zod schemas — single source of truth for I/O shapes
  http/                       # the only bridge Next <-> services (auth, envelope, CORS, …)
  config/env.ts               # Zod-validated server env
  openapi/                    # OpenAPI 3.1 document generated from the Zod schemas
src/types/domain.ts          # public types inferred from the schemas
tests/{unit,integration,e2e,fixtures,setup}/
```

Every `/api/v1` endpoint validates a Supabase JWT from the `Authorization: Bearer` header (no cookie reliance), so the same token works for web and mobile.

## Local setup

Requirements: **Node 20+** (Node 24 works) and npm.

```bash
npm install
cp .env.example .env.local      # fill in values (placeholders are fine for Phase 0 tooling)
npm run dev                     # http://localhost:3000
```

`next dev` reads `.env.local`. The local edge runtime (`wrangler pages dev`) reads `.dev.vars` — copy `.dev.vars.example` and mirror the server-only secrets there.

### Environment variables

See [`.env.example`](.env.example) for the full list with descriptions. Summary:

- **Public** (browser-safe): `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Server-only**: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `AI_PROVIDER` + the selected provider's key (`GOOGLE_GENERATIVE_AI_API_KEY` by default), and the Peach Checkout set (`PEACH_CLIENT_ID`, `PEACH_CLIENT_SECRET`, `PEACH_MERCHANT_ID`, `PEACH_ENTITY_ID`, `PEACH_WEBHOOK_SECRET`, `PEACH_AUTH_BASE_URL`, `PEACH_CHECKOUT_BASE_URL`, `PEACH_WEBHOOK_URL`, `PEACH_ENVIRONMENT`)

No real accounts are required to build or test: external services sit behind interfaces with deterministic stubs.

## Commands

| Command                           | What it does                                               |
| --------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                     | Dev server                                                 |
| `npm run build`                   | Production build (typechecks all routes as edge functions) |
| `npm run typecheck`               | `tsc --noEmit` (strict)                                    |
| `npm run lint`                    | ESLint (incl. service-layer boundary rules)                |
| `npm run format` / `format:check` | Prettier                                                   |
| `npm run test`                    | Vitest unit + integration                                  |
| `npm run test:e2e`                | Playwright (needs a running server)                        |
| `npm run pages:build`             | `next-on-pages` edge build (see note below)                |
| `npm run pages:dev`               | Local Cloudflare edge runtime                              |
| `npm run openapi:write`           | Emit a static `openapi.json`                               |

**Per-phase gate:** `npm run typecheck && npm run lint && npm run build && npm run test` must be green before advancing.

## Known issues / decisions to confirm

- **`pages:build` on Windows fails** with `spawn npx ENOENT` — a documented bug in the `@cloudflare/next-on-pages` CLI on Windows (it spawns `npx vercel build` without a shell). It is unrelated to our code: `next build` already compiles every route as an edge function, no app code uses Node-only APIs, and an automated test asserts each route exports `runtime = 'edge'`. **Workaround:** run `pages:build` under WSL or in CI (Linux).
- **`@cloudflare/next-on-pages` is deprecated** in favour of the OpenNext Cloudflare adapter (`@opennextjs/cloudflare`). The build currently uses `next-on-pages` as specified; switching to OpenNext is a recommended decision for Phase 7 / deploy.

## Build phases

0. **Scaffold** ✅ — tooling, brand tokens, service-layer seams, one real API endpoint, tests.
1. **Data model** ✅ — 19-table modular-monolith schema, RLS on every table, atomic booking-core RPCs (holds + computed capacity + event-sourced payment ledger), generated DB types, bilingual catalogue seed; 48 DB-backed tests.
2. Service layer + `/api/v1` + OpenAPI + tests.
3. Public catalogue + activity/transport detail pages + SEO/JSON-LD + sitemap + edge caching.
4. Auth + booking flow + Peach checkout + verified webhook.
5. AI assistant (widget + agent loop + DB-backed tools).
6. Admin panel.
7. Final pass: accessibility, full test run, SEO check, deploy config + full README.
