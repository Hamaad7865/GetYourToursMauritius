# Pending bookings in the cart + safe auto-cancel on hold expiry

**Date:** 2026-06-24
**Status:** Awaiting owner sign-off
**Area:** cart · bookings · holds · payment maintenance (money path)

## Goal

1. **(Option C)** Show the signed-in user's `payment_pending` bookings _inside_ the cart, alongside
   saved/held items — each with a live countdown and a **Complete payment** CTA — and reflect them in
   the header cart badge. This closes the "empty cart gives no signal that an unpaid reservation is
   ticking down" gap that prompted the work.
2. **Auto-cancel** a `payment_pending` booking when its 30-minute hold lapses without payment: the seat
   is freed, the booking becomes terminal, and the user must re-book — done **safely** so a booking that
   was actually paid (or is mid-payment) is never cancelled.

## Verified facts that shape the design

- **The hold is 30 minutes, not 15.** Every `create_hold` definition (winning one:
  `supabase/catch-up.sql:4866`) inserts the hold _without_ an explicit `expires_at`, inheriting the
  column default — which `supabase/catch-up.sql:2285` altered from 15 → **30 min**. So the cart
  countdown (driven by the hold's real `expires_at`) is truthful, and hold-expiry coincides with the
  booking grace. **No hold-TTL change is required.** (Depends on `catch-up.sql` being applied on prod —
  the same run that ships this feature re-asserts it.)
- **Auto-cancel already exists.** `run_booking_maintenance()`
  (`supabase/migrations/20260616170000_maintenance.sql`), pinged every 5 min by the Cloudflare cron
  (`workers/cron/*` → `POST /api/v1/internal/maintenance`), already expires `payment_pending` bookings
  older than 30 min that have **no settled payment** (`status='expired'`) and releases their holds. The
  missing pieces are: an audit trail, a customer notification, and money-path-safe ordering.
- **Seat freeing is automatic.** `used_capacity()` counts a `payment_pending` booking _only_ via its
  live hold (its `booking_items` don't count until `confirmed`). The instant the hold passes 30 min the
  lazy formula stops counting it, so the seat is resellable immediately. **Auto-cancel is status-only —
  it must not free seats.**

## Decisions (owner-approved 2026-06-24)

1. Terminal status on timeout: **`expired`** (existing convention; late-payment→`refund_pending`
   routing and capacity logic already key off it). Functionally "cancelled" to the user.
2. **Email** the customer on auto-expire ("your reservation expired, seats released — rebook").
3. **Reorder the maintenance cron** so the Peach reconcile (confirm-paid) runs **before** the
   auto-expire step.
4. Header cart badge **counts pending bookings** too.

## Design

### Layer 1 — Database

New migration `supabase/migrations/20260740000000_pending_cart_autocancel.sql`, mirrored (appended) into
`supabase/catch-up.sql`.

**1a. `api_my_pending_bookings(p jsonb default '{}'::jsonb) returns jsonb`** — `SECURITY DEFINER`,
`set search_path = public`, `grant execute ... to authenticated`. Guard: if `auth.uid()` is null, raise
`unauthorized`. Returns a jsonb **array** of the caller's own bookings where
`user_id = auth.uid() AND status='payment_pending' AND payment_state='pending'`, each joined (lateral,
newest active hold) to the hold's `expires_at`:

```
[{ ref, status, paymentState, totalMinor, currency, createdAt, holdExpiresAt, title, items[] }]
```

This is the **RLS-safe seam** to expose the hold expiry: `booking_holds` stays staff-read-only; the
customer reads it _through_ this owner-scoped definer function (mirrors the IDOR-guard style of
`api_record_payment_checkout`). The `title` comes from the booking's item → occurrence → option →
activity join (single-activity per booking in this model). Exact column names confirmed against schema
at implementation.

**1b. Augment `run_booking_maintenance()`** (create-or-replace in the new migration, keeping its
signature/return). Keep the existing expire predicate (`payment_state='pending' AND NOT EXISTS settled`)
and hold-release **unchanged**. For each booking it expires, within the same transaction:

- INSERT one `audit_logs` row: `actor_id = NULL, actor_role = 'system',
action = 'auto_expire_booking', entity_type = 'booking', entity_id = <booking id>,
summary = 'payment_pending past 30-min grace, no settled payment'`. (Closes the no-audit gap.)
- INSERT one `notification_outbox` row, idempotent on a key like `'booking_autocancel:' || <booking id>`
  (`ON CONFLICT DO NOTHING`), type `booking_expired`, payload `{ ref }`.

**1c. Notification.** Add a `booking_expired` notification type + email template, wired into the existing
drain (`/api/v1/internal/notifications/drain`, same path as `booking_confirmation`). Copy: short,
plain — reservation expired, seats released, link to re-book. No new env (Resend already configured).

**Explicitly NOT done:** no client-callable cancel RPC. Auto-cancel stays cron/service-role only so a
browser can never expire someone's booking. `api_cancel_booking` is **not** reusable here — its guard
requires `confirmed+paid`.

### Layer 2 — API

`app/api/v1/bookings/pending/route.ts` (new, `runtime = 'edge'`): `GET`, `requireUser` +
`buildServiceContext` (same gate as `app/api/v1/bookings/[ref]/route.ts`) → new service method
`listMyPendingBookings(ctx)` in `src/lib/services/bookings.ts` → `api_my_pending_bookings`. Returns the
array above. Owner-scoped by the RPC, so RLS-equivalent.

### Layer 3 — Cart client

- **`src/lib/cart/useCart.ts`**: add a server-sourced `pendingBookings` slice, kept **separate** from
  the localStorage `CartItem[]` (do not cram server bookings into `CartItem`). Fetch
  `GET /api/v1/bookings/pending` (with auth headers, via the existing `holdClient`/`authHeaders`
  pattern); a 401/empty → `[]`. **Fetch cadence (efficiency — `useCart` is mounted site-wide via the
  header, so do NOT tie this to the global 15s hold-reconcile tick):** fetch once on hook mount (per
  hard page load), on `window` focus / `visibilitychange` (catches the return from the Peach redirect
  and the just-created booking), and — only while `CartView` is mounted — poll at ~30s. The per-row
  mm:ss countdown ticks locally every 1s off `holdExpiresAt`, so the list itself rarely needs
  re-fetching. Expose `pendingBookings` + `pendingCount`, and make the returned
  `count = items.length + pendingCount` (badge decision = yes).
- **`src/components/cart/CartView.tsx`**: render an **"Awaiting payment"** section (above saved items)
  mapping `pendingBookings`. Each row: title, date, total (`Price`), a live countdown reusing
  `HoldTimer` driven by `holdExpiresAt`, and a **Complete payment** button reusing
  `src/components/checkout/ResumePaymentButton.tsx` (`bookingRef`). At 00:00 the row shows "Reservation
  expired — rebook" and drops on the next fetch. Update the empty-state guard:
  `EmptyCart` only when **both** `items` and `pendingBookings` are empty.
- **`src/components/gyg/GygHeader.tsx`** (badge ~line 191): reads the hook `count`, now inclusive of
  pending bookings.

### Money-path safety — cron reorder

`app/api/v1/internal/maintenance/route.ts`: reorder to **reconcile → expire → materialize**, each step
in its own `try/catch` (so one failing step can't block the others, and a reconcile failure can't leave
abandoned bookings uncleaned). Reconcile confirms any genuinely-paid booking via the idempotent
`append_payment_event` (→ `status='confirmed'`), which then fails the expire predicate — closing the
"paid at minute ~29 but not yet webhook-confirmed" race. **The cart never triggers cancel**;
countdown-zero on the client only re-fetches and lets the server be authoritative. Residual edge (paid
_after_ expiry) keeps its existing backstop: a late `paid` event on an `expired` booking routes to
`refund_pending` (no double-charge; surfaced for manual refund) — now also audit-logged.

## Testing

- **api_my_pending_bookings** (integration, pglite): returns the caller's pending bookings with
  `holdExpiresAt`; excludes others' bookings; excludes `confirmed`/`expired`; unauthenticated → error.
- **run_booking_maintenance** (integration): still does NOT expire a booking with a settled payment;
  now writes exactly one `audit_logs` + one `notification_outbox` row per expired booking; re-running is
  idempotent (no duplicate notification).
- **Maintenance route reorder** (integration/unit): reconcile runs before expire; a booking that Peach
  reports paid-but-unconfirmed is **confirmed, not expired**, on the same tick (mock the Peach query);
  a step throwing does not block the others.
- **Endpoint** (unit): `GET /api/v1/bookings/pending` 401s without a user; shape matches.
- **Notification drain** (unit): the `booking_expired` template renders with the booking ref.
- **Cart** (unit, light): badge `count` includes `pendingCount`; `CartView` shows the pending section
  and not `EmptyCart` when only pending bookings exist.

## Files to touch

- `supabase/migrations/20260740000000_pending_cart_autocancel.sql` (new) + mirror in
  `supabase/catch-up.sql`
- notification type + email template (`src/lib/email/*` / notifications module) + drain wiring
- `app/api/v1/bookings/pending/route.ts` (new)
- `src/lib/services/bookings.ts`
- `src/lib/cart/useCart.ts`, `src/components/cart/CartView.tsx`, `src/components/gyg/GygHeader.tsx`
- `app/api/v1/internal/maintenance/route.ts` (reorder + per-step try/catch)
- tests under `tests/unit` + `tests/integration`

## Owner action after merge

- **Re-run `supabase/catch-up.sql` on prod** (adds `api_my_pending_bookings`, the augmented
  `run_booking_maintenance`, re-asserts the 30-min hold default).
- Ensure the **notifications drain cron** is running (so the expiry email actually sends).
- No new env vars.

## Out of scope (flagged, not built)

- A user-facing manual "cancel reservation" button (auto-cancel covers abandonment; `api_cancel_booking`
  doesn't cover `payment_pending`).
- The pre-existing `used_capacity()` "active hold without `booking_id IS NULL` check" over-reserve note
  (bounded by the 30-min TTL; separate concern).
