# Architecture — what's linked to what

[← Handbook](../HANDBOOK.md)

---

## 1. The shape of the code

Two top-level trees, and the split is enforced by ESLint — not just convention.

```
app/                    Next.js App Router ONLY
  (site)/               Public pages + the /admin back-office
  api/v1/               API routes  — every one declares `export const runtime = 'edge'`
src/
  lib/services/         Business logic. Framework-agnostic.
  lib/http/             The ONLY bridge between Next and services
  lib/config/env.ts     The Zod-validated server environment
  lib/supabase/         DB clients (browser / server / service-role)
  lib/payments/         Peach: createCheckout, verifyWebhook, reconcile
  lib/notifications/    Resend + the outbox drain
  lib/seo/              SITE identity, JSON-LD, metadata overrides
  lib/content/          Generated + hand-written marketing content
  components/           UI, grouped by feature
supabase/               Migrations + the SQL bundles (see database.md)
workers/cron/           A SEPARATE Cloudflare Worker. Deploys by hand.
tests/                  unit / integration (real Postgres) / e2e
```

**The rule ESLint enforces:** nothing under `src/lib/services/**` may import `next`, `react`,
`@/lib/http/*`, or `@/lib/supabase/admin`. Services receive their database client through a
`ServiceContext` argument. This keeps the business logic liftable into another runtime, and — more
importantly — stops a service from quietly grabbing the RLS-bypassing admin client.

Route handlers are **thin adapters**: authenticate, rate-limit, call a service, return JSON.

---

## 2. Where the logic actually lives

**In Postgres.** This is the biggest surprise for a new developer.

Pricing, capacity, holds, booking creation, payment settlement, and notification queueing are all
plpgsql functions (`api_book`, `create_booking`, `create_hold`, `append_payment_event`, …). The
TypeScript service layer mostly marshals arguments into a single `jsonb` parameter and marshals the
result back out.

Every service call goes through one narrow port:

```ts
// src/lib/db/rpc.ts — the entire database interface
rpc(fn: string, params: unknown): Promise<unknown>
```

Which means: **to change how something is priced or booked, you write SQL, not TypeScript.** See
[database.md](database.md).

---

## 3. The money path, end to end

This is the sequence to have in your head. Files in order:

```
1  BookingProvider.tsx        customer picks a date + party
       │  POST /api/v1/holds        (occurrenceId, people — NO price)
2  app/api/v1/holds/route.ts  → services/holds.ts → RPC api_create_hold → SQL create_hold
       │                              seat held for 30 minutes
3  Checkout.tsx               customer enters details
       │  POST /api/v1/bookings     (occurrenceId, party, pickup — still NO price)
4  app/api/v1/bookings/route.ts → services/bookings.ts → RPC api_book
       │                              └─ create_booking  ← ***prices computed HERE, from DB tables***
5  Checkout.tsx               reconcileOrWarn(): does the server's total match what we displayed?
       │                              a mismatch ≥ €0.005 BLOCKS and re-prompts with the real price
6  POST /api/v1/payments      → RPC api_create_payment (amount = bookings.total_minor)
       │                       → peach.ts createCheckout → checkoutId
7  /bookings/{ref}/pay        Peach's checkout.js widget mounts; customer enters card
8  ── settlement ─────────────────────────────────────────────────────────────────
       ├─ widget   → POST /api/v1/payments/sync      (re-queries Peach)
       ├─ Peach    → POST /api/v1/webhooks/payments  (HMAC-verified)
       └─ cron     → POST /api/v1/internal/maintenance (sweeps stuck payments)
                            ALL THREE funnel into ↓
9  reconcile.ts reconcilePaymentEvent() → SQL append_payment_event
       │            dedups the event, sums what was actually paid,
       │            refuses underpayments, re-checks capacity,
       │            sets bookings.status = 'confirmed'
10 SQL trigger enqueue_booking_notification → rows in notification_outbox
11 cron (*/2) → /api/v1/internal/notifications/drain → invoice PDF → Resend → customer + owner
```

### The three invariants that make this safe

**(a) Zero-trust pricing.** No price ever crosses the wire from the browser. `api_book` takes
`occurrenceId`, `party`, pickup coordinates — and nothing resembling an amount. `create_booking` reads
unit prices from `activity_option_prices` / `sightseeing_pricing` / the fare matrices and computes the
total itself. For transfers, the server even re-derives the _region_ from the hotel slug rather than
trusting a client-sent zone.

The price the UI shows is a **display mirror** (`src/lib/services/pricing.ts`). It exists so the customer
sees a number before committing. `Checkout.tsx`'s `reconcileOrWarn` compares it against the server's real
total before any card is charged, and blocks on a mismatch.

**(b) One settlement door.** `append_payment_event` is the only writer of `status='confirmed'`. It:

- dedups on `(payment_id, provider_event_id)` — a replayed webhook is a no-op
- sums what the provider _actually settled_; if `paid < amount`, the booking **stays pending** (no
  confirming an underpayment)
- re-checks capacity, and routes an oversell to `refund_pending` rather than confirming it
- refuses to confirm money that landed on an already-expired booking

**(c) The webhook body is never trusted.** `/api/v1/webhooks/payments` always returns `200` immediately
and does the work in `after()`. It confirms a booking only via an HMAC-verified body, or by re-querying
Peach using **the checkout id we stored ourselves at create time**. The id in the incoming body is
deliberately not used.

---

## 4. Availability and holds

Two independent mechanisms — people confuse them constantly.

