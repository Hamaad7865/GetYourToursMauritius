# Weather disruption & rescheduling — design

**Date:** 20 July 2026
**Status:** approved, implementing
**Scope:** Part 1 of 2. The reschedule engine, the weather fan-out, and the admin calendar.
The activity-page weather forecast widget is Part 2 and is specified separately.

---

## 1. Why

`/refunds` — live, published, customer-facing — already promises this:

> If we have to cancel for weather, sea conditions, a safety call, or because a minimum group size
> isn't met, you choose: a **full refund**, or a **free reschedule** to another date that suits you.

There is no reschedule mechanism anywhere in the codebase. No RPC, no admin action, no customer UI.
The only trace is copy telling people to "contact us to reschedule".

So this is not a new feature. It is closing the gap between published terms and what the app can do.

A second, operational reason: bad weather does not hit one booking, it hits **every booking on a
departure**. Today the owner would open each booking in turn and cancel it by hand. The missing
primitive is "call off Tuesday's catamaran".

---

## 2. The core architectural decision

**A disrupted booking keeps `status = 'confirmed'`. The disruption is a nullable JSONB column.**

The alternative — a new `disrupted` value in the `booking_status` enum — was rejected. That enum is
load-bearing in `used_capacity()`, `enforce_booking_admin_update`, `booking_json.cancellable`, and
every admin status filter. A new value ripples through all of them for no gain.

Instead:

| Thing | State |
| --- | --- |
| `session_occurrences.status` | → `'cancelled'` (an existing enum value). Stops new bookings on that date. |
| `bookings.status` | unchanged — stays `'confirmed'` |
| `bookings.disruption` | **new** `jsonb null` — `{reason, occurrenceId, declaredAt, resolvedAt, resolution}` |

Consequences, all good:

- `api_cancel_booking` and the new `api_reschedule_booking` both operate on a `confirmed` + `paid`
  booking, so a disrupted booking works with both **without modification to their state guards**.
- The seat stays counted on the cancelled occurrence, which is correct — the trip is off, nobody
  else can book it, and the occurrence is `cancelled` so it is not offered.
- No enum migration, no `used_capacity` change, no admin filter changes.

### The one guard that gets an exception

Refunding a called-off trip must work even when the trip is tomorrow. `api_cancel_booking` hard-blocks
inside 24 hours, and `booking_json.cancellable` mirrors that predicate for the UI.

The existing guard is **not relaxed**. An explicit second branch is added:

```
(v_booking.disruption is not null and v_booking.disruption ->> 'resolvedAt' is null)
```

`disruption` is settable only by a staff-gated RPC, so a customer cannot self-trigger the bypass.
The identical branch goes into `booking_json.cancellable` so the button and the backend cannot
disagree.

### Why the notification trigger is not involved

`enqueue_booking_notification()` is a **status-transition** trigger — every branch is
`elsif new.status = 'X' and old.status is distinct from 'X'`. Because a disrupted booking does not
change status, the trigger never fires for it.

Disruption and reschedule notifications are therefore enqueued **directly inside the RPCs**, exactly
as `api_cancel_booking` already enqueues its owner alert. The trigger is re-applied verbatim with one
small fix (§7) and is otherwise untouched.

---

## 3. Money safety

The invariants this design must never break:

1. **A reschedule may only move to another occurrence of the same `activity_option_id`.**
   Price lives on the option, not the occurrence. Same option ⇒ same price ⇒ the reschedule path
   never touches `payments`, never calls `append_payment_event`, never moves a cent.
   Cross-option is a cancel-and-rebook, not a reschedule. **Enforced in SQL, not the client.**
2. The client sends `{ref, occurrenceId}`. Never a price, never an activity id. The server derives
   everything else. (Handbook rule 1.)
3. The cancel-window bypass is gated on a staff-set flag.
4. Every new `security definer` function ends with
   `revoke execute … from public, anon, authenticated;` — Supabase default privileges leak EXECUTE,
   and `revoke from public` alone does not remove it. This was a live payment bypass once.
