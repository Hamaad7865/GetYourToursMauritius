# Weather disruption & rescheduling — implementation plan

Spec: [`../specs/2026-07-20-weather-reschedule-design.md`](../specs/2026-07-20-weather-reschedule-design.md)

Ordered by dependency. Each stage names its own verification. Do not start a stage until the
previous one's verification passes.

---

## Stage 0 — unblock (not this work)

The receipt-RPC security lockdown is in the tree, half-landed and red. `setup.sql` is generated from
**all** migrations, so it cannot be regenerated for this feature until that one is coherent.

- rename `20260818000000_lock_receipt_checkouts_execute.sql` → `20260818000001_…`
  (the +1s convention, as used by `20260733000000`/`…001`)
- add **both** rows to `supabase/backfill-migration-ledger.sql`
- `npm run setup:sql`, commit `supabase/setup.sql`

**Verify:** `npx vitest run tests/unit/migration-ledger.test.ts` → 4 passed.

This feature's migration then takes the next free prefix (`20260819000000` if the above lands as
`…818000000` + `…818000001`).

---

## Stage 1 — the migration

One file. Everything below in one migration, mirrored verbatim into `catch-up.sql`.

1. `alter table bookings add column if not exists disruption jsonb;`
2. `api_reschedule_booking(p jsonb)` — guards in the spec's table order. `for update` on the target
   **before** the capacity read. Party size is `sum(coalesce(bi.pax, bi.quantity))`.
3. `api_weather_cancel_occurrence(p jsonb)` — staff only, fan-out, idempotent on an
   already-cancelled occurrence.
4. `api_admin_calendar_month(p jsonb)` — staff only, per-day aggregate.
5. `api_cancel_booking` re-applied from `20260806000000_security_lockdown.sql:16-84` **verbatim**
   plus: the disruption bypass on the 24h window, and the customer email enqueue (§7 bug).
6. `booking_json` re-applied from `20260735000000_transfer_service_date.sql:6-65` **verbatim** plus:
   `disruption`, `activitySlug`, `activityOptionId`, `partySize`, `reschedulable`, and the
   `cancellable` bypass. Keep `security invoker` — the definer-grants test depends on it.
7. Trailing grants. Customer-callable → `grant to authenticated, service_role`. Staff-only →
   same, guard is inside. Every one preceded by `revoke … from public, anon, authenticated`.

Header must name the source of each re-applied body (drift-guard convention).

**Verify:** `npx vitest run tests/integration/schema.test.ts tests/unit/migration-ledger.test.ts`

## Stage 2 — mirror + regenerate

- append the migration verbatim to `supabase/catch-up.sql` under a `-- ====` banner naming the
  version (append at EOF — everything after line 6221 is outside the transaction)
- ledger row
- `npm run setup:sql` → commit `supabase/setup.sql`
- add `api_reschedule_booking` to `ALLOWED` in `tests/db/rpc.ts`

**Verify:** `npx vitest run tests/integration/catch-up-parity.test.ts tests/integration/setup-sql-parity.test.ts tests/integration/setup-sql-executes.test.ts tests/unit/sql-lockdown.test.ts tests/integration/definer-grants-lockdown.test.ts`

## Stage 3 — SQL tests

`tests/integration/reschedule-booking.test.ts`, the 9 cases in the spec. Model on
`cancel-booking.test.ts`: real PGlite, `db.as()` identity switching, `db.asOwner()` for assertion
reads, time moved by mutating `starts_at`.

Includes the regression that a self-cancel now enqueues a customer email.

**Verify:** the new file green, plus `tests/integration/cancel-booking.test.ts` still green.

## Stage 4 — service + route

- `rescheduleBooking()` in `src/lib/services/bookings.ts` + Zod result schema
- four new codes in `db-errors.ts`, **above** the generic `/\bforbidden\b/` branch
- `POST /api/v1/bookings/[ref]/reschedule` mirroring the cancel route, plus
  `rateLimit(req, 'bookings:reschedule', 10)`
- register in `src/lib/openapi/registry.ts`, `npm run openapi:write`

**Verify:** `npx vitest run tests/unit/openapi.test.ts tests/unit/openapi-fresh.test.ts tests/integration/api-routes.test.ts`

## Stage 5 — notifications

- three templates: `render()` branch in `resend.ts` **and** `enrich*` in `services/notifications.ts`
  for any carrying booking detail — wiring one without the other ships a near-empty email
- the telegram branch must set `message.text` (plain text, three lines, bare URL last)
- extract the email shell from `src/lib/email/booking-confirmation.ts:133-187` into
  `src/lib/email/layout.ts` first, then reuse — don't duplicate 55 lines of table markup

**Verify:** drain-path test, not just the renderer.

## Stage 6 — customer UI

- eligibility/filtering logic into `src/lib/**` (coverage only measures `src/lib/**`, and there is
  no React test harness in this repo)
- banner at `BookingConfirmation.tsx:419-420`, built from the file's existing idioms
- replacement dates as a **list**, not a calendar
- `booking.activitySlug` / `activityOptionId` / `partySize` threaded into the local `interface
Booking` and `bookingSchema`

**Verify:** unit tests on the extracted logic; manual pass in the browser preview.

## Stage 7 — admin calendar

- `AdminMonthGrid` on `monthCells()` — new component, not a reuse of the customer `MonthGrid`
- `/admin/calendar` page + `NAV` entry (no `seo: true`)
- day drawer via `useDialog`, PostgREST embed under `occurrences_staff`
- confirm dialog states the blast radius
- **never** insert `session_occurrences` directly

**Verify:** browser preview — month renders, day drawer opens, call-off fans out.

## Stage 8 — the gate

`npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build`

`pages:build` cannot run on Windows — watch CI. CI fails fast, so a red `format:check` hides the
five checks after it.

---

## Owner action after merge

Re-run `supabase/catch-up.sql` against production **before** the code deploys, or the site 500s on
the new feature.
