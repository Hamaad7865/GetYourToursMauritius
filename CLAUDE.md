# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

**[`docs/HANDBOOK.md`](docs/HANDBOOK.md) is the canonical guide** — architecture, deploy, the owner's
runbook. Before changing code, read [`docs/handbook/architecture.md`](docs/handbook/architecture.md),
[`docs/handbook/development.md`](docs/handbook/development.md), and
**[`docs/handbook/landmines.md`](docs/handbook/landmines.md)** (accumulated scar tissue — non-obvious
invariants that have caused real incidents). Fixing a bug rather than building? Go to
[`docs/handbook/debugging.md`](docs/handbook/debugging.md). This file is only a pointer + the rules you
break on day one.

## What this is

Belle Mare Tours — a production tour-booking platform for Mauritius: SEO catalogue, online booking +
Peach card payments, an AI booking assistant, and an owner `/admin` back-office. **API-first**: every
`/api/v1` route authenticates a Supabase JWT from the `Authorization: Bearer` header (no cookie
reliance) so the same backend can serve a future mobile app unchanged.

Three moving parts, all shipped by a single `git push origin main` (`.github/workflows/release.yml`, in
order, with post-deploy verification): **the web app** (Cloudflare Pages via `@cloudflare/next-on-pages`,
edge runtime), **the database** (`supabase db push`), **the cron Worker** (`workers/cron/`, a _separate_
Worker). Cloudflare's own Git auto-deploy is disabled — the pipeline is the only deploy path. Direct
commits to `main`, no feature branches (owner's explicit preference).

## Commands

```bash
npm run dev                     # http://localhost:3000  (Windows: npx next dev --turbopack if it misbehaves)
npm run hooks:install           # once per clone — pre-commit hook that rejects unformatted staged files
npx vitest run path/to.test.ts  # a single test file
npx vitest run -t "name"        # a single test by name
npm run test:e2e                # Playwright (needs a running server)
npm run gen:types               # NOTE: does NOT work — src/lib/supabase/types.ts is hand-edited
```

**The gate — run all of it before every push** (CI runs these six and _fails fast_, so one missed
`format:check` hides the five checks after it, including the only one that proves the Cloudflare bundle
builds):

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build
```

`npm run pages:build` (the real Cloudflare artifact) **fails on Windows** with `spawn npx ENOENT` — an
upstream bug, unrelated to our code. A green `next build` does _not_ prove the edge bundle builds; **CI
is the only trustworthy build gate.** Never call a change done until the GitHub Actions `verify` job's
final _Edge bundle_ step is green.

## Architecture — the load-bearing facts

**The service/framework split is ESLint-enforced, not convention.** Nothing under
`src/lib/services/**` may import `next`, `react`, `@/lib/http/*`, or `@/lib/supabase/admin`. Services
get their DB client via a `ServiceContext` argument. Route handlers (`app/api/v1/**/route.ts`, each
declaring `export const runtime = 'edge'`) are thin adapters: authenticate → rate-limit → call a service
→ return JSON. `src/lib/http/` is the only bridge between Next and services.

**Business logic lives in Postgres, not TypeScript.** Pricing, capacity, holds, booking creation,
payment settlement, and notification queueing are plpgsql functions (`api_book`, `create_booking`,
`create_hold`, `append_payment_event`, …). The TS service layer mostly marshals a single `jsonb` param
in and the result out, through one port: `rpc(fn, params)` in `src/lib/db/rpc.ts`. **To change how
something is priced or booked, you write SQL.** `src/lib/services/pricing.ts` is a _cosmetic display
mirror_ so the widget shows a number before commit — the server figure always wins.

**The money path invariants** (full sequence in `architecture.md §3`):

- **Zero-trust pricing.** No price ever crosses the wire. The browser sends _what_ is booked
  (`occurrenceId`, party, pickup), never _how much_. `create_booking` computes every amount from DB
  tables. `Checkout.tsx`'s `reconcileOrWarn` blocks on a ≥ €0.005 mismatch.
- **One settlement door.** `append_payment_event` is the _only_ writer of `status='confirmed'` — never
  `UPDATE bookings SET status=...` by hand. It dedups replayed webhooks, refuses underpayments,
  re-checks capacity, routes oversell to `refund_pending`.
- **The webhook body is never trusted** — settlement re-queries Peach using the checkout id we stored
  at create time.
- `bookings.total_minor` ≠ `Σ booking_items.subtotal_minor` — transport add-on, child-seat cost, and
  supplements are folded in without their own line rows. Anything explaining a charge (admin drawer,
  invoice PDF, confirmation screen) must add those lines back; the three surfaces should agree.

**Availability vs holds — constantly confused.** Seat holds free themselves: capacity is a predicate
(`used_capacity()` counts only `status='active' AND expires_at > now()`), so a lapsed 30-min hold frees
the seat with no job. But **availability does not create itself** — day-slots exist only because the
`*/5` maintenance cron calls `materialize_availability` (185 days forward). A dead cron doesn't break
the site; the calendar silently empties from the far end over months. Treat a stalled cron as P0.

**Identity/domain.** `src/lib/seo/site.ts` `SITE` is the one identity object. `NEXT_PUBLIC_SITE_URL` is
the _only_ place the domain exists (canonicals, OG, robots, sitemap, JSON-LD, Peach return URL). Mail is
_sent_ as `bookings@` (`RESEND_FROM`), _replies_ route to `info@` (`SITE.email`) — don't collapse them.

**Roles / RLS.** `customer` (own bookings) · `staff`/`admin` (all `/admin`) · `seo` (content only — for
a GDPR-safe external contractor). The real boundary is RLS (`is_staff()`, `is_content_editor()`), not
the sidebar. Never add an `seo` grant to any booking / payment / lead / profile / pricing table.

## "If you change X, you must also do Y" (full table: `architecture.md §6`)

| Change                                                                  | Also do                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A file in `supabase/migrations/`                                        | Mirror it to the **end** of `supabase/catch-up.sql`; run `npm run seed:gen && npm run setup:sql`; owner runs the SQL on prod before code ships. Read `docs/handbook/database.md` first — re-defining a function is the most dangerous edit here (find the _winning_, last-in-filename-order body). |
| A Zod schema in `src/lib/validation/`                                   | `npm run openapi:write` (a test compares `openapi.json` byte-for-byte)                                                                                                                                                                                                                             |
| Add an `api_*` RPC                                                      | Add its name to `ALLOWED` in `tests/db/rpc.ts`                                                                                                                                                                                                                                                     |
| Add a table / column / enum value                                       | Hand-edit `src/lib/supabase/types.ts` (not generated, despite `gen:types`)                                                                                                                                                                                                                         |
| Add an API route                                                        | `export const runtime = 'edge'` at the top                                                                                                                                                                                                                                                         |
| A charge `api_book` adds to `total_minor` without a `booking_items` row | Update `bookingExtraCharges()` **and** `buildInvoice()` **and** `BookingConfirmation.tsx`                                                                                                                                                                                                          |
| Anything under `workers/cron/`                                          | `git push` ships it post-bootstrap; pre-bootstrap run `wrangler deploy` by hand                                                                                                                                                                                                                    |
| The domain                                                              | `NEXT_PUBLIC_SITE_URL` **and** `SITE_URL` in `workers/cron/wrangler.toml` **and** `PEACH_WEBHOOK_URL` **and** re-verify the Resend domain                                                                                                                                                          |
| An English UI string passed to `t(...)`                                 | Update the matching key in `src/lib/i18n/messages.ts` in the same commit (lookup is an _exact_ string match incl. curly `’` and `—`; a near-miss silently falls back to English). Run `node scripts/i18n-scan.mjs`.                                                                                |
| `activities.extra` gets a new key                                       | Touch `activityExtraSchema` (`validation/tours.ts`), `buildExtra()` + `loadActivity()` (`admin/activity-write.ts`), the owning pane under `src/components/admin/activity/`, and `MANAGED_EXTRA_KEYS`                                                                                               |
| Photography                                                             | A package is a normal activity whose category is exactly `Photography` (`src/lib/catalogue/photography.ts`). No separate booking/payment code — don't add one. Tours list offered packages in `extra.photographyAddOns`. Page photos live in `photography_photos` (slots in `PHOTO_SLOTS`).        |

## Local env

The app boots with no Supabase credentials — it serves an in-memory seed fixture, so "the site loads"
is _not_ evidence your config is right. In `next dev`, payments and email always use stubs (even with
real credentials) because `NODE_ENV=development` exempts the prod fail-closed gate. `.npmrc` forces
`legacy-peer-deps` (next-on-pages peer range) — do not delete it. `wrangler pages dev` reads
`.dev.vars`, not `.env.local`.

Integration tests run against **real Postgres via PGlite** (in-process): `createTestDb()` applies every
migration in filename order, so RLS/plpgsql/constraints behave as in prod. One limitation — a single
connection, so it proves logic but not race conditions (those are prevented by `SELECT FOR UPDATE` +
unique constraints in SQL).

## Diagnostics

```bash
curl -s "https://bellemaretours.com/api/v1/health?deep=true"
```

`200 "status":"ok"` = config sane. `503 "status":"degraded"` names the failing check and reports
`releaseSha`. Then, in the Supabase SQL editor: `select * from error_logs order by created_at desc;`
(every server/render/cron crash of the last 30 days; 4xx deliberately excluded).