**Seat holds free themselves.** Capacity is a _predicate_: `used_capacity()` counts holds only where
`status='active' AND expires_at > now()`. The moment a 30-minute hold lapses, the seat is available
again. No job required. `expire_holds()` is bookkeeping.

**Availability does NOT create itself.** `api_list_availability` is a pure read — it creates nothing.
Day-slots exist only because `materialize_availability` filled them, 185 days forward, and the **only**
thing that calls it on a schedule is the `*/5` maintenance cron.

The consequence: if the cron dies, the site does not break. The calendar just quietly empties from the
far end inward, over months, until an activity shows "no dates available" for no visible reason. Treat a
stalled cron as a P0.

---

## 5. Identity, domain and brand

One object, `src/lib/seo/site.ts`:

```ts
export const SITE = {
  name: 'Belle Mare Tours',
  legalName: 'Belle Mare Tours Ltd',
  email: 'info@bellemaretours.com',      // the HUMAN inbox (Reply-To) — NOT the sender
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  …
}
```

**`NEXT_PUBLIC_SITE_URL` is the only place the domain exists.** It feeds canonical URLs, Open Graph tags,
`robots.txt`, `sitemap.xml`, JSON-LD, and the Peach return URL. There is no other hardcoded copy of the
domain anywhere in the app.

The mail split matters: mail is **sent** as `bookings@` (`RESEND_FROM`) and **replies** are routed to
`info@` (`SITE.email`, passed as `reply_to`). Don't collapse them — see
[landmines](landmines.md#email).

---

## 6. The dependency table — "if I change X, I must also do Y"

This is the table to check before every commit.

| If you change…                          | You must also…                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A file in `supabase/migrations/`        | Mirror it into the **end** of `supabase/catch-up.sql`, run `npm run seed:gen && npm run setup:sql`, and **have the owner run the SQL on prod before the code ships** |
| A Zod schema in `src/lib/validation/`   | `npm run openapi:write` (a test compares `openapi.json` byte-for-byte)                                                                                               |
| Add a new `api_*` RPC                   | Add its name to the `ALLOWED` set in `tests/db/rpc.ts`, or tests throw `unknown rpc <fn>`                                                                            |
| Add a table / column / enum value       | Hand-edit `src/lib/supabase/types.ts` — it is **not** generated, despite the `gen:types` script                                                                      |
| Add an API route                        | `export const runtime = 'edge'` — the Cloudflare build fails without it (a unit test catches this)                                                                   |
| A public page's title / description     | Nothing — but check it isn't already **admin-editable** (`src/lib/seo/page-registry.ts`)                                                                             |
| A price or fare                         | Nothing in code — fares are **admin-editable rows** (`/admin/vehicle-pricing`)                                                                                       |
| Anything under `workers/cron/`          | `npx wrangler deploy --config workers/cron/wrangler.toml` — `git push` does **not** ship it                                                                          |
| The domain                              | `NEXT_PUBLIC_SITE_URL` (Pages env) **and** `SITE_URL` in `workers/cron/wrangler.toml` **and** `PEACH_WEBHOOK_URL` **and** re-verify the Resend sending domain        |
| An English UI string passed to `t(...)` | Update the matching key in `src/lib/i18n/messages.ts` — translation is an **exact string match**, and a near-miss silently falls back to English                     |
| A `create or replace function`          | Find the **winning** (last-in-filename-order) body first — see [landmines](landmines.md#the-worst-one-migration-revert-drift)                                        |

---

## 7. What's in the database vs what's in code

A recurring waste of effort: hardcoding something the owner can already edit.

**Admin-editable (change the row, not the code):**

- Tours, photos, options, price tiers, availability — `/admin/activities`
- All fares: sightseeing, road-trip, transport add-on, airport transfers, hotel transfers —
  `/admin/vehicle-pricing` (8 tables)
- Rental fleet — `/admin/rental`
- Categories, planner places, leads
- **Page titles & meta descriptions for 18 public pages** — `/admin/seo`
- **Blog posts** — `/admin/blog` (DB posts override the code-generated seed posts by slug)
- **Redirects** — `/admin/redirects`

**In code:**

- The generated content modules in `src/lib/content/` (`_blog.gen.ts`, `_areas.gen.ts`, …). Note: these
  say "AUTO-GENERATED — do not edit by hand" but **only the review-pool files actually have a
  generator**. The rest are hand-maintained; edit them in place.
- The landing pages, the SEO landing kit, all layout and design.

---

## 8. Roles and the security boundary

| Role       | Sees                                                          |
| ---------- | ------------------------------------------------------------- |
| `customer` | Their own bookings only                                       |
| `staff`    | Everything in `/admin`                                        |
| `admin`    | Everything in `/admin`                                        |
| `seo`      | **Content only** — SEO, Blog, Redirects, Tours (copy), Places |

The `seo` role exists so an external contractor can run SEO **without ever seeing customer data**
(GDPR). The boundary is enforced by two SQL functions:

- `is_staff()` → `staff | admin` — gates all money and PII
- `is_content_editor()` → `staff | admin | seo` — gates content tables only

**The real boundary is RLS, not the sidebar.** The admin nav filtering is cosmetic — an `seo` user can
type any `/admin` URL they like. What actually stops them is that Postgres returns zero rows from
`bookings` and `leads` for that role, and refuses their writes to pricing tables. There's an integration
test that proves it (`tests/integration/seo-module.test.ts`).

So: **never** add an `seo` grant to `activity_options`, `activity_option_prices`, `categories`,
`session_occurrences`, or any booking / payment / lead / profile table.
