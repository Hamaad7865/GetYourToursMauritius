# Server-Side Payment Reconciliation Sweep — Design

> Brainstormed 2026-06-22. The app is **webhook-less** (Peach hasn't activated webhooks), so booking
> confirmation relies on a status re-query. Today that re-query is triggered by the customer's browser
> (the embedded-checkout `onCompleted` → `/api/v1/payments/sync` + the confirmation-page poll). If the
> customer closes the tab a beat too early, the card is charged but the booking can stay `payment_pending`
> forever. This adds a **server-side safety net**: the maintenance cron re-queries Peach for recent
> `payment_pending` bookings and confirms the ones that actually paid — so a payment is never missed
> regardless of the browser.

## Locked decisions

1. **Persist the Peach `checkoutId`** on the payment row (it is NOT stored today — the blocker). The sweep
   needs it to call `getCheckoutStatus`.
2. **Reuse the existing settlement path** (`getCheckoutStatus` → `reconcilePaymentEvent` → `append_payment_event`)
   — the same idempotent path the client sync + (future) webhook use. No new settlement logic.
3. **Run it in the existing maintenance cron** (`/api/v1/internal/maintenance`, every ~5 min, service-role).
4. **Bounded + grace-windowed:** only re-query `payment_pending` bookings created within a grace window
   (default ~4h) that still have no settled event, capped per run. (Older stuck bookings are expired by the
   existing hold/booking maintenance.)

## Architecture

### 1. Persist the checkout id

- Migration: `alter table payments add column if not exists provider_checkout_id text;`
- In `createPaymentLink` (`src/lib/services/payments.ts`), after `createCheckout()` returns the `checkoutId`,
  persist it on the payment row via a small SECURITY DEFINER RPC `api_record_payment_checkout(p jsonb)`
  `{ paymentId, checkoutId }` (owner-or-staff guarded, mirroring `api_record_payment_charge`; best-effort —
  don't fail the checkout if the record write fails). Mirror into catch-up.sql + types.

### 2. Enumerate stuck pending bookings (server-side)

A SECURITY DEFINER RPC `api_pending_payment_checkouts(p jsonb)` `{ graceMinutes?, limit? }` (service-role/
staff only) returning `[{ ref, paymentId, checkoutId }]` for bookings where: `status = 'payment_pending'` AND
`payment_state = 'pending'` AND `created_at > now() - graceMinutes` AND `provider_checkout_id is not null`
AND no `payment_events` row of type `paid`/`refunded` for that payment. Ordered by recency, `limit` capped
(default 100). (Keeps the join + not-exists in SQL; the maintenance service already calls RPCs.)

### 3. The sweep service

`reconcilePaymentsPending(ctx, opts?)` in `src/lib/services/maintenance.ts`:

- Call the RPC to get the candidate list.
- For each candidate: `ctx.payments.getCheckoutStatus(checkoutId)` → `reconcilePaymentEvent(admin, event)`.
  Wrap each in try/catch so one bad checkout doesn't abort the batch; tally `{ queried, confirmed, pending,
failed, errored }`. No PII / secrets in logs.
- Return the summary.

### 4. Wire into the cron

Call `reconcilePaymentsPending(ctx)` from `app/api/v1/internal/maintenance/route.ts` alongside
`runBookingMaintenance` + `materializeAvailability`; merge its summary into the response. Service-role
context (already built in the route). The cron worker already POSTs this endpoint every 5 min.

## Idempotency / safety

- `append_payment_event` dedups on `unique(payment_id, provider_event_id)` — a checkout confirmed by the
  client sync and then re-swept inserts nothing the second time; the booking stays `confirmed`. No
  double-confirm, no double-charge (the sweep never creates a payment, only records status).
- A still-`pending` Peach status → records a pending event (no status change) → re-queried next run.
- A `failed` status → records a failed event (no booking-status change); the booking expires via the
  existing hold/booking maintenance.
- Grace window + batch cap bound the work + the Peach API call volume per run.

## Error handling

The RPC enumeration and each per-checkout query/reconcile are independently guarded; a Peach API error on
one checkout logs a non-PII line and continues. The whole step is wrapped so a sweep failure never breaks
the rest of maintenance (holds/availability still run). The maintenance endpoint stays 503 until
`INTERNAL_TASK_SECRET` is set (unchanged).

## Testing

- Integration (PGlite): seed a `payment_pending` booking with a stored `provider_checkout_id`; stub
  `getCheckoutStatus` to return `paid` → the sweep confirms it (status → `confirmed`, a paid event in the
  ledger); a second sweep is a no-op (idempotent). A `pending` status leaves it `payment_pending`. A booking
  with no `provider_checkout_id` or outside the grace window is NOT enumerated. A booking already `confirmed`
  is not re-touched. Non-staff/anon cannot call the RPCs.
- Unit: `api_record_payment_checkout` persists the id (owner/staff only; the charge-record sibling test pattern).

## Out of scope

Webhook setup (deferred until Peach enables it — then `PEACH_WEBHOOK_URL`/`SECRET` get set and the webhook
path coexists via the same `reconcilePaymentEvent`); back-off/jitter beyond the batch cap (add only if Peach
rate-limits in practice); reconciling refunds initiated outside the app (the admin "Mark refunded" action
already covers operator refunds).

## Owner action

Re-run `supabase/catch-up.sql` on the live DB (adds `provider_checkout_id` + the two RPCs). The cron must be
running (already on the owner checklist) for the sweep to fire.
