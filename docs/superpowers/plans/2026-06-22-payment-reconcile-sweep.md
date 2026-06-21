# Payment Reconciliation Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A webhook-less safety net — persist the Peach checkout id, then have the maintenance cron re-query Peach for recent `payment_pending` bookings and confirm the ones that paid (reusing the idempotent settlement path).

**Architecture:** Add `payments.provider_checkout_id` (+ persist it in `createPaymentLink`); a `SECURITY DEFINER` enumeration RPC for stuck-pending candidates; a `reconcilePaymentsPending` service that loops `getCheckoutStatus` → `reconcilePaymentEvent`; wired into `/api/v1/internal/maintenance`.

**Tech Stack:** Next.js 15 edge, Supabase RPCs, TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-payment-reconcile-sweep-design.md`.

---

## Task 1: Persist the Peach checkout id

**Files:** Create `supabase/migrations/20260728000000_payment_checkout_id.sql`, `tests/integration/payment-checkout-id.test.ts`; modify `supabase/catch-up.sql`, `src/lib/services/payments.ts`, `src/lib/supabase/types.ts`, `tests/db/rpc.ts`.

- [ ] **Step 1: Failing test** — READ `tests/integration/payment-charge.test.ts` (the sibling `api_record_payment_charge` pattern + harness). Write a test: create a booking + payment, call `api_record_payment_checkout({ paymentId, checkoutId: 'chk_123' })` as the owner → the payment row's `provider_checkout_id` = 'chk_123'; a non-owner/non-staff caller → `forbidden`; a second call with a different id... (decide: overwrite latest, or set-once like the charge? The checkout id should reflect the LATEST checkout created — so OVERWRITE is correct, since a re-pay creates a new checkout and the sweep must query the latest. Assert overwrite.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Migration `20260728000000_payment_checkout_id.sql`** (dated after the latest): `alter table payments add column if not exists provider_checkout_id text;` + define `api_record_payment_checkout(p jsonb)` SECURITY DEFINER, guard `is_staff() OR (auth.uid() is not null and the payment's booking.user_id = auth.uid())` (MIRROR `api_record_payment_charge`'s guard exactly — READ it), updating `provider_checkout_id = left(p->>'checkoutId',128)` where `id = (p->>'paymentId')::uuid`. (Overwrite — no `is null` guard, since the latest checkout wins.) `revoke from anon; grant to authenticated, service_role`. Mirror into `catch-up.sql`; add to `tests/db/rpc.ts` allow-list + the signature to `types.ts` (+ the `provider_checkout_id` column on the payments Row).

- [ ] **Step 4: Persist in `createPaymentLink`** (`src/lib/services/payments.ts`): after `createCheckout()` returns the `checkoutId`, call `api_record_payment_checkout({ paymentId, checkoutId })` best-effort (try/catch + log, like the charge-record call). READ how the existing `api_record_payment_charge` call is made + reuse the payment id.

- [ ] **Step 5: Run → PASS + parity.** `npx vitest run tests/integration/payment-checkout-id.test.ts tests/integration/catch-up-parity.test.ts`.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(payments): persist the Peach checkout id for server-side reconciliation"` (stage only your files; leave untracked artifacts).

---

## Task 2: The reconciliation sweep + cron wiring

**Files:** Modify `supabase/migrations/20260728000000_payment_checkout_id.sql` (add the enumeration RPC) + `supabase/catch-up.sql`, `src/lib/services/maintenance.ts`, `app/api/v1/internal/maintenance/route.ts`, `tests/db/rpc.ts`, `src/lib/supabase/types.ts`; test `tests/integration/payment-reconcile-sweep.test.ts`.

- [ ] **Step 1: Enumeration RPC** — add `api_pending_payment_checkouts(p jsonb)` `{ graceMinutes?, limit? }` to the SAME migration (since it hasn't shipped) + catch-up. SECURITY DEFINER, **service_role/staff only** (`if not is_staff() then raise exception 'forbidden'` — the cron runs as service_role, which `is_staff()` returns true for? CONFIRM: service_role bypasses RLS but `is_staff()` checks `profiles.role` for `auth.uid()` — as service_role `auth.uid()` is null, so `is_staff()` is FALSE. So guard on `is_staff() OR auth.uid() is null` won't work cleanly; instead guard the RPC to require service_role: grant execute ONLY to service_role (revoke from anon, authenticated) and skip an in-body auth check, OR check `current_user`/`auth.role() = 'service_role'`. READ how `run_booking_maintenance` is guarded — mirror it exactly, since the sweep runs in the same service-role maintenance context.). Returns a table/jsonb of `{ ref, paymentId, checkoutId }` where `bookings.status='payment_pending'` AND `payment_state='pending'` AND `created_at > now() - (graceMinutes||240) * interval '1 minute'` AND `provider_checkout_id is not null` AND not exists a `payment_events` row of type in ('paid','refunded') for that payment, ordered by `created_at desc`, `limit coalesce(limit,100)`.

