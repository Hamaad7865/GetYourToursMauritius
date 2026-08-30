# Staff change-of-tour with the price difference collected

**Date:** 2026-08-30
**Status:** design approved, implementing
**Migration:** `20261006000000_booking_change_option.sql`
**Pilot booking:** `BMTBF62F6FB4DF4A` — Lorna Holland, 2 × Adult

## The problem

A guest booked **Full Day Speed Boat Ile Aux Cerf with Lunch** (€55/adult, €110 paid, confirmed) for
21 Sep 2026, then asked to move to **Full Day 5 Islands tour Ile Aux Cerfs with Lunch** (€80/adult,
€160) because the cheaper trip includes no snorkelling. She offered to pay the difference.

Nothing in the system can do this.

- `api_reschedule_booking` deliberately pins the move to the **same option** — "same option = same
  price, so no money moves". It is a date-change mechanism, not a product-change mechanism.
- The admin booking drawer offers: mark completed, cancel, mark refunded, save note, erase. There is
  no change-option action.
- `api_mark_refunded` is all-or-nothing; it reverses every payments row that still holds money.
- The only post-booking charge that exists is the late-pickup supplement, and it is purpose-scoped
  with a server-derived fee — it cannot be repurposed to carry an arbitrary difference.

So today the only path is: cancel → refund €110 by hand in Peach → rebuild the trip as a quote →
guest pays €160. Three manual money movements and a new booking reference for a guest who already
has one.

## The decision

Owner chose, in order:

1. **The move commits only when the difference is paid.** Staff propose; the booking does not move
   until the money lands. Mirrors the late-pickup add-on.
2. **Cheaper moves are supported too**, not just upgrades.
3. **The target seat is held**, with an expiry, between proposal and payment.
4. **The VAT invoice is re-issued for the new total**, plus a receipt for the difference.

Decision 2 is what splits this into two flows. The commit-on-payment rule was chosen for the case
where the price goes **up**; a cheaper move has no payment to wait for, so it commits immediately and
then owes money back. These share one request table but are not the same flow.

## The three flows

| Difference | Hold? | Commits                     | Money                                  |
| ---------- | ----- | --------------------------- | -------------------------------------- |
| `> 0`      | Yes   | On settlement of the add-on | Guest pays the difference by card      |
| `= 0`      | No    | Immediately                 | None                                   |
| `< 0`      | No    | Immediately                 | Owner refunds by hand, then records it |

A downgrade commits immediately because withholding the move would leave the guest on a tour they
have already told us they do not want, waiting on a refund we perform by hand. The seat on the
cheaper tour is taken at the moment of the move, which is also when the old seat is released.

## Data model

### `booking_change_requests`

| Column                                | Notes                                                        |
| ------------------------------------- | ------------------------------------------------------------ |
| `id`                                  | uuid pk                                                      |
| `booking_id`                          | fk bookings, cascade                                         |
| `from_option_id` / `to_option_id`     | activity_options — recorded for the audit trail              |
| `to_occurrence_id`                    | the target departure                                         |
| `old_total_minor` / `new_total_minor` | both re-derived server-side                                  |
| `difference_minor`                    | `new - old`; signed                                          |
| `payment_id`                          | the `change_addon` payments row (upgrades only)              |
| `hold_id`                             | the `booking_holds` row reserving the target (upgrades only) |
| `expires_at`                          | when the proposal lapses (upgrades only)                     |
| `applied_at`                          | set once the move is committed; the whole idempotency story  |
| `refunded_at`                         | set when staff record the manual refund (downgrades only)    |
| `created_by`                          | the staff profile that proposed it                           |

`applied_at is null` is the idempotency guard, exactly as `booking_pickup_requests.applied_at` is:
the webhook, the reconcile sweep and the guest's own sync poll all land on the apply path, and only
the first one moves anything.

**Prices are never sent by the browser.** The RPC re-derives both totals from
`activity_option_prices`, honouring the same price labels and quantities the booking already carries.
This is rule 1 of the handbook and the reason `difference_minor` is computed in SQL.

### `payments.purpose` gains `'change_addon'`

