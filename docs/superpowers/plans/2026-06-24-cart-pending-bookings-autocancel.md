# Cart pending bookings + safe auto-cancel — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans (inline) to implement task-by-task. Steps use `- [ ]` tracking.

**Goal:** Show a signed-in user's `payment_pending` bookings in the cart with a live countdown + Complete-payment CTA (badge included), and make the existing auto-expire money-safe + audited + emailed.

**Architecture:** One owner-scoped RPC exposes pending bookings + hold expiry (RLS-safe); a thin authed endpoint feeds a new `pendingBookings` slice in `useCart`; the existing `run_booking_maintenance` auto-expire gets an audit row, an expiry email (via the existing notification trigger), and a money-safe cron reorder (reconcile-before-expire).

**Tech stack:** Next.js App Router (edge), Supabase plpgsql RPCs, pglite integration tests, vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-cart-pending-bookings-autocancel-design.md`. Owner decisions: status stays `expired`; email on expiry; reconcile→expire cron reorder; badge counts pending.

**Verified facts:** hold TTL is **30 min** (column default; `create_hold` never sets `expires_at` explicitly). Auto-expire already exists in `run_booking_maintenance` (30-min grace, guarded by `payment_state='pending' AND no settled payment`). Seat frees automatically at hold expiry — **auto-cancel is status-only**. Emails are enqueued by the `enqueue_booking_notification` AFTER-UPDATE-OF-status trigger and rendered by `render()` in `resend.ts`.

---

## File structure

- **Modify (DB, via new migration + catch-up mirror):** add `api_my_pending_bookings`; redefine `run_booking_maintenance` (+audit row); redefine `enqueue_booking_notification` (+`booking_expired` branch).
  - Create: `supabase/migrations/20260740000000_pending_cart_autocancel.sql`
  - Modify: `supabase/catch-up.sql` (append the same DDL, idempotently)
- **Modify (email):** `src/lib/notifications/resend.ts` — add `booking_expired` branch to `render()`.
- **Create (API):** `app/api/v1/bookings/pending/route.ts`
- **Modify (service):** `src/lib/services/bookings.ts` — `listMyPendingBookings(ctx)` + zod schema.
- **Modify (cart client):** `src/lib/cart/holdClient.ts` — `fetchMyPendingBookings()`; `src/lib/cart/useCart.ts` — `pendingBookings` slice + `count`.
- **Modify (cart UI):** `src/components/cart/CartView.tsx` — "Awaiting payment" section. (GygHeader needs NO change — `CartAction` already reads `useCart().count`.)
- **Modify (cron):** `app/api/v1/internal/maintenance/route.ts` — reorder reconcile→expire→materialize, each try/caught.

---

## Task 1 — DB migration (money-path core)

**Files:** Create `supabase/migrations/20260740000000_pending_cart_autocancel.sql`; mirror into `supabase/catch-up.sql`; Test `tests/integration/pending-cart-autocancel.test.ts` (+ extend `tests/integration/maintenance.test.ts`).

- [ ] **1.1 Write the migration SQL** (also pasted verbatim into `catch-up.sql`):

```sql
-- ===== Pending bookings in cart + safe auto-cancel =====

-- (1) Owner-scoped list of the caller's payment_pending bookings + their live hold expiry. RLS-safe
--     seam: booking_holds is staff-read-only, so we expose expires_at THROUGH this definer function.
create or replace function api_my_pending_bookings(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(t.row), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'ref', b.ref,
      'status', b.status,
      'paymentState', b.payment_state,
      'totalMinor', b.total_minor,
      'currency', b.currency,
      'createdAt', b.created_at,
      'holdExpiresAt', h.expires_at,
      'title', coalesce(a.title, 'Your booking'),
      'startsAt', occ.starts_at
    ) as row, b.created_at
    from bookings b
    left join lateral (
      select bh.expires_at from booking_holds bh
      where bh.booking_id = b.id and bh.status = 'active'
      order by bh.expires_at desc limit 1
    ) h on true
    left join lateral (
      select bi.session_occurrence_id, bi.activity_option_id from booking_items bi
      where bi.booking_id = b.id order by bi.created_at limit 1
    ) item on true
    left join session_occurrences occ on occ.id = item.session_occurrence_id
    left join activity_options ao on ao.id = item.activity_option_id
    left join activities a on a.id = ao.activity_id
    where b.user_id = v_uid and b.status = 'payment_pending' and b.payment_state = 'pending'
    order by b.created_at desc
  ) t;
  return v_rows;
