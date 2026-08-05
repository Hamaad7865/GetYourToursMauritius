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

### Never ledger the provider's raw settlement figure — the card and the ledger speak different currencies

Since 2026-07-30 the card is charged in **MUR** (the live Peach account has no EUR facility) while the
ledger stays **EUR**. `append_payment_event` sums `payment_events.amount_minor` against
`payments.amount_minor` with zero currency awareness, so crediting Peach's raw MUR figure would mark a
booking paid **~54× over** — and an amount-less or short payload credited at face value is the same bug
in the other direction. `reconcile.ts` therefore measures every settled event against the **pinned
expected settlement** (`payments.charged_amount_minor` / `charged_currency`, written once inside
`api_create_payment`): an exact match (±MUR 1.00) credits the **full EUR total**; anything else —
short, wrong currency, missing amount/reference, cross-currency with no charge record — **quarantines**
with no ledger write and flags `settlement_review_at`, which also blocks the expiry sweep from
releasing a booking whose money may be real. Don't "simplify" this back to crediting
`event.amountMinor`, and don't compute MUR anywhere but the SQL pin — a per-session conversion at a
moved rate is exactly the charge/expectation drift the pin exists to kill.

### Don't remove the double-charge guard

`api_create_payment` returns an existing checkout if one was created for this booking less than 25
minutes ago, and `createPaymentLink` reuses it. Remove that and a customer who hits Back or reloads gets
a **second live checkout** for the same booking — and can be charged twice.

### …but never reuse a checkout without asking Peach whether it's still payable

The mirror image of the guard above, and it cost a real customer their booking (production
2026-07-24, `BMTE5CAD9FB1A5E3`). Abandon the widget and Peach CLOSES that session —
`/v2/checkout/{id}/status` returns `100.396.101 Cancelled by user`. Nothing cleared
`payments.provider_checkout_id`, so the guard kept handing the corpse back; the widget fired
`onCancelled` the instant it mounted and `EmbeddedCheckout` bounced the customer to their booking page,
whose only affordance was the button that had just handed them the same dead session. **Unpayable
forever, with no error message anywhere.**