Three places must stay in step, or reads of a row carrying the new label 500:

1. The `payments_purpose_check` constraint in the migration.
2. The `purpose` union in `src/lib/supabase/types.ts`.
3. The Zod enum in `src/lib/validation/booking.ts`.

Enum↔Zod drift has bitten this codebase twice. A DB label that Zod lacks fails every read of a row
carrying it, not just writes.

### The hold

`booking_holds.expires_at` is an ordinary per-row column — the 15-minute value in the original
migration is only a column **default**. `expire_holds()` sweeps on `expires_at <= now()` and the
capacity formula counts `status = 'active' and expires_at > now()`. So the proposal inserts a normal
hold row with an explicit `now() + interval '48 hours'` and needs **no new mechanism, no new column,
and no change to the sweeper**. The hold carries `booking_id` so it is traceable back to the booking
it is reserving for.

## Functions

### `api_propose_booking_change(p jsonb)` — staff only

`p = { ref, occurrenceId, expiresInHours? }`

1. `is_staff()` or reject. This has no customer-facing entry point at all.
2. Booking must be `confirmed` + `paid`.
3. **Single option only** — `count(distinct activity_option_id) <> 1` is refused, matching
   `api_reschedule_booking`'s `v_option_count <> 1` guard. No production booking spans options; a
   partial move has no representation in `booking_items`.
4. Target occurrence locked `for update`, must be `open`, must belong to a published activity, and
   must have capacity for the booking's **units** (`sum(quantity)`), not its **pax**. Gating on pax
   would demand 6 free vans for a 6-guest transfer.
5. Re-derive both totals; compute `difference_minor`.
6. Branch:
   - `> 0` — insert the hold (48h), insert the `change_addon` payments row and its `intent` event,
     insert the request. Return `{ applied: false, differenceMinor, paymentId }`.
   - `<= 0` — call `apply_booking_change` inline. Return `{ applied: true, differenceMinor }`.

An existing unapplied request for the same booking is superseded: its hold is released and its
payments row is only re-priced if no checkout session is live against it. Re-pricing under a live
session is refused (`change_payment_in_flight`) — that session is still payable at the old figure,
and moving `amount_minor` underneath it would make the guest's real settlement fail reconcile's
pinned-expectation check and quarantine. This is the same rule `api_request_pickup` enforces.

### `apply_booking_change(p_request_id uuid)`

The only thing that actually moves a booking. Under `for update` on the request row:

1. Refuse unless `applied_at is null`.
2. Booking must still be `confirmed` or `completed`. A capture on a session minted before the guest
   cancelled would otherwise upgrade a cancelled booking. `'completed'` counts as live, exactly as it
   does in `append_payment_event`, `api_mark_refunded` and the capacity count — excluding it is how
   the pickup supplement once silently kept money on a trip the owner had marked complete.
3. The target departure must still be running and the booking must not be awaiting a disruption
   choice (`booking_awaiting_choice`). Otherwise route to the orphan alert.
4. Rewrite `booking_items`: `activity_option_id`, `session_occurrence_id`, `unit_amount_minor`,
   `price_label`, `subtotal_minor`.
5. Update `bookings`: `total_minor`, `operator_payout_minor`, `updated_at`.
6. Release the hold (`status = 'consumed'`) and stamp `applied_at`.
7. Enqueue the guest notification and the owner alert.

### `notify_change_orphan_payment(p_payment_id uuid)`

Every branch that refuses to apply a settled `change_addon` routes here. The alternative is keeping a
guest's money with no record anyone will ever look at. Email only, idempotent per payment, and silent
for the one normal case (a replay of a request already applied).

### `trg_apply_booking_change`

`after update of status on payments when (new.purpose = 'change_addon' and new.status = 'paid' and
old.status is distinct from 'paid')`. Same trigger shape as `payments_apply_pickup_addon`.

### `api_record_change_refund(p jsonb)` — staff only

`p = { requestId }`. For a committed downgrade: writes a refund event for exactly
`abs(difference_minor)` against the booking's `purpose = 'booking'` payments row, then stamps
`refunded_at`.