5. Capacity is re-checked under `select … for update` on the target occurrence, mirroring
   `create_hold`. Nothing today guards oversell on an occurrence swap.

---

## 4. SQL surface

One migration, `20260818000000_weather_disruption_reschedule.sql`, mirrored verbatim into
`supabase/catch-up.sql`.

### 4.1 Schema

```sql
alter table bookings add column if not exists disruption jsonb;
```

Shape: `{reason, occurrenceId, declaredAt, resolvedAt, resolution}` where `reason` is one of
`weather | sea_conditions | safety | min_group`, and `resolution` (once resolved) is
`rescheduled | refunded`.

### 4.2 `api_reschedule_booking(p jsonb)` — customer + staff

Input `{ref, occurrenceId}`. `security definer`, `search_path = public`.

Guards, in order:

| # | Check | Raises |
| --- | --- | --- |
| 1 | `ref` and `occurrenceId` non-empty | `invalid_request` |
| 2 | booking exists | `booking_not_found` |
| 3 | `is_staff() or (auth.uid() is not null and booking.user_id = auth.uid())` | `forbidden` |
| 4 | `status = 'confirmed' and payment_state = 'paid'` | `not_reschedulable` |
| 5 | target occurrence exists, **`for update`** | `occurrence_not_found` |
| 6 | target `status = 'open'` and `starts_at > now()` | `occurrence_not_bookable` |
| 7 | target `activity_option_id` = the booking's current option | `option_mismatch` |
| 8 | **window**: current earliest start `> now() + 24h`, **unless** disrupted-and-unresolved | `reschedule_window_passed` |
| 9 | `capacity - used_capacity(target) >= party size` | `insufficient_capacity` |

Party size is `sum(coalesce(bi.pax, bi.quantity))` — `quantity` alone undercounts a vehicle line.

Writes:

- `update booking_items set session_occurrence_id = <target> where booking_id = …` (all items —
  `booking_items` has no per-item status, so a partial reschedule has no representation)
- `update bookings set disruption = <stamped resolved>, updated_at = now()` — status untouched, so
  the notification trigger does not fire
- `insert into audit_logs` — `action = 'reschedule_booking'`, `entity_type = 'booking'`,
  summary carries dates only, **no PII** (existing convention)
- enqueue `booking_rescheduled` (customer, email) + `owner_date_changed` (owner, email + telegram)

Returns `{ok, ref, occurrenceId, startsAt, previousStartsAt}`.

Idempotency: if the booking is already on the target occurrence, return
`{ok, alreadyOnDate: true, …}` without re-enqueuing.

Grants: `revoke … from public;` then `grant execute … to authenticated, service_role;`
(a customer-callable RPC — same shape as `api_cancel_booking`).

### 4.3 `api_weather_cancel_occurrence(p jsonb)` — staff only

Input `{occurrenceId, reason}`.

- `is_staff()` else `forbidden`
- occurrence exists `for update`, `status <> 'cancelled'` else idempotent return
- `update session_occurrences set status = 'cancelled'`
- for every `confirmed` + `paid` booking with an item on that occurrence:
  - stamp `disruption = {reason, occurrenceId, declaredAt: now(), resolvedAt: null}`
  - enqueue `booking_weather_disrupted` (customer, email)
  - insert an `admin_*` bell row for staff
- audit row with the affected count
- returns `{ok, occurrenceId, affected}`

Grants: `revoke … from public, anon, authenticated;` `grant … to authenticated, service_role;`
(staff call it from the browser under `is_staff()`, so `authenticated` is required — the guard is
inside the function.)

### 4.4 `api_admin_calendar_month(p jsonb)` — staff only

Input `{from, to}` (Mauritius dates). Returns one row per day:
`{day, departures, pax, seatsLeft, cancelled}`.

Why an RPC rather than a PostgREST embed: a month across the catalogue is ~1,800 occurrences, and
aggregating that client-side is wasteful. `src/lib/admin/bookings.ts` already records the escape
hatch — *"if it's ever exceeded the reports should move to a SQL aggregate RPC."* This is that case.