`createPaymentLink` now calls `getCheckoutStatus` before reusing, and retires a session Peach reports
as terminal via `api_clear_payment_checkout` (compare-and-clear, so a concurrent request that already
minted a replacement doesn't lose it). Keep that check, and keep it CONSERVATIVE in the money
direction: only `checkoutTerminal` (set for the one verified cancellation code) licenses minting a
replacement. A decline or a timeout usually leaves the session retryable, so treating those as dead
would open a second payable session — the double charge the guard above exists to prevent.

### Don't anchor the checkout-reuse window to `payments.updated_at`

It is a generic row-mtime, and `append_payment_event` bumps it **even when it writes nothing**. The
reconcile sweep re-queries a stuck checkout every 2–5 minutes; on a dead one its ledger append is
deduped away (the status re-query reuses the checkout id as its `provider_event_id`, which the earlier
webhook event already occupies) — but `updated_at` still moves. Observed live climbing 21:00 → 21:06
with the customer doing nothing: the 25-minute stale-session escape hatch could never fire, which is
what turned the trap above from a 25-minute annoyance into a permanent one.

The window reads `payments.checkout_created_at` (stamped only by `api_record_payment_checkout`, when a
session is actually minted). Don't "simplify" it back to `updated_at`.

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

### Never hand-maintain a second copy of the schema

`setup.sql` is the fresh-install bundle, and it is **generated** (`npm run seed:gen && npm run setup:sql`)
and guarded by two tests. Do not create a hand-written sibling — a "quick full-schema paste file", a
snapshot, a schema-only variant. It will rot, and it will rot **silently**.

This is not hypothetical. A file called `bootstrap.sql` did exactly that: hand-concatenated in July 2026,
never regenerated, no parity test. By the time it was deleted it had missed five migrations — including
the **entire public-mutation security lockdown** — and was still actively granting `api_book` and
`api_create_hold` to `anon`. Anyone who had provisioned a database from it would have had a site where
the public key could mint free bookings. Its own "⚠️ DO NOT USE" warning in this handbook had gone stale
too, and understated the problem.

If you need a fresh-install artifact, regenerate `setup.sql`.
`tests/integration/setup-sql-executes.test.ts` executes it against an empty Postgres and asserts anon
cannot reach the money RPCs.

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
and the editor pane that owns the field under `src/components/admin/activity/`.

### Set a tour to Draft; don't delete it

Deleting a tour with bookings fails on a foreign key (error `23503`). Draft is what you want.

### A new activity with no map location gets pinned by guesswork

`activities.lat` / `.lng` (the admin's **Map location**) is what the planner's "Our activities" layer
pins. Leave them null and `resolveActivityCoords` falls back — first to the activity's first itinerary
stop with coords, then to a **Google Places text search of the marketing title**. That fallback always
returns _something_, so the pin looks confident while sitting in the wrong place, or in the sea. It is a
silent failure: nothing errors, nothing logs, and the map simply lies.

This bit the whole catalogue once — 42 of 43 published activities had no coordinates, and the layer was
entirely fallback-placed ("Private North Tour Mauritius" landed inland in the **west**). Migration
`20260904000000_activity_map_coords` set real departure points for every activity then published, guarded
by `lat is null` so an admin's later fine-tune is never overwritten.

So: **when you publish a new activity, set its map location in `/admin`.** To find one that was missed:

```sql
select slug, title from activities where status = 'published' and lat is null;
```

### Portrait photos used to break the activity gallery — keep the grid's explicit rows

The detail-page gallery (`src/components/gyg/detail/Gallery.tsx`) is a grid with a **pinned height**
(`h-[240px] sm:h-[360px]`). Without an explicit `grid-rows-*`, its implicit row is content-sized: a
tile image's `h-full` resolves as `auto`, so the row grows to the photo's intrinsic aspect-ratio
height while the container stays pinned and `overflow: visible` — the tiles paint straight over the
description and trust strip below. Latent for as long as every catalog photo was landscape; the first
portrait 9:16 phone uploads (2026-08-03) inflated the row to ~500px inside the 360px box, live on
production minutes after upload.

`grid-rows-1` on that grid is the fix (Tailwind rows are `minmax(0, 1fr)`, so the track clamps to the
container and `object-cover` crops the photo). `tests/unit/fixed-height-grid-rows.test.ts` scans every
fixed-height column grid under `src/components` for it — don't delete the row class to "simplify the
classNames", and don't work around the guard by giving a new gallery its height some other way.
Owners can upload photos in any orientation; the layout, not the upload, must absorb it.

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
Full system (guard rail, per-field coalesce, what's deliberately left English, the SEO caveat):
[localisation.md](localisation.md).

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

### A price rendered from a code constant is a price the owner cannot fix

The 45 airport-transfer landing pages advertised `from €X / car` from a hardcoded per-region table
(`FROM_PRICE_BY_REGION`) written when fares were region-based. The fares later became **zone**-based
and the constant never followed, so every page — plus its `<title>`, meta description, JSON-LD
`Offer` and map pin — advertised **below** what the widget charges (Belle Mare: "from €35" against a
real €55). Two copies of the constant existed; the second, in `src/lib/services/transfers.ts`, fed
the hotels API.

Fixed 2026-08-05: `transferFromPriceEur(slug, fares)` derives it from the live matrix
(`src/lib/transfers/from-price.ts`, cached per request), and `tests/unit/transfer-from-price.test.ts`
pins the advertised number to what `airportTransferQuote` returns for every listed hotel.

The rule this breaks is already in [operations.md](operations.md#what-you-can-change-yourself-with-no-developer):
anything the owner edits in `/admin` must be READ from the database everywhere it is shown. A
"representative" or "roughly right" duplicate in code will drift, and the drift is invisible — the
widget kept quoting correctly the whole time.