end;
$$;
revoke execute on function api_my_pending_bookings(jsonb) from public;
grant execute on function api_my_pending_bookings(jsonb) to authenticated;

-- (2) Auto-expire gets an audit row per booking (system actor). Guard + hold-release UNCHANGED.
create or replace function run_booking_maintenance(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_grace interval := make_interval(mins => least(greatest(coalesce((p ->> 'graceMinutes')::int, 30), 1), 1440));
  v_holds int;
  v_bookings int;
begin
  v_holds := expire_holds();
  with stale as (
    update bookings b set status = 'expired', updated_at = now()
     where b.status in ('draft','held','payment_pending') and b.payment_state = 'pending'
       and b.created_at < now() - v_grace
       and not exists (select 1 from payments pay where pay.booking_id = b.id
                       and pay.status in ('paid','partially_refunded','refunded'))
    returning b.id
  ), audited as (
    insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
    select null, 'system', 'auto_expire_booking', 'booking', s.id,
           'payment_pending past grace, no settled payment'
    from stale s
    returning 1
  )
  select count(*) into v_bookings from stale;
  update booking_holds h set status = 'released'
    from bookings b where h.booking_id = b.id and b.status = 'expired' and h.status = 'active';
  return jsonb_build_object('holdsExpired', v_holds, 'bookingsExpired', v_bookings);
end; $$;
revoke execute on function run_booking_maintenance(jsonb) from public;
grant execute on function run_booking_maintenance(jsonb) to service_role;

-- (3) Email the customer when a payment_pending booking expires (path-agnostic, via the existing
--     status trigger). Idempotent on booking_expired:<id>. Keeps the confirmed/refunded branches.
create or replace function enqueue_booking_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values ('email', new.customer_email, 'booking_confirmation',
      jsonb_build_object('ref', new.ref, 'customerName', new.customer_name,
        'totalMinor', new.total_minor, 'currency', new.currency),
      new.id, 'booking_confirmation:' || new.id)
    on conflict (idempotency_key) do nothing;
  elsif new.status = 'refunded' and old.status is distinct from 'refunded' then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values ('email', new.customer_email, 'booking_refunded',
      jsonb_build_object('ref', new.ref, 'customerName', new.customer_name),
      new.id, 'booking_refunded:' || new.id)
    on conflict (idempotency_key) do nothing;
  elsif new.status = 'expired' and old.status = 'payment_pending' then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values ('email', new.customer_email, 'booking_expired',
      jsonb_build_object('ref', new.ref, 'customerName', new.customer_name),
      new.id, 'booking_expired:' || new.id)
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end; $$;
```

- [ ] **1.2 Tests (pglite integration)** — mirror `tests/integration/maintenance.test.ts` harness. Assert:
      (a) `api_my_pending_bookings` as user A returns A's payment_pending booking with a non-null
      `holdExpiresAt`, excludes B's booking, excludes confirmed/expired; raises when `auth.uid()` is null.
      (b) `run_booking_maintenance` with a >30-min-old payment_pending booking + active hold → booking
      `expired`, hold `released`, **exactly one** `audit_logs` row (`action='auto_expire_booking'`), and a
      `notification_outbox` row (`template='booking_expired'`); a booking with a `paid` payment row is NOT
      expired (and no expiry audit/notification); re-running is idempotent (no second notification).
- [ ] **1.3 Run the new + existing booking/maintenance tests → green. Commit.**

## Task 2 — Expiry email copy

**Files:** Modify `src/lib/notifications/resend.ts`; Test `tests/unit/resend-provider.test.ts`.

- [ ] **2.1 Add a `booking_expired` branch to `render()`** (after the `booking_refunded` branch):

```ts
if (message.template === 'booking_expired') {
  return {
    subject: `Your Belle Mare Tours reservation ${ref} has expired`,
    text: `Hi ${name},\n\nYour reservation ${ref} wasn't paid in time, so we've released the seats. If you'd still like to go, just book again on our website.\n\nBelle Mare Tours`,
  };
}
```

- [ ] **2.2 Unit test:** `render()` for a `booking_expired` message returns a subject containing the ref
      and "expired". Run → green. Commit.

## Task 3 — Pending-bookings endpoint + service

**Files:** Create `app/api/v1/bookings/pending/route.ts`; Modify `src/lib/services/bookings.ts`; Test `tests/integration/api-routes.test.ts` (or a focused route test).

- [ ] **3.1 Service** — add to `bookings.ts` a `pendingBookingSchema` (`z.object({ ref, status,
paymentState, totalMinor: z.number(), currency, createdAt, holdExpiresAt: z.string().nullable(),
title, startsAt: z.string().nullable() })`) and:

```ts
export async function listMyPendingBookings(ctx: ServiceContext): Promise<PendingBooking[]> {
  const data = await callRpc(ctx, 'api_my_pending_bookings', {});
  return z.array(pendingBookingSchema).parse(data ?? []);
}
```

- [ ] **3.2 Route** (`runtime='edge'`) — require an authenticated user (mirror the bearer-auth gate used
      by the owner-scoped booking routes; reuse `authenticate`/`requireUser` from `@/lib/http/auth` +
      `buildServiceContext`), call `listMyPendingBookings`, `jsonOk(rows)`. 401 without a user.
- [ ] **3.3 Test:** 401 unauthenticated; authed returns the array shape. Run → green. Commit.

## Task 4 — Cart client slice

**Files:** Modify `src/lib/cart/holdClient.ts`, `src/lib/cart/useCart.ts`; Test `tests/unit/cart.test.ts` (or `cart-holds.test.ts`).

- [ ] **4.1 `holdClient.ts`** — add `fetchMyPendingBookings()` using the existing `authHeaders()`:
      `GET /api/v1/bookings/pending`; on non-ok/throw → `[]`. Type `PendingBooking` exported.
- [ ] **4.2 `useCart.ts`** — add `const [pendingBookings, setPending] = useState<PendingBooking[]>([])`.
      Fetch on mount, on `window` `focus`/`visibilitychange`, and a ~30s interval that runs **only while
      CartView is mounted** (gate via an opt-in arg `useCart({ withPending: true })` so the site-wide header
      instance fetches once on mount + focus but does NOT 30s-poll). Return `pendingBookings`,
      `pendingCount: pendingBookings.length`, and `count: items.length + pendingBookings.length`.
- [ ] **4.3 Test:** `count` includes pending; a 401/empty fetch leaves `count = items.length`. Commit.

## Task 5 — Cart "Awaiting payment" UI

**Files:** Modify `src/components/cart/CartView.tsx`.

- [ ] **5.1** Call `useCart({ withPending: true })`. Render an "Awaiting payment" section ABOVE the saved
      items when `pendingBookings.length > 0`: each row = title, `startsAt` date, `Price eur={totalMinor/100}`,
      a countdown (reuse the `HoldTimer` markup driven by `holdExpiresAt`; at 0 show "Reservation expired —
      rebook"), and `<ResumePaymentButton bookingRef={ref} />`. Change the empty guard to
      `items.length === 0 && pendingBookings.length === 0 → <EmptyCart />`.
- [ ] **5.2** Verify in the browser (turbopack) + confirm the header badge shows the pending count. Commit.

## Task 6 — Money-safe cron reorder

**Files:** Modify `app/api/v1/internal/maintenance/route.ts`; Test `tests/integration/maintenance.test.ts` or `payment-reconcile-sweep.test.ts`.

- [ ] **6.1** Reorder to **reconcile → expire → materialize**, each wrapped in its own try/catch (so a
      failure in one step never blocks the others), accumulating a result object. Keep the existing
      `INTERNAL_TASK_SECRET` gate.
- [ ] **6.2 Test:** a payment_pending booking that the (mocked) reconcile confirms as paid ends
      `confirmed`, NOT `expired`, on a single maintenance run; a thrown step doesn't abort the others. Commit.

## Task 7 — Verify + review + ship

- [ ] **7.1** `npm run typecheck && npm run lint && npm run test && npm run build` — all green.
- [ ] **7.2** Adversarial money-path review (workflow): skeptics attempt to (a) make auto-cancel cancel a
      paid/mid-payment booking, (b) make `api_my_pending_bookings` leak another user's booking, (c) break the
      cron reorder's isolation. Fix anything confirmed.
- [ ] **7.3** Present diff + verification; push to `main` on owner go-ahead. Owner re-runs `catch-up.sql`.

## Spec coverage check

C-in-cart → Tasks 3,4,5. Hold expiry exposed RLS-safely → Task 1(1). Auto-cancel audited → Task 1(2).
Expiry email → Task 1(3)+Task 2. Money-path reorder → Task 6. Badge → Task 4. All spec sections mapped.