The **day drawer** needs no RPC — `occurrences_staff` RLS already permits the nested embed
(§6.2), matching how the rest of admin reads data.

### 4.5 Re-applied verbatim (drift-guard convention)

Both are copied from their current winning bodies with **only** the stated additions. A late-merging
migration that re-applies a stale body silently reverts another migration's guard; the header must
name the source of each copy.

**`booking_json`** — from `20260735000000_transfer_service_date.sql:6-65`. Adds:

- `'disruption', b.disruption`
- `'activitySlug'` and `'activityOptionId'` from the booking's first item (needed by the customer
  date picker — the availability endpoint is keyed by slug and filtered by option)
- `'partySize'` — `sum(coalesce(bi.pax, bi.quantity))`
- `cancellable` gains the disruption bypass branch
- new `'reschedulable'` flag mirroring `api_reschedule_booking`'s guards 4/8

Signature attributes must not change: `language sql` / `stable` / **`security invoker`** /
`set search_path = public`. It is invoker on purpose — `definer-grants-lockdown.test.ts` relies on
`used_capacity` staying anon-executable *because* `booking_json` is invoker.

**`enqueue_booking_notification`** — from `20260817000000_whatsapp_owner_alerts.sql:11-186`.
One fix only, see §7.

### 4.6 Also required with the migration

- a row in `supabase/backfill-migration-ledger.sql` (1:1 with migration files, enforced)
- `npm run setup:sql`, commit `supabase/setup.sql` (byte-for-byte parity test)
- `npm run openapi:write`, commit `openapi.json`
- add `api_reschedule_booking` to the `ALLOWED` set in `tests/db/rpc.ts`

---

## 5. API surface

`POST /api/v1/bookings/:ref/reschedule` — edge, mirroring the cancel route exactly:

```
apiHandler → requireUser → rateLimit(req, 'bookings:reschedule', 10)
  → getBookingStatus(ctx, ref)   // ownership-first RLS probe: 404 for a stranger, no ref enumeration
  → rescheduleBooking(ctx, ref, occurrenceId)
  → jsonOk(result)
```

The cancel route has no rate limit today; this one gets one because it is a state-changing,
money-adjacent mutation and the house style applies it to those.

New typed error codes in `src/lib/services/db-errors.ts`, added **above** the generic
`/\bforbidden\b/` branch (first match wins):

| Code | HTTP | Message |
| --- | --- | --- |
| `not_reschedulable` | 409 | "This booking can no longer be moved online." |
| `reschedule_window_passed` | 409 | "Free changes have closed — please message us." |
| `option_mismatch` | 409 | "That date is for a different option — please book it separately." |
| `occurrence_not_bookable` | 409 | "That date is no longer available." |

`insufficient_capacity` and `forbidden` already map.

Register the route in `src/lib/openapi/registry.ts`.

---

## 6. UI

### 6.1 Customer — the disruption banner

`src/components/gyg/detail/BookingConfirmation.tsx`. The banner goes at **line 419-420**, between
the celebration seal and the `<h1>`, inside the card. Everything above it is celebration chrome that
is `false` for a called-off trip, so the banner becomes the literal first element.

> **Your trip on Tue 21 July was called off — sea conditions.**
> We're sorry. Choose what happens next:
> `[ Move to another date ]` `[ Get a full refund ]`

Built from the existing idioms in that file, not new primitives: the coral confirm-box shape at
line 669 (`rounded-xl border border-coral/30 bg-coral/[0.06] p-4`), the established button classes,
the shared `error` state at line 614, and `role="group"` labelling.

**"Move to another date" shows a list of the next available dates, not a calendar.** Fetched from
the existing public availability endpoint, filtered to the booking's `activityOptionId`, filtered to
`seatsLeft >= partySize`, capped at ~10 with a "show more" extension. This avoids extracting
`MonthGrid`, avoids re-authoring the popover shell, and avoids the offset-parent landmine from
`8c030eb` entirely. For "pick a replacement date" a list is also better UX than a month grid.

