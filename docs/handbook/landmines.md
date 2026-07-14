# Landmines

[← Handbook](../HANDBOOK.md)

Non-obvious invariants that a competent developer will violate on day one. Several of these have already
caused real incidents in this codebase. Read the whole page once; come back to the relevant section
before you touch that area.

---

## Money

### Never let a price cross the wire

**Trap:** "Just pass the total we already displayed."

Today **no price ever leaves the browser**. `api_book` takes `occurrenceId`, `party`, pickup facts — and
nothing else. `create_booking` computes `total_minor` from database tables.

Add an `amount` field to that payload and a crafted request books a €500 tour for €1.

If the UI needs a number, mirror the maths in `src/lib/services/pricing.ts` for **display only** — and
leave `reconcileOrWarn` in `Checkout.tsx`, which re-checks the server's figure before charging and blocks
on a mismatch.

### Never confirm a booking outside `append_payment_event`

**Trap:** a success redirect, a client callback, or `UPDATE bookings SET status='confirmed'` to fix one
stuck booking by hand.

`append_payment_event` is what dedups provider events, **refuses underpayments** (paid < amount stays
pending), re-checks capacity, and routes an oversell to `refund_pending`. Bypass it and you've bypassed
all four — and you also have to consume the hold yourself, which you will forget.

### Never trust the webhook body

Peach's notification echoes amounts, ids and result codes. It is tempting to read them and confirm.

Anyone can POST to `/api/v1/webhooks/payments`. Only two paths are allowed: an **HMAC-verified** body, or
**re-querying Peach with the checkout id we stored ourselves**. The id in the incoming body is
deliberately never used for the status query.

Related: don't "fix" the webhook to return a non-200 on failure so Peach retries. It is deliberately
ACK-first. Durability comes from the customer's sync poll and the reconcile cron, not from provider
retries.

### Don't credit the expected total instead of what actually settled

`reconcile.ts` credits `event.amountMinor` — the amount the provider _actually_ took. Swap that for the
booking's expected total and the underpayment guard becomes meaningless: a partial capture would confirm
as fully paid. (The card is charged in EUR — the same currency as the ledger — precisely so these two
numbers are comparable.)

### Don't remove the double-charge guard

`api_create_payment` returns an existing checkout if one was created for this booking less than 25
minutes ago, and `createPaymentLink` reuses it. Remove that and a customer who hits Back or reloads gets
a **second live checkout** for the same booking — and can be charged twice.

### Don't reorder the maintenance steps

`/api/v1/internal/maintenance` runs: **payment-reconcile → expire bookings → materialize availability.**
That order is load-bearing. Flip the first two, and a customer who paid at minute 29 of a 30-minute grace
window gets auto-cancelled _before_ the sweep sees their payment. You'd be refunding valid bookings.
There's a test guarding it.

---

## Email

### Don't collapse `bookings@` into `info@`

Mail is **sent** as `RESEND_FROM` = `bookings@bellemaretours.com` (a send-only identity) and **replies**
are routed to `SITE.email` = `info@bellemaretours.com` (the monitored human inbox) via `reply_to`.

Swap `RESEND_FROM` to `info@` "so replies work" and you mix transactional sending reputation into the
human inbox. Drop `reply_to` and every customer reply falls into a black hole.

### Don't put the owner's real email in the outbox

`notification_outbox.recipient` uses the literal string `'owner'` as a **sentinel**. It's resolved at
send time from `OWNER_NOTIFY_EMAIL` (falling back to `SITE.email`). That's deliberate: the owner's
personal contact details are never stored in the database, and there's exactly one place to rotate them.

---

## SQL

### The worst one: migration-revert drift

Migrations apply in **filename order**, and the last `create or replace function` wins.

A migration written later but _named_ earlier — or one branched from a stale copy of a function body —
**silently reverts** another migration's fix. Its diff looks innocent. The build stays green. **No test
catches it**, because the migrated database itself is now wrong.

This has happened at least twice. Once it removed a guard protecting customer PII.

