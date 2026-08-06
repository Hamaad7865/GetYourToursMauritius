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

### The total is NOT the sum of the line items

`bookings.total_minor` ≠ `Σ booking_items.subtotal_minor`. Three priced components are folded into the
total by `api_book` **without** a `booking_items` row of their own:

| Charge                  | Where it lives                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Region transport add-on | `bookings.transport_minor` (its own column)                                                                                    |
| Child-seat extra        | nowhere — only the **count** (`bookings.child_seats`) is stored; the €6-per-extra-seat cost is added straight to `total_minor` |
| Optional supplements    | `booking_supplements` rows (name + qty + unit + total per supplement), **snapshot at booking time**                            |

None of them may become a `booking_items` row: `booking_json` derives `partySize` from `Σ pax` and
`unitsNeeded` from `Σ quantity`, and `unitsNeeded` is what the reschedule date-picker checks capacity
against — an extra row would quietly inflate both. (`booking_supplements` is a separate table, so it
inflates neither.)

The supplements are the only add-ons whose prices the owner controls (`activity_supplements`, one
row per upgrade, set in `/admin` — many per activity since 20260908000000), which is why the booking
keeps its own copy of every name and amount. Re-pricing the lobster next season must not silently
re-price a receipt already issued. The pre-20260908 single-supplement columns
(`activities.supplement_name`/`supplement_minor`, `activity_translations.supplement_name`,
`bookings.supplement_*`) are **frozen legacy** — migrated into the new tables, still dumped for old
seeds, written and read by nothing.

So anything that shows why a booking was charged what it was must add these lines back explicitly.
Three surfaces do it, and they should agree:

- `bookingExtraCharges()` (`src/lib/admin/bookings.ts`) — the `/admin` drawer's Items card. All three
  charges, plus the residue guard below.
- `buildInvoice()` (`src/lib/invoice/model.ts`) — the VAT invoice / receipt PDF. All three; its
  lines reconcile to `totalEur` by construction. The supplement lines are pushed **last**, because
  `voucher-pdf.ts` reads `model.lines[0].quantity` positionally for its pax count.
- `BookingConfirmation.tsx` — the customer's confirmation screen. **Transport and the supplements.**
  Its totals list does not carry a child-seat money line (the seats appear as a separate detail block
  further down), so a booking with 2+ child seats shows a Total larger than its own visible lines.

`bookingExtraCharges()` also emits an **"Unaccounted"** line for any residue it cannot attribute. If
that line ever appears in the admin drawer, a priced component has been added to `api_book` and not
mirrored here — the point is that it shows up as a visible line instead of silently inflating a total.

### The one booking that is charged twice, on purpose

A guest who ticked **"I don't know yet"** at checkout books with `pickup_pending = true`: no address,
no coordinates, and therefore **no transport add-on** — `api_book`'s region fare never fires without a
pickup point. `20260910000000` lets them finish the job later from `/bookings/:ref`, which means
charging the supplement on a booking that is already `confirmed` + `paid`.

That cannot go through the booking's own payment. `api_create_payment` refuses a confirmed booking
(`booking_not_payable`), and that guard is load-bearing — it is what stops a second payable session for
money we already hold. So the supplement gets its **own `payments` row**, `purpose = 'pickup_addon'`.

Why that is safe rather than a second money path bolted on the side:

- `append_payment_event`'s booking-level projection was **already** a roll-up across every payments
  row of a booking (best row wins), so a pending add-on never drags a paid booking backwards;
- it only confirms a booking whose status is `draft`/`held`/`payment_pending`, so an add-on settling on
  a confirmed booking is a no-op for status;
- the reuse window, the single-flight lease and the FX pin are all **per payments row**, so they apply
  to the add-on unchanged.

**Five pre-existing functions assumed one payments row per booking**, and every one of them was wrong
the moment a second appeared. They are fixed in the same migration; the pattern to recognise is
_"the booking's payment"_ expressed as `order by created_at desc limit 1`:

| Function                        | What it did with two rows                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_create_payment`            | a booking re-pay picked up the **add-on row**. Now every lookup is scoped by `purpose`.                                                                                      |
| `api_pending_payment_checkouts` | enumerated by BOOKING state, so a lost webhook stranded a supplement forever. Add-ons enumerate on their own state.                                                          |
| `api_mark_refunded`             | reversed the **newest** row — the €30 supplement instead of the €500 booking, then latched. Now reverses every row that holds money.                                         |
| `api_booking_receipt`           | put the add-on's charge, date and provider ref on the **VAT invoice**. Now scoped to the booking row, with the supplement added to the charged figure.                       |
| `append_payment_event`          | its refunded branch stamped `bookings.status='refunded'` from ONE row, so refunding a supplement "refunded" a live booking. Now requires the booking-level roll-up to agree. |

`api_erase_user` needed a sixth change for a different reason: `booking_pickup_requests` holds its own
copy of the guest's address and GPS coordinates, and a late pickup only exists on a paid booking — the
retained, anonymize-only branch. Nulling `bookings.pickup_location` left that copy behind forever.

**The address is not written until the money lands.** `api_request_pickup` parks it in
`booking_pickup_requests`; a trigger on the payments status write calls `apply_pickup_request`, which
sets `pickup_location`, clears `pickup_pending`, and adds the fee to `transport_minor` + `total_minor`

- `operator_payout_minor` — guarded by `applied_at is null`, so a replayed webhook adds nothing twice.
  Writing the address at request time would let a guest clear their own "pickup to be arranged" badge for
  free, and the owner would find out on the morning.

The trigger is deliberate, not an oversight of _"never confirm a booking outside
`append_payment_event`"_: it confirms nothing (the booking already is), it fires from that function's
own write inside the same transaction, and re-declaring 170 lines of the codebase's most dangerous
function to add one call is precisely the migration-revert drift `landmines.md` warns about.

A still-missing pickup is chased by `api_enqueue_pickup_reminders()` (maintenance cron): the guest at
48h and again at 24h before departure, the owner at 24h. Idempotency keys carry the threshold, so each
booking is chased once per window and never once an address exists.

### The one customer who has no account — quotes

A quote is an offer the owner drafts and emails; the guest accepts it from a link, with **no account**.
So step 6 above cannot be reached the ordinary way: `api_create_payment` ends its guard with
`is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())`, and a quote booking has no
`user_id` at all while `POST /api/v1/quotes/{ref}/pay` calls as service_role.

That guard is **not** relaxed. There is a second entry point instead:

| function                   | grants                      | identity check | who calls it                    |
| -------------------------- | --------------------------- | -------------- | ------------------------------- |
| `api_create_payment`       | authenticated, service_role | **yes**        | `POST /api/v1/payments`         |
| `api_create_quote_payment` | service_role only           | no             | `POST /api/v1/quotes/{ref}/pay` |
| `create_payment(p, bool)`  | service_role only           | the argument   | the two above, nothing else     |

The quote path may skip the identity check because authorization there is the **emailed link token**,
verified by `resolveQuoteForToken` before the route reaches SQL — a stronger credential than the session
it skips — and because the RPC is service-role only, so nothing reachable from a browser can call it
without one. It additionally refuses any booking no `quotes` row points at, so the bypass cannot be
aimed at a normal customer's booking.

**Both wrap ONE body (`create_payment`) on purpose.** The single-flight checkout lease lives in it, and
that lease is the only thing stopping one booking having two payable Peach sessions. A second copy is a
copy free to drift. If you edit the lease, the reuse window or the FX pin, you are editing it once —
keep it that way, and keep `tests/integration/quote-checkout-entry.test.ts` (which claims the lease
through one entry point and asserts the other is told `checkoutPending`) passing.

### The one activity type that skips this whole path

`activities.extra.inquiryOnly` (e.g. skydiving) opts an activity **out of every step above** — no hold,
no `api_book`, no Peach checkout, no `append_payment_event`. The detail page renders `InquiryWidget`
instead of `BookingWidget`/`BookingOptionCard` (branch in `app/(site)/activities/[slug]/page.tsx` on
`activity.extra.inquiryOnly`); the customer sends trip details straight to the owner via a `wa.me`/`mailto:`
link (pre-filled, client-side, same pattern as the car/scooter rental widget), and a best-effort
`POST /api/v1/leads` row (existing endpoint, `interestActivityId` set) gives staff a durable record in
`/admin/leads` even if that send fails. There is no price reconciliation because there is no price to
reconcile — the "From €X" shown is the plain `fromPriceEur` display value, an estimate only.

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

| If you change…                                                              | You must also…                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A file in `supabase/migrations/`                                            | Mirror it into the **end** of `supabase/catch-up.sql`, run `npm run seed:gen && npm run setup:sql`, and **have the owner run the SQL on prod before the code ships**                              |
| A Zod schema in `src/lib/validation/`                                       | `npm run openapi:write` (a test compares `openapi.json` byte-for-byte)                                                                                                                            |
| Add a new `api_*` RPC                                                       | Add its name to the `ALLOWED` set in `tests/db/rpc.ts`, or tests throw `unknown rpc <fn>`                                                                                                         |
| Add a table / column / enum value                                           | Hand-edit `src/lib/supabase/types.ts` — it is **not** generated, despite the `gen:types` script                                                                                                   |
| Add an API route                                                            | `export const runtime = 'edge'` — the Cloudflare build fails without it (a unit test catches this)                                                                                                |
| A public page's title / description                                         | Nothing — but check it isn't already **admin-editable** (`src/lib/seo/page-registry.ts`)                                                                                                          |
| A price or fare                                                             | Nothing in code — fares are **admin-editable rows** (`/admin/vehicle-pricing`)                                                                                                                    |
| A charge `api_book` adds to `total_minor` **without** a `booking_items` row | Add it to `bookingExtraCharges()` **and** `buildInvoice()` **and** `BookingConfirmation.tsx` — otherwise the total can't be explained ([money path](#the-total-is-not-the-sum-of-the-line-items)) |
| Anything under `workers/cron/`                                              | `npx wrangler deploy --config workers/cron/wrangler.toml` — `git push` does **not** ship it                                                                                                       |
| The domain                                                                  | `NEXT_PUBLIC_SITE_URL` (Pages env) **and** `SITE_URL` in `workers/cron/wrangler.toml` **and** `PEACH_WEBHOOK_URL` **and** re-verify the Resend sending domain                                     |
| An English UI string passed to `t(...)`                                     | Update the matching key in `src/lib/i18n/messages.ts` — translation is an **exact string match**, and a near-miss silently falls back to English                                                  |
| A `create or replace function`                                              | Find the **winning** (last-in-filename-order) body first — see [landmines](landmines.md#the-worst-one-migration-revert-drift)                                                                     |

---

## 7. What's in the database vs what's in code

A recurring waste of effort: hardcoding something the owner can already edit.

**Admin-editable (change the row, not the code):**

- Tours, photos, options, price tiers, availability — `/admin/activities`
- All fares: sightseeing, road-trip, transport add-on, airport transfers, hotel transfers —
  `/admin/vehicle-pricing` (8 tables)
- Rental fleet — `/admin/rental`
- Categories, planner places, leads
- **Page titles & meta descriptions** — `/admin/seo`. Four groups: the hand-listed hubs
  (`SEO_PAGES`) plus destination guides, hotel transfers and attractions, built at request time by
  `buildSeoPageGroups()` (`src/lib/seo/page-groups.ts`).
- **A tour's own title & description** — the "Search appearance" panel in `/admin/activities`
  (writes `activities.seo_title` / `seo_description`). Tours are deliberately **not** in `/admin/seo`
  — two editors for one page would silently overwrite each other.
- **Blog posts** — `/admin/blog` (DB posts override the code-generated seed posts by slug)
- **Redirects** — `/admin/redirects`

`/admin/seo` also carries two read-only panels:

- **Health check** — a self-audit (`src/lib/seo/audit.ts`) over every editable page: missing,
  overlong or thin titles/descriptions, plus duplicate titles and descriptions across the site.
  Computed from our own data, so it works with nothing indexed.
- **Search performance** — Google Search Console clicks/impressions/position and top queries, via
  the content-editor-gated `/api/v1/seo/search-console`. Needs `GSC_SERVICE_ACCOUNT_JSON` +
  `GSC_SITE_URL`; unset ⇒ the panel prints setup steps and nothing else is affected.

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