**Lead time is deliberately not enforced on a replacement date.** The operator cancelled; penalising
the guest with `min_advance_days` would be hostile. This is an explicit decision, not an oversight.

The action follows the house mutation pattern: raw `fetch` with a `Bearer` header, one dedicated
loading boolean bound to both `disabled` and `aria-busy`, error lifted from `body.error.message`,
and **no optimistic update — refetch** via `fetchBooking()`.

All eligibility and filtering logic goes in `src/lib/**` (not the `.tsx`), because coverage only
measures `src/lib/**` and there is no React test harness in this repo at all.

### 6.2 Admin — the Calendar module

New `/admin/calendar`. Registered in `NAV` at `src/components/admin/AdminShell.tsx:39` using the
existing `IconCalendar`. **Not** flagged `seo: true` — it shows customer names, and the `seo` role is
RLS-locked out of bookings anyway.

**Month grid** — a new `AdminMonthGrid` built on the shared `monthCells()` from
`@/lib/calendar/month`. Not a reuse of the customer `MonthGrid`: that component disables
unavailable cells (an admin must be able to click a zero-departure day), hardcodes a `tomorrow`
lower bound (an admin browses the past), and its cell renders only a number with no slot for
per-day content. The codebase's own precedent is to **share the maths, not the cell JSX** —
`TripDatePicker` already does exactly this.

Each cell shows departures count, total pax, and a state colour. Data from
`api_admin_calendar_month`.

