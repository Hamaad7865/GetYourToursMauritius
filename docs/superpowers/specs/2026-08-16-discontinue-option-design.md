# Discontinue a booking option (soft-retire)

**Date:** 2026-08-16
**Status:** Approved, implementing

## Problem

The owner wants to remove the "Sunset - Dinner 4 hours" option from "Catamaran Sunset
Cruise" going forward. The tour editor won't delete it — and shouldn't: it has a real
paid, confirmed booking (`BMTE7F986FD87E1A`, Martin Ahle, €205, trip 10 Oct 2026). The
editor's `reconcileOptions` keeps any option referenced by `booking_items` (ON DELETE
RESTRICT) or `quote_items`, but does so **silently** (the option just reappears), which
reads as broken.

A paid booking is a permanent sales record, so a booked option can never be hard-deleted.
There is no way today to retire an option from sale while keeping its history.

## Goal

A **discontinue** action: soft-retire one option so it is hidden from customers and takes
no new bookings, while the row (and every booking that references it) stays intact. And a
**reinstate** to undo it. Plus: replace the silent delete-revert with a clear message.

## How options surface today (ground truth)

- `activity_options.status text not null default 'active'` — **exists, unused** (all 56
  rows `'active'`; nothing reads it). Reuse it: `'active'` | `'archived'`.
- `api_get_activity` (effective body at `setup.sql:27276`) builds the customer `options`
  list from `activity_options o where o.activity_id = a.id` (no status filter), and the
  `fromPriceEur` from the same options — **the** customer-facing option surfaces.
- `materialize_availability` generates dates per option (already carries the weekday
  guard from `20261003000000`).
- `create_hold` rejects any occurrence whose `status <> 'open'`.
- Editor chain: `ActivityForm` → `PricingSection` → `OptionsEditor` (a controlled
  component: `options: OptionInput[]` + `onChange`).

## Design

### Enforcement (SQL) — reuse `status`, `'archived'` = discontinued

1. **`set_option_status_atomic({optionId, status})`** — new atomic RPC, `is_staff()`-gated:
   - Validate `status ∈ {'active','archived'}`; resolve the option's `activity_id`.
   - Write `activity_options.status`.
   - **archive:** reconcile its future slots exactly like `stop_availability_atomic` —
     **close** the ones a booking/hold/quote references (keep the record; Martin's 10 Oct
     slot stays), **delete** the empty ones.
   - **active (reinstate):** `perform materialize_availability(activityId)` to refill.
   - Grants: `revoke … from public, anon; grant … to authenticated, service_role`.

2. **`materialize_availability`** — carry the existing (weekday) body, plus skip archived
   options: `and o.status <> 'archived'` on both the reopen and insert branches. An
   archived option never regenerates dates.

3. **`api_get_activity`** — exclude archived from the customer option list and the
   from-price: `and o.status <> 'archived'` on the `options` subquery
   (`setup.sql:27391`) and the `fromPriceEur` join (`setup.sql:27353`). Backward-compatible
   — `'active'` behaves exactly as today.

Booking path unchanged: an archived option is not listed and has no open slots, and
`create_hold` already rejects closed/missing slots.

### Client + admin UI

- `types.ts`: add `set_option_status_atomic` to the RPC union (the `status` column is
  already typed).
- `activity-write.ts`:
  - `OptionInput` gains `status?: string` (loaded, not edited via the content fields);
    `loadActivityForEdit` selects and maps `status`.
  - `setOptionStatus(optionId, status)` — RPC wrapper.
  - `reconcileOptions` now returns the **names** of options it kept because they are
    referenced (booked/quoted); `updateActivity` returns `{ keptWithBookings: string[] }`.
    The keep/delete decisions are unchanged — only reporting is added.
- `OptionsEditor.tsx`: per **saved** option (`opt.id` present):
  - active → a **Discontinue** action (confirm) → `setOptionStatus(id,'archived')` → set
    that option's `status` via `onChange` (badge shows). The ✕ hard-delete stays for
    unsaved/unbooked options.
  - archived → **"Discontinued — hidden from customers"** badge + **Reinstate**.
  - a local `busyId` guards the in-flight button; errors surface inline.
- `ActivityForm.save()`: when `updateActivity` reports `keptWithBookings`, show a notice —
  "Couldn't remove X (has bookings) — use Discontinue to hide it instead" — instead of the
  silent revert.

### Martin's booking

Untouched. The option row is kept, so his name/price/date resolve in every admin view,
receipt, and day sheet. His 10 Oct trip is arranged off-system by the owner.

## Files

- `supabase/migrations/20261004000000_discontinue_option.sql` — new.
- `supabase/catch-up.sql` (append verbatim) + `supabase/setup.sql` (`npm run setup:sql`) +
  `supabase/backfill-migration-ledger.sql` (row).
- `src/lib/supabase/types.ts`, `src/lib/admin/activity-write.ts`,
  `src/components/admin/activity/OptionsEditor.tsx`, `src/components/admin/ActivityForm.tsx`.
- Tests: `tests/integration/discontinue-option.test.ts`, extend
  `tests/unit/admin-activities-delete-codes.test.ts`.

## Testing

- **Integration (pglite):** archive sets `status='archived'`, deletes empty future slots,
  keeps a booked one as `closed`; `api_get_activity` omits the archived option and excludes
  it from `fromPriceEur`; `materialize_availability` skips it; reinstate re-materialises and
  re-lists it.
- **Unit:** `reconcileOptions`/`planOptionReconcile` reports a booked removed option in
  `keptWithBookings` (and still doesn't delete it).

## Non-goals

- Teaching the AI planner and the new-quote builder to filter archived options — the owner
  won't offer a retired option there, and existing references still resolve. Follow-up if
  wanted.
- Any change to how a booked option is hard-deleted (still impossible by design).