- [ ] **Step 2: Failing integration test** `tests/integration/payment-reconcile-sweep.test.ts`. READ `tests/integration/*maintenance*` or the maintenance test + how `getCheckoutStatus` is stubbed (the payments provider in tests — there's likely a stub provider; READ `tests/` for how the Peach provider is faked). Seed a `payment_pending` booking with `provider_checkout_id='chk_paid'` (+ a payment row). Stub the provider's `getCheckoutStatus` to return a `paid` `PaymentEvent` for `chk_paid`. Call `reconcilePaymentsPending(ctx)` → assert the booking is now `confirmed` + a paid event in the ledger; a SECOND call is a no-op (idempotent). Seed a second booking with `chk_pending` whose status stubs `pending` → stays `payment_pending`. A booking with no `provider_checkout_id` or `created_at` older than the grace window is NOT enumerated/touched.

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: `reconcilePaymentsPending(ctx, opts?)`** in `src/lib/services/maintenance.ts`. READ the existing `runBookingMaintenance`/`materializeAvailability` (the ctx shape, how they call RPCs, how the service-role admin client is reached — `ctx.admin`? `ctx.db`?). Implement: call `api_pending_payment_checkouts` (grace+limit), then for each row `await ctx.payments.getCheckoutStatus(checkoutId)` → `reconcilePaymentEvent(admin, event)` (READ `src/lib/payments/reconcile.ts` for the admin client arg). try/catch per row (a bad checkout logs a non-PII line + continues). Tally `{ queried, confirmed, pending, failed, errored }` and return it.

- [ ] **Step 5: Wire into the cron** — in `app/api/v1/internal/maintenance/route.ts`, call `reconcilePaymentsPending(ctx)` alongside the existing steps and merge its summary into the JSON response. Keep the existing auth (INTERNAL_TASK_SECRET) + service-role context.

- [ ] **Step 6: Run → PASS + parity + the full booking/payment regression** (`npx vitest run tests/integration/payment-reconcile-sweep.test.ts tests/integration/catch-up-parity.test.ts tests/integration/booking-flow.test.ts`).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(payments): server-side reconciliation sweep on the maintenance cron (webhook-less safety net)"`.

---

## Task 3: Green gate + review + push

- [ ] **Step 1:** `npm run typecheck && npm run lint && npx vitest run && npm run build` — all green; report real numbers.
- [ ] **Step 2:** Request a focused review: idempotency (no double-confirm/charge when client sync + sweep both run); the enumeration guard (service-role only; the grace window + batch cap bound it); `getCheckoutStatus` errors don't abort the batch; no PII/secret in logs; the checkout-id persistence overwrites on re-pay.
- [ ] **Step 3:** Commit fixes; push (rebase onto origin/main first if it moved — the owner pushes in parallel).

---

## Self-review (author)

**Spec coverage:** persist checkoutId (T1) ✓; enumeration RPC grace-windowed + bounded (T2 Step 1) ✓; reuse getCheckoutStatus + reconcilePaymentEvent (T2 Step 4) ✓; cron wiring (T2 Step 5) ✓; idempotent no-double-confirm (relies on append_payment_event's unique constraint — assert in tests) ✓.

**Type consistency:** `api_record_payment_checkout({paymentId, checkoutId})`, `api_pending_payment_checkouts({graceMinutes?, limit?}) → [{ref, paymentId, checkoutId}]`, `reconcilePaymentsPending(ctx) → {queried, confirmed, pending, failed, errored}`.

**Verify-at-execution-time:** how `is_staff()` behaves for service_role vs how `run_booking_maintenance` is guarded (T2 Step 1 — mirror it; service_role with null auth.uid() means is_staff() is false, so guard by grant-to-service_role-only or `auth.role()='service_role'`); the ctx admin-client accessor + how the test stubs the Peach provider's `getCheckoutStatus` (T2 Steps 2/4 — read the existing payment tests); whether `createPaymentLink` already has the payment id handy to pass to the new RPC (T1 Step 4).
