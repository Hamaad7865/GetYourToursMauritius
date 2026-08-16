# Per-option day-of-week availability

**Date:** 2026-08-16
**Status:** Approved, implementing

## Problem

Some activity providers don't operate every day. The trigger: the **sunset catamaran**
provider does not run the trip on **Sundays and Mondays**. Today every published,
priced activity is bookable on every future date, so those days show as available and a
guest can book a trip that can't run.

## Goal

Let admin mark, per **booking option**, which days of the week it runs. A day switched
off never becomes bookable — on the customer calendar, the reschedule banner, the admin
calendar, and the booking path. Default is unchanged (every day), so existing options
are untouched.

Scope and placement were chosen by the owner: **per booking option**, edited on the
**Availability** screen.

## How availability works today (the ground truth)

- `materialize_availability(p)` is the **single** function that generates bookable dates.
  It inserts one `session_occurrences` row per option per day (~185 days ahead) for every
  published, priced option with a `daily_capacity`, and reopens `closed` future slots.
- `api_list_availability(p)` feeds **both** the customer booking calendar **and** the
  reschedule / weather-disruption banner. It returns future `status='open'` occurrences.
- `api_admin_calendar_month(p)` feeds the admin calendar grid.
- `create_hold(occurrence, qty, key)` is the booking gate. It already **rejects any
  occurrence whose `status <> 'open'`** (`occurrence_not_bookable`) and any past slot.
- The admin **Availability** screen saves through `set_daily_capacity_atomic` /
  `stop_availability_atomic`, which update capacity, propagate to future occurrences, and
  re-materialize — all in one transaction.

The key consequence: **if a closed-weekday slot simply never exists (or is `closed`),
every downstream read and the booking path are correct with no change to them.**

## Design

### Data model

Add one column:

```sql
alter table activity_options
  add column closed_weekdays smallint[] not null default '{}';
```

- ISO weekday numbers (`extract(isodow …)`): **Mon = 1 … Sun = 7**.
- Empty array = runs every day → existing rows unaffected, no backfill.
- Storing _closed_ days (not _open_) makes the safe default the empty set.
- CHECK that every element is between 1 and 7.
- Sunset catamaran's option → `{1,7}`.

### Enforcement — all in SQL, at the generation point

1. **`materialize_availability`** gains a weekday guard on **both** branches:
   - INSERT: `and extract(isodow from d::date)::int <> all(o.closed_weekdays)` — never
     create a slot on a closed weekday.
   - Reopen UPDATE: the same guard on
     `extract(isodow from (so.starts_at at time zone 'Indian/Mauritius'))::int` — never
     reopen a closed-weekday slot.

2. **New `set_option_weekdays_atomic({optionId, closedWeekdays})`** — mirrors
   `stop_availability_atomic`, scoped to one option and the now-closed weekdays:
   - `is_staff()` guard; validate `closedWeekdays ⊆ {1..7}`; resolve the option's
     `activity_id`.
   - Write `activity_options.closed_weekdays`.
   - For that option's **future** slots whose Mauritius-local weekday is now closed:
     **close** (`status='closed'`) the ones referenced by a booking item, active hold, or
     quote line (never strand a paid guest); **delete** the empty ones.
   - `perform materialize_availability(activityId)` to refill any weekday switched back on.
   - Grants: `revoke execute … from public, anon; grant execute … to authenticated,
service_role;` (the `anon` word matters — see the note on `stop_availability_atomic`).

No change to `api_list_availability`, `api_admin_calendar_month`, `create_hold`, or
`create_booking`. They are correct for free:

- customer calendar / reschedule: closed slots are absent or `closed` → filtered by
  `status='open'`.
- new bookings: absent slot → `occurrence_not_found`; `closed` slot →
  `occurrence_not_bookable` (existing guard).
- admin calendar: an already-**booked** closed day still shows (staff must service it); a
  formerly-empty closed day disappears.

### Existing bookings

A booking already sitting on a future closed weekday is **kept** (its slot is closed, not
deleted). Only new bookings are blocked; staff reschedule the existing one by hand. This
matches `stop_availability_atomic`.

### Admin UI (Availability screen)

A **"Runs on"** control — seven weekday toggles (Mon–Sun), all on by default:

- Single-option tour (sunset catamaran is one) → in the main availability card, bound to
  the sole option.
- Multi-option tour → one row per option, beside its existing trips/guests override.

Saving calls `setOptionWeekdays(optionId, closedWeekdays)`. A small **pure** helper maps
the seven booleans ↔ the ISO `closed_weekdays` array (unit-tested).

### What the customer sees

Closed days render exactly like any unavailable day: muted, struck-through, not
selectable, announced as "unavailable" to screen readers. No new copy.

## Files

- `supabase/migrations/20261003000000_option_closed_weekdays.sql` — new.
- `supabase/catch-up.sql` — append the idempotent form before the final `commit;`.
- `supabase/setup.sql` — regenerate via `npm run setup:sql`.
- `supabase/backfill-migration-ledger.sql` — add the ledger row.
- `src/lib/supabase/types.ts` — `closed_weekdays` on `activity_options` Row/Insert/Update.
- `src/lib/admin/availability-write.ts` — `OptionRow.closedWeekdays`, load it,
  `setOptionWeekdays`, mapping helper.
- `src/components/admin/AvailabilityEditor.tsx` — the "Runs on" control.
- Tests: unit for the mapping helper; pglite integration for materialize + reconcile +
  `api_list_availability`.

## Testing

- **Unit:** the weekday mapping helper (booleans ↔ `closed_weekdays`).
- **Integration (pglite):**
  - materialize creates no Sun/Mon occurrences when `closed_weekdays = {1,7}`.
  - `set_option_weekdays_atomic` deletes empty future closed-weekday slots and keeps a
    booked one (as `closed`).
  - switching a weekday back on re-materializes it.
  - `api_list_availability` returns no closed-weekday slots.

## Alternative considered (rejected)

Filter closed weekdays at **read** time — in `api_list_availability`,
`api_admin_calendar_month`, plus a `create_hold` guard — leaving occurrences in place. It
avoids deleting slots and toggles instantly, but spreads the rule across three or four
functions where forgetting one silently leaks a bookable Sunday. Enforcing at the single
generation point, and riding `create_hold`'s existing status guard, keeps the rule in one
place.

## Non-goals

- Activity-level (all-options) default weekdays — per-option was chosen; YAGNI.
- Auto-cancelling or auto-rescheduling a booking that already sits on a now-closed day.
- Date-specific blackouts (public holidays, one-off closures) — separate feature.