**Before any `create or replace`:** `grep -ln "function <name>" supabase/migrations/*.sql` → the **last**
file printed is the winning body. Base your change on that, and diff it against the guards in every
earlier definition. Full procedure in [database.md](database.md#-the-worst-one-migration-revert-drift).

### `revoke … from anon, authenticated` does nothing on its own

Postgres implicitly grants `EXECUTE` to **PUBLIC** at create-function time, and `anon`/`authenticated`
are _members of PUBLIC_. So you must name PUBLIC:

```sql
revoke execute on function f(jsonb) from public, anon, authenticated;
```

The first security lockdown shipped this exact bug — the money RPCs stayed callable with the anon key.

Also: `create or replace` **preserves** grants, but `drop` + `create` **resets** them (and re-grants to
PUBLIC). So changing a function's signature silently re-opens it. Re-issue the revoke afterwards.

### A migration that isn't mirrored into `catch-up.sql` never reaches production

There is no migration runner in prod. `catch-up.sql` is what the owner actually runs. Forget to append
your change and the feature is green in CI and dead in production.

And the reverse: **SQL written only into `catch-up.sql` and not into a migration is completely
untested** — the test suite applies only `supabase/migrations/`. Migration first, always. `catch-up.sql`
is a mirror, never an origin.

### `bootstrap.sql` is 12 migrations stale — do not use it

It's missing the entire public-mutation security lockdown. A database built from it would let anyone with
the anon key call `create_booking`. Nothing guards this file. Use `setup.sql` (`npm run db:setup`).

### `admin-setup.sql` step 1 deletes your catalogue

`delete from activities where slug <> 'north-tour'`. Read the file before running it.

### Anything bucketed by "day" must use Mauritius time (GMT+4)

Not UTC. This has caused three separate off-by-one-day availability bugs. Copy the pattern from
`20260718120000_availability_mauritius_tz.sql`.

---

## Generated files

### Don't hand-edit them

`supabase/setup.sql`, `supabase/seed.sql`, `openapi.json` are generated. Your edit is discarded on the
next generator run, and a parity test fails CI in the meantime.

| To change…      | Edit…                  | Then run                                |
| --------------- | ---------------------- | --------------------------------------- |
| the seed        | `seed/catalogue.json`  | `npm run seed:gen && npm run setup:sql` |
| the API spec    | `src/lib/validation/*` | `npm run openapi:write`                 |
| the review pool | `data/…-reviews.json`  | `node scripts/gen-review-pool.mjs`      |

### But most `*.gen.ts` files have **no generator**

`src/lib/content/_blog.gen.ts`, `_transfers.gen.ts`, `_areas.gen.ts`, `_additional-attractions.gen.ts`
and `_attraction-images.gen.ts` all say _"AUTO-GENERATED — do not edit by hand"_. **Nothing in the repo
regenerates them.** They are hand-maintained source. Edit them in place; ignore the banner. Delete them
expecting to re-run a generator and the content is gone for good.

(Only `_review-pool.gen.ts` and `_review-stats.gen.ts` genuinely have one.)

### `src/lib/supabase/types.ts` is hand-authored

Despite the `gen:types` script existing. **Do not run it** — there's no local Supabase stack, so it
writes garbage over a file the whole app typechecks against. Hand-edit it when a table or enum changes.

Note it only bites for table access (`sb.from('posts')`). The RPC path casts through `unknown`, so a
missing `Functions` entry fails nothing — silent divergence.

### Don't import `_review-pool.gen.ts` from a client component

It's ~200 KB of review text and would ship to the browser. Client code imports the tiny
`_review-stats.gen.ts` aggregate instead.

---

## Next.js / Cloudflare

### Every API route needs `export const runtime = 'edge'`

`next build` passes without it. `pages:build` — the actual Cloudflare artifact — fails. A unit test
catches this; don't delete it.

### `pages:build` cannot run on Windows

`spawn npx ENOENT`. **A green `next build` does not prove the deployable bundle builds.** CI is the only
trustworthy gate. Don't spend an afternoon assuming your code broke it.

### Don't delete `.npmrc`

`legacy-peer-deps=true` is load-bearing: `@cloudflare/next-on-pages` caps its peer dep at `next <=
15.5.2` while the app pins `15.5.19` for security patches. Remove it and `npm install` fails.

### A brand-bearing page title must be `title: { absolute: … }`

The root layout applies the template `%s | Belle Mare Tours`. A plain string title that already names the
brand renders as _"Contact Belle Mare Tours | Belle Mare Tours"_.

### Don't add a cached route without `Vary: Cookie`

Language and currency live in **cookies** and are rendered into the server HTML. A CDN cache without
`Vary: Cookie` serves one visitor's language to the next. Use the `cc()` helper in `next.config.mjs` — it
adds it.

And leave `/activities/:slug*` uncached (so admin publish/unpublish is immediate) and `/checkout` at
`no-store` (it mints a booking hold; a stale re-execution could duplicate a booking).

### Don't import Next or React inside `src/lib/services/**`

ESLint blocks it. The services layer is deliberately framework-agnostic and must receive its database
client via `ServiceContext` — so it can't accidentally grab the RLS-bypassing admin client.

---

## Admin & content

### Don't hardcode what the owner can already edit

Page titles/descriptions (18 pages), blog posts, redirects, and **every fare** are database rows editable
in `/admin`. Hardcode one in code and the owner's edit is silently ignored — or, for fares, the page
displays a price the server won't honour.

Check `src/lib/seo/page-registry.ts`, the `posts` table, `seo_redirects`, and the 8 fare tables in
`src/lib/admin/vehicle-pricing.ts` before you edit copy.

Related: a build-time redirect in `next.config.mjs` always wins over an admin-managed one, and the owner
has no way to see why theirs does nothing. Keep owner-managed redirects in the database only.

### The admin sidebar is not a security boundary

`AdminShell` filters nav items by role. That's **cosmetic** — an `seo` user can type any `/admin` URL.
The real boundary is RLS: `is_staff()` for money and PII, `is_content_editor()` for content.

**Never** grant the `seo` role access to `activity_options`, `activity_option_prices`, `categories`,
`session_occurrences`, or any booking / payment / lead / profile table.

### `activities.extra` must be merged, not rebuilt

`buildExtra()` copies every key the form doesn't own straight through. Rebuild it from the form's fields
instead and you silently wipe keys set by SQL patches — a bug class that has already bitten once.

Adding an `extra` field means touching **three** places: the Zod schema, `buildExtra()` + `loadActivity()`,
and `ActivityForm.tsx`.

### Set a tour to Draft; don't delete it

Deleting a tour with bookings fails on a foreign key (error `23503`). Draft is what you want.

---

## Everything else

### Don't rename the `gytm:` storage keys

`sessionStorage`/`localStorage` keys are namespaced `gytm:` (holds, cart lines, pickup, auth redirect).
It survived the rebrand on purpose. Rename it during a tidy-up and **every browser mid-checkout loses its
hold and cart**.

### Translation is an exact string match

Including curly apostrophes (`’`) and em-dashes (`—`). A near-miss silently falls back to English. This
shipped as a P1: French customers saw English on the checkout flow.

Change a string passed to `t(...)` → change the key in `src/lib/i18n/messages.ts` in the same commit.

### The app boots fine with no configuration — that proves nothing

Missing Supabase → in-memory fake catalogue. Missing Peach → a **stub payment provider whose webhook
confirms anything**. Missing Resend → emails queued and dropped, silently.

Production is protected only by the fail-closed gate (`isProductionLikeRuntime()`). **Don't loosen those
throws to make an error go away** — they are the last line of defence. And note `next dev` is exempt from
the gate, so local success proves nothing about production.

### `ENABLE_PREVIEW_FALLBACK=true` on production serves fake data

It's not in the Zod schema, so nothing validates or warns. Preview environments only. Grep for it before
go-live.

### The cron Worker does not deploy on `git push`

Covered in [deployment.md](deployment.md#the-cron-worker--the-part-everyone-forgets), but it belongs on
this list too. Edit `workers/cron/`, push, see green CI and a green Pages deploy — and the old code is
still running against the old URL.

### `MUR_PER_EUR` is a dead environment variable

Documented in `.env.example`; read by no code. Tuning it does nothing.
