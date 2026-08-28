# Staff reschedule inside the 24-hour window (with a confirm step)

**Date:** 2026-08-28
**Status:** implemented
**Migration:** `20261005000000_reschedule_staff_window_override.sql`

## The problem

An operator opened `/admin/calendar`, expanded a guest on a departure, clicked **Move to another
date**, picked a valid future date, and got the flat error **"Could not move that booking."** The
booking (`BMTFB153A1AD3381`, 2 × Adult, dolphin swim) was confirmed, paid, and the target date was
open with the whole pool free.

### Root cause (verified against prod data)

`api_reschedule_booking` raised `reschedule_window_passed`. The booking's current departure was
**Sat 29 Aug 12:00**; `now()` was **28 Aug 12:37**, i.e. ~19½ hours out — inside the 24-hour
free-change window. That guard was written for the _customer_ self-service path and was bypassed in
exactly one case: a booking **we** had weather-cancelled (`bookings.disruption` set). It had **no
exemption for staff.**

So a staff operator was held to the same 24h wall as a customer. Any booking whose departure is under
24h away was un-moveable from the admin calendar — and stayed that way once the date passed, because
the condition (`current_starts <= now() + 24h`) only gets _more_ true with time.

Two smaller faults fell out of the same screen:

1. **The date picker still offered the move.** `loadMoveTargets` only checks the _target_ occurrence
   (open + capacity); the window rule lives in the RPC, which is the real authority. The list is a
   convenience — it can legitimately offer a date the RPC then refuses.
2. **The error was opaque.** `MovePicker` calls the RPC directly and never runs the result through
   `mapDbError`, so every failure (`option_mismatch`, `target_not_bookable`,
   `insufficient_capacity`, the window) collapsed to one generic string.

## The decision

Owner chose: **staff may bypass the window, but behind a deliberate confirm step.** Not a silent
staff bypass, and not "leave the rule, only fix the message".

## The change

### 1. RPC — `api_reschedule_booking(p jsonb)`

Read a new optional flag `p.staffOverride` (boolean, default false). The window guard gains **one**
extra clause:

```sql
v_staff_override := coalesce((p ->> 'staffOverride')::boolean, false);
...
if not v_disrupted
   and not (v_staff_override and is_staff())     -- staff may opt past the self-service window
   and (v_current_starts is null or v_current_starts <= now() + interval '24 hours') then
  raise exception 'reschedule_window_passed' ...
```

**The bypass is not self-servable.** `staffOverride` is honoured _only_ under `is_staff()`. A
customer (the `/api/v1/bookings/:ref/reschedule` path, or a hand-crafted request) who sets the flag
hits `is_staff() = false` and stays blocked by the window exactly as before. Everything else the RPC
enforces — ownership, confirmed+paid, same-option, capacity under `FOR UPDATE` — is untouched. Same
option means same price, so no payment ledger movement, override or not.

The customer service wrapper (`rescheduleBooking`) does not pass the flag, so the customer contract is
byte-for-byte unchanged.

### 2. Admin UI — `MovePicker` / `rescheduleBookingAsStaff`

- First click on a date → a normal move (no override).
- If it comes back `reschedule_window_passed`, the picker shows an inline confirm:
  **"This departure is under 24 hours away — move anyway?"** with **Move anyway** (retries with
  `staffOverride: true`) and **Cancel**.
- Every _other_ failure is terminal on this screen and now reads as a plain sentence, via a new pure
  `describeRescheduleError(err)` → `{ message, windowBlocked }`. `windowBlocked` is the only case that
  offers the retry; the message replaces the old generic "Could not move that booking."

### 3. Parity / guards

- `supabase/catch-up.sql` — the `api_reschedule_booking` block is updated to the new body (so the
  operator's catch-up paste and the migrations resolve to the same function; `catch-up-parity` test).
- `supabase/setup.sql` — regenerated via `npm run setup:sql` (`setup-sql-parity` test).
- `tests/integration/resolved-function-bodies.test.ts` — a new contract pins the
  `not (v_staff_override and is_staff())` gate on the _resolved_ body, so a later re-definition from a
  pre-override copy goes RED rather than silently dropping the staff `is_staff()` guard (or, worse,
  the `is_staff()` half — which would make the override self-servable).

## Tests (TDD)

Integration (`tests/integration/reschedule-booking.test.ts`):

1. **staff + `staffOverride:true`, trip 6h away → moves**; seats follow to the new date. (RED driver.)
2. **staff, no override, trip 6h away → still `reschedule_window_passed`.** (Guard: the default path
   still refuses, which is what raises the confirm prompt.)
3. **customer + `staffOverride:true`, trip 6h away → still `reschedule_window_passed`.** (Security
   guard: the flag cannot be self-granted.)

Unit (`tests/unit/admin-calendar.test.ts`): `describeRescheduleError` maps each RPC token to its
message and sets `windowBlocked` true only for `reschedule_window_passed`.

## Deploy

Push to `main`. The release pipeline auto-runs `supabase db push` (applies the migration), builds and
deploys web + cron. No manual catch-up re-run.
