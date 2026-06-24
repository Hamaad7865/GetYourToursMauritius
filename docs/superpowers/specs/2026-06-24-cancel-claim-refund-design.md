# Customer "Cancel activity & claim refund" — design

**Date:** 2026-06-24
**Status:** approved (owner)

## Goal
Let a signed-in customer cancel their own confirmed, paid booking from the booking page and start a
refund — **self-service only when the trip is more than 24 hours away**. The button cancels the booking,
frees the slot, and flags it `refund_pending`; the **owner then refunds in the Peach dashboard and hits
"Mark refunded"** (the existing flow). No automated card refund.

## Decisions (locked with owner)
1. **Refund mechanism:** cancel now → `refund_pending` + notify owner; owner refunds manually in Peach
   and marks it refunded. No Peach refund-API automation.
2. **24h policy:** self-service only when the earliest occurrence start is `> now() + 24h` **and** the
   booking is paid. Within 24h or after the start → no button, show "Free cancellation has passed —
   message us to cancel" (WhatsApp). Owner handles late cancels case-by-case in admin.
3. **Cutoff:** fixed **24h** in code for v1 (the per-activity `cancellation_policy` is free text). A
   configurable per-activity cutoff is a later enhancement.

## Flow
```
Customer @ /bookings/:ref  (status=confirmed, paid, start > now+24h)
  → "Cancel activity & claim refund" → confirm dialog
  → api_cancel_booking: confirmed → refund_pending, slot released, owner notification enqueued
  → page shows "Cancelled — your refund is on its way"
  → OWNER: refund in Peach → admin "Mark refunded" (api_mark_refunded) → status=refunded → customer emailed
```

## Backend (zero-trust)
- **New RPC `api_cancel_booking(p jsonb)`** — `SECURITY DEFINER`, guards inside (pattern: `api_book`,
  `api_mark_refunded`):
  - `auth.uid()` required; the booking's `user_id = auth.uid()` (owner only; staff may also).
  - Guards (all server-side, authoritative): `status = 'confirmed'`, `payment_state = 'paid'`, and the
    booking's earliest occurrence `starts_at > now() + interval '24 hours'`. Otherwise raise a typed
    error: `not_cancellable` (wrong status/not paid) or `cancellation_window_passed` (inside 24h / past).
  - Effect: set `status = 'refund_pending'` (the existing confirmed→refund_pending transition; the
    money-owed obligation is explicit). Releasing the booking from the active set frees `used_capacity`
    for resale (refund_pending is excluded from capacity, same as today's "refund releases holds").
  - Enqueue a `booking_cancellation` owner notification (so the owner knows to refund).
  - **Idempotent:** a second call on an already `refund_pending`/`cancelled`/`refunded` booking returns
    the current state without error/double-notify.
  - Returns `{ ref, status }`.
- **`booking_json`** gains a server-computed **`cancellable` boolean** (`status=confirmed AND
  payment_state=paid AND earliest start > now()+24h`) so the client shows the button only when eligible.
  Re-apply `booking_json` from the current winning body (migration-revert-drift guard).
- Migration `supabase/migrations/<ts>_cancel_booking.sql`, mirrored byte-identical into
  `supabase/catch-up.sql` (catch-up-parity test stays green).

## API
- **`POST /api/v1/bookings/:ref/cancel`** — `runtime = 'edge'`, `requireUser`, ownership via the
  RLS-gated `getBookingStatus`, then call the cancel service → `api_cancel_booking`. Returns the updated
  booking (or status). Typed errors map to 409 (`ConflictError`) with a clear message. OpenAPI entry.
- Service: `cancelBooking(ctx, ref)` in `src/lib/services/bookings.ts` calling the RPC.

## Frontend — `src/components/gyg/detail/BookingConfirmation.tsx`
- Booking DTO (`bookingSchema`) gains `cancellable?: boolean` and (for the message) `startsAt?` is not
  required — the `cancellable` flag is enough.
- In the **paid** branch:
  - If `booking.cancellable`: a coral-outline **"Cancel activity & claim refund"** button → an accessible
    confirm dialog (`useDialog`): "This cancels your booking. Your refund will be processed back to your
    card within a few business days. Continue?" → on confirm, `POST …/cancel`, then re-fetch; the page
    flips to the refund-pending/cancelled state.
  - Else (paid but not cancellable, i.e. within 24h/past): a muted line "Free cancellation has passed —
    [message us to cancel]" linking to `whatsappUrl(...)`.
- New `STATUS_COPY` for `refund_pending`: e.g. "Cancelled — refund on its way" with reassuring copy.
- Errors announced via the existing `role="alert"`; button shows a busy state; `aria-busy`.
- FR i18n for every new string (i18n-coverage gate).

## Owner side
- `booking_cancellation` notification template enqueued to the owner (email) on cancel. It surfaces the
  ref so the owner can find it. The booking also appears under the admin **`refund_pending`** filter,
  where the existing **"Mark refunded"** action lives — no admin UI change required.

## Edge cases / safety
- Server is authoritative: even if a stale client shows the button, `api_cancel_booking` re-checks the
  24h window + paid + ownership and rejects otherwise.
- Idempotent double-click (no double notification, no error).
- A non-owner calling the RPC/route is rejected (ownership check; RLS on the route's pre-read).
- Unpaid / payment_pending bookings: no refund button (nothing paid). Out of scope here.
- Capacity: cancelling frees the slot for resale immediately.

## Tests (PGlite + unit)
- Integration (`api_cancel_booking`): eligible confirmed+paid+>24h → `refund_pending`, slot freed (a new
  booking can take the seat); within 24h → `cancellation_window_passed`; not paid / not confirmed →
  `not_cancellable`; non-owner → rejected; double-cancel → idempotent no-op; an owner `booking_cancellation`
  notification row is enqueued.
- `booking_json` returns `cancellable=true` only in the eligible case.
- Route/service test for `POST /cancel` (auth + ownership + error mapping) if a harness exists.

## Owner action
- Re-run `supabase/catch-up.sql` (adds `api_cancel_booking`, the `booking_json` `cancellable` field, and
  the `booking_cancellation` notification template). No env changes. Refunds remain manual in Peach.

## Out of scope (later)
- Per-activity configurable cancellation cutoff (structured field).
- The button on the `/account/bookings` list.
- A customer "cancellation received" email (the on-screen confirmation + the eventual refund email cover
  v1).