**Day drawer** — a right-side drawer following `BookingDrawer` (`AdminBookings.tsx:594`), wired with
`useDialog` for the focus trap (the project's a11y contract). Lists every departure grouped by
option, each with its bookings (ref, name, party size, status). Read via a direct PostgREST embed
under `occurrences_staff` RLS, matching how the rest of admin reads.

Two actions:

- **Call off this departure** → `api_weather_cancel_occurrence`. Confirm dialog states the blast
  radius explicitly ("this emails 3 customers now").
- **Move this booking** → `api_reschedule_booking`, per row.

**Deliberately not reversible from the UI.** Calling off emails customers immediately and some will
take a refund before an undo could land; un-cancelling would leave a departure whose passengers have
scattered. Recovery is rescheduling people individually, which the same drawer supports.

**Deliberately read-mostly.** No seat editing, no price changes, no availability generation — those
have their own screens. Critically, the calendar must **not** insert `session_occurrences` directly:
those helpers were deleted on purpose because they bypassed per-option effective-capacity rules.
Capacity changes go through the atomic RPCs.

### 6.3 Timezone discipline

Non-negotiable, from `20260718120000_availability_mauritius_tz.sql`:

- "today" is `(now() at time zone 'Indian/Mauritius')::date`, never `current_date`
- day ranges use the half-open form
  `starts_at >= (from::timestamp at time zone 'Indian/Mauritius') and starts_at < ((to + 1)::…)`
  — the `(x at time zone …)::date = d` form is not sargable against `session_occurrences_starts_idx`
- calendar cells are keyed with `nominalDayKey`, fetched occurrences with `utcDayKey`. Never mix.

---

## 7. Notifications

New templates. Each needs a `render()` branch in `src/lib/notifications/resend.ts` **and**, where it
carries booking detail, an `enrich*` in `src/lib/services/notifications.ts`. Wiring only one of the
two is the dangerous failure: `render()` falls back silently to a near-empty email rather than
throwing.

| Template | Channel | To | Enqueued by |
| --- | --- | --- | --- |
| `booking_weather_disrupted` | email | customer | `api_weather_cancel_occurrence` |
| `booking_rescheduled` | email | customer | `api_reschedule_booking` |
| `owner_date_changed` | email + telegram | `'owner'` | `api_reschedule_booking` |

Conventions that bite: owner rows use the literal string `'owner'` (resolved at drain time);
multi-channel rows for one event need distinct idempotency-key suffixes (`_tg`, `_wa`); a telegram
enricher **must** set `message.text` or the alert arrives as the bare string
`Belle Mare Tours — owner_date_changed`; Telegram sets no `parse_mode`, so plain text only, three
lines, bare URL last.

Voice, from the existing customer templates: open `Hi <name>,`; one plain sentence with the cause;
say explicitly what they must do; apologise once without grovelling; close on an invitation; sign
`Belle Mare Tours` on its own line.

### The bug this work must fix

`api_cancel_booking` enqueues its owner alert (`booking_cancellation`) **before** flipping status.
The trigger's `refund_pending` branch then skips its whole block when that row exists — which
suppresses the **customer's** email too. A customer who self-cancels today receives nothing at all.

Right now that is a support annoyance. Once "get a full refund" is a button on a weather banner, it
is a customer staring at a screen wondering whether anything happened.

**Fix:** `api_cancel_booking` enqueues a customer email alongside its owner alert. The trigger is
untouched, so the blast radius is one function. Copy is written to serve both the self-cancel and
the disruption-refund case: *"We've cancelled booking X as you asked, and your refund is on its
way."*

### What is deliberately not built

**No in-app notification for the customer.** The customer "Updates" feed is `localStorage`-only
(`src/lib/notifications/inbox.ts`); the DB `notifications` rows written for customers are rendered by
nothing. A trip-cancellation notice that only survives in one browser is not a notification. Email is
the channel. Building a real customer-side DB feed is a separate piece of work.

Staff **do** get a bell row — `AdminBell` reads the DB table and needs no UI change, since it renders
`title`/`body` straight through and never inspects `type`.

---

## 8. Testing

`tests/integration/reschedule-booking.test.ts`, modelled on `cancel-booking.test.ts`. The suite runs
**real Postgres** (PGlite) with every migration applied — no mocking. Identity is switched with
`db.as({sub, role})`; assertions read via `db.asOwner()` so RLS never hides ground truth.

Cases:

1. happy path — items moved, capacity moves with them, notifications enqueued once
2. idempotent re-call → `alreadyOnDate`, no second notification
3. cross-option target → `option_mismatch`, nothing changed
4. target full → `insufficient_capacity`, nothing changed
5. inside 24h, not disrupted → `reschedule_window_passed`
6. inside 24h, **disrupted** → succeeds (the bypass)
7. stranger → `forbidden`, nothing changed
8. `api_weather_cancel_occurrence` — occurrence cancelled, N bookings stamped, N emails enqueued,
   idempotent on re-call
9. regression: a self-cancel now enqueues a customer email (the §7 bug)

Time is manipulated by mutating `session_occurrences.starts_at`, not by faking a clock.

PGlite is single-connection, so this proves logic — capacity, idempotency, policies — but not
multi-transaction race contention. That remains a deploy-time property of the `for update`.

The gate, in order, fails fast: `typecheck`, `lint`, `format:check`, `test:coverage`, `build`,
`pages:build`. A red `format:check` silently skips Build and the edge bundle. `pages:build` cannot
run on Windows — watch CI.

---

## 9. Deployment

Three parts deploy separately. `git push` ships only the first.

1. **Code** — Cloudflare Pages, automatic on `main`.
2. **Database** — the owner pastes `supabase/catch-up.sql` into Supabase **before** the code lands,
   or the site 500s on the new feature.
3. **Cron worker** — not touched by this change.

---

## 10. Deferred

- The activity-page weather forecast widget (Part 2).
- Per-day rain hints in the customer booking calendar.
- A real customer-side DB notification feed.
- Multi-item / partial reschedule — `booking_items` has no per-item status, so it has no
  representation today.
- Automated refunds via Peach. Refunds remain a manual dashboard action recorded through
  `api_mark_refunded`.

## 11. Open question for the owner

`/refunds` states free cancellation until **09:00 Mauritius time the day before**.
`api_cancel_booking` enforces **more than 24h before the start**, and occurrences start at noon
Mauritius — i.e. **noon the day before**. The code is three hours more generous than the published
terms. Harmless in direction, but they should agree. Not blocking this work.