The synthesised event id is **`change:refund:<request_id>`**, deliberately distinct from
`api_mark_refunded`'s `manual:refund:<payment_id>`. Sharing the id would make one path a silent no-op
for the other.

**The arithmetic that has to hold:** `api_mark_refunded` reverses
`greatest(paid_minor - refunded_minor, 0)` for every row still holding money, oldest first. After a
downgrade refund the `booking` row has `refunded_minor > 0`, so a later full cancellation must
reverse only the remainder and still land the booking at `refunded`, not stranded at
`partially_refunded`. This is covered by a test, not by inspection.

## Documents

Rewriting `booking_items` gives the €160 line items and the correct tour title on the invoice for
free — `api_booking_receipt` builds its lines straight off that table.

What is **not** free: the `chargedAmountMinor` fold. The receipt sums `purpose in ('booking',
'balance')` and then adds settled `pickup_addon` charges in a separate branch, gated on
`charged_currency is not distinct from` the base payment's currency. `change_addon` needs the same
branch **including that currency guard** — a row charged in a different currency must drop out rather
than corrupt the total. Getting this wrong is precisely the bug that once made a €150 invoice report
MUR 1,590 under the wrong reference.

The guest receives: the re-issued VAT invoice for the new total, and a payment receipt for the
difference.

## Admin UI

A **Change tour** action in the booking drawer, beside Cancel. Opens a panel: activity → option →
date, with the difference priced live from the server as soon as a departure is picked. The button
reads **Propose and send payment link** when the difference is positive, **Apply change** when it is
zero or negative — so staff can see which of the three flows they are in before committing.

A booking with an open proposal shows its state, the expiry, and a **Withdraw** action that releases
the hold.

A committed downgrade shows **Refund €X to the guest** with a confirm step, wired to
`api_record_change_refund`, in the same shape as the existing "Mark refunded" button: the owner
performs the actual refund in Peach and the button records it.

## What this deliberately does not do

- **No customer-facing entry point.** Staff only, this round.
- **No multi-option bookings.** Refused with a clear error.
- **No automatic refund execution.** Peach refunds stay manual, as they are everywhere else.
- **No partial-party changes.** The whole booking moves or none of it does.

## Test plan

| Test                                                       | Proves                                          |
| ---------------------------------------------------------- | ----------------------------------------------- |
| Upgrade: propose → unpaid → booking unchanged              | Commit-on-payment holds                         |
| Upgrade: propose → settle → items, total, occurrence moved | The happy path                                  |
| Upgrade: settle twice (replay)                             | `applied_at` idempotency                        |
| Upgrade: target sold out between propose and settle        | Routes to orphan alert, money not silently kept |
| Upgrade: booking cancelled between propose and settle      | Does not upgrade a dead booking                 |
| Proposal expiry                                            | Hold returns to the pool via `expire_holds()`   |
| Level move                                                 | Commits with no payments row at all             |
| Downgrade → record refund → later full cancel              | Lands at `refunded`, not `partially_refunded`   |
| Multi-option booking                                       | Refused                                         |
| Non-staff caller                                           | `forbidden`                                     |
| Receipt after upgrade                                      | `chargedAmountMinor` includes the difference    |
| Receipt after upgrade, foreign currency add-on row         | Currency guard drops it rather than corrupting  |

## Implementation checklist

1. Migration `20261006000000_booking_change_option.sql`; mirror byte-identically into
   `supabase/catch-up.sql`.
2. `types.ts` — new table types, `purpose` union.
3. `validation/booking.ts` — Zod purpose enum, propose/record-refund input schemas.
4. `src/lib/services/booking-change.ts` — service layer + `db-errors.ts` mappings.
5. `src/lib/admin/booking-change.ts` — admin client calls.
6. Admin drawer UI in `AdminBookings.tsx`.
7. Notification templates + `resend.ts` wiring.
8. `api_booking_receipt` fold — re-applied from its **winning** body verbatim plus the new branch,
   per the resolved-function-bodies drift guard.
9. Tests per the table above.
10. Full gate, then sandbox deploy.
