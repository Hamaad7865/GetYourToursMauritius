-- Payment trap (found in production 2026-07-24, booking BMTE5CAD9FB1A5E3): a customer who abandoned
-- the Peach widget could NEVER pay that booking again. Every "Complete payment" click bounced them
-- straight back to their booking page.
--
-- Peach reported the abandoned session as `100.396.101 Cancelled by user` — terminal, unpayable —
-- but nothing cleared payments.provider_checkout_id, so api_create_payment's double-charge guard kept
-- handing that dead session back and the widget reported "cancelled" the moment it mounted.
--
-- Two independent defects kept the trap alive; this migration closes the second (the service closes
-- the first by checking liveness before reusing a session):
--
--   The 25-minute "is this checkout still fresh" window was anchored to payments.updated_at, a
--   GENERIC row-mtime. The reconcile sweep re-queries a stuck checkout every 2-5 minutes; on a dead
--   session that append is deduped to nothing (the status re-query reuses the checkout id as its
--   provider_event_id, which the earlier webhook event already occupies) — but append_payment_event
--   still runs `update payments set ... updated_at = now()`. So the sweep re-armed the reuse window
--   indefinitely: observed live moving 21:00:13 -> 21:06:01 with the customer doing nothing, which is
--   why the 25-minute stale-session escape hatch never fired.
--
-- Fix: give the checkout its own mint timestamp (checkout_created_at) and anchor the window to THAT,
-- so no unrelated write to the payment row can extend it. Adds api_clear_payment_checkout so the
-- service can retire a session Peach has declared dead.

alter table payments add column if not exists checkout_created_at timestamptz;

comment on column payments.checkout_created_at is
  'When the CURRENT provider_checkout_id was minted. Anchors api_create_payment''s 25-minute reuse '
  'window; deliberately separate from updated_at so an unrelated row write (a deduped ledger append '
  'from the reconcile sweep) cannot re-arm the window on a dead session.';

-- Backfill so in-flight bookings keep their existing reuse behaviour across this deploy: updated_at
-- is what the window used to read, and api_record_payment_checkout bumped it at mint time.
update payments
   set checkout_created_at = updated_at
 where provider_checkout_id is not null
   and checkout_created_at is null;

-- Verbatim from 20260812000000 with ONE change: `checkout_created_at = now()` alongside the existing
-- writes, so the reuse window anchors to the mint instead of to the row's mtime.
create or replace function api_record_payment_checkout(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_checkout: paymentId required';
  end if;

  -- Grants are the primary gate (service_role only); defence in depth as in api_record_payment_charge.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;

  -- OVERWRITE (latest checkout wins): a re-pay opens a new checkout the sweep must query, so the most
  -- recent checkout id replaces any prior one -- no record-once guard here. Recording also RELEASES
  -- the single-flight checkout lease api_create_payment stamped, and stamps checkout_created_at --
  -- the anchor for the 25-minute reuse window.
  update payments
  set prev_provider_checkout_id = case
        when provider_checkout_id is not null
             and provider_checkout_id is distinct from left(btrim(p ->> 'checkoutId'), 128)
        then provider_checkout_id
        else prev_provider_checkout_id
      end,
      provider_checkout_id = left(btrim(p ->> 'checkoutId'), 128),
      checkout_created_at = now(),
      checkout_claimed_until = null,
      updated_at = now()
  where id = v_payment_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_record_payment_checkout(jsonb) from public, anon, authenticated;
grant execute on function api_record_payment_checkout(jsonb) to service_role;

-- Retire a checkout the provider has declared dead, so the next api_create_payment mints a fresh,
-- payable session instead of handing the corpse back.
--
-- COMPARE-AND-CLEAR: `checkoutId` must still match the stored pointer or nothing happens. Two tabs
-- can race here — one finds the session cancelled while the other has already minted a replacement —
-- and clearing blind would drop a LIVE session's id, stranding a payable checkout the sweep could no
-- longer query.
--
-- The dead id moves to prev_provider_checkout_id rather than being discarded: api_pending_payment_checkouts
-- sweeps BOTH pointers, so a late capture on the retired session is still ingested rather than lost.
create or replace function api_clear_payment_checkout(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
  v_expected text := nullif(btrim(p ->> 'checkoutId'), '');
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'clear_payment_checkout: paymentId required';
  end if;
  if v_expected is null then
    raise exception 'invalid_request' using detail = 'clear_payment_checkout: checkoutId required';
  end if;

  -- Grants are the primary gate (service_role only); defence in depth as in api_record_payment_checkout.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;

  update payments
  set prev_provider_checkout_id = provider_checkout_id,
      provider_checkout_id = null,
      checkout_created_at = null,
      updated_at = now()
  where id = v_payment_id
    and provider_checkout_id = v_expected;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_clear_payment_checkout(jsonb) from public, anon, authenticated;
grant execute on function api_clear_payment_checkout(jsonb) to service_role;

-- Verbatim from 20260812000000 with ONE change: the reuse window reads checkout_created_at (coalesced
-- to updated_at only for a row minted before this migration and missed by the backfill — never reuse
-- LESS conservatively than before) instead of updated_at.
create or replace function api_create_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_payment payments;
begin
  -- FOR UPDATE: every concurrent create-payment call for one booking serialises on this row for the
  -- rest of the transaction. That closes two races at once: two callers both inserting a payments row
  -- below, and — via the checkout lease — two callers both getting a green light to mint a Peach
  -- session. Peach's nonce is unique per REQUEST (it never dedupes), so without this lease two tabs
  -- or a retry could create two independently payable sessions for the same booking.
  select * into v_booking from bookings where ref = p ->> 'bookingRef' for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
     or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'booking_not_payable' using detail = v_booking.status::text;
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  select * into v_payment from payments
  where booking_id = v_booking.id and status <> 'failed'
  order by created_at desc
  limit 1;

  if not found then
    -- Scoped to THIS booking: an unscoped key lookup let a caller echo another payment's key and
    -- receive that payment's id/amount back.
    select * into v_payment from payments
    where idempotency_key = p ->> 'idempotencyKey' and booking_id = v_booking.id;
  end if;

  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  -- Checkout lease (single-flight): exactly one caller may be out creating a Peach session at any
  -- moment. Order matters — reuse beats pending beats claim:
  --   1. a still-fresh recorded checkout        -> hand the SAME session back (reuse; no Peach call);
  --   2. someone else holds an unexpired lease  -> checkoutPending (caller retries shortly);
  --   3. otherwise                              -> stamp the lease and let THIS caller call Peach.
  -- api_record_payment_checkout clears the lease when the session id is recorded; a Peach failure
  -- releases it via api_release_checkout_claim, and the 90-second expiry is the crash backstop.
  --
  -- Freshness is measured from checkout_created_at (when the session was MINTED), never from
  -- updated_at: the reconcile sweep touches updated_at on every pass, which used to re-arm this
  -- window forever and trap the customer on a dead session. The caller still verifies liveness with
  -- the provider before actually reusing what this returns.
  if v_payment.provider_checkout_id is not null
     and coalesce(v_payment.checkout_created_at, v_payment.updated_at) > now() - interval '25 minutes' then
    return jsonb_build_object(
      'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
      'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
      'existingCheckoutId', v_payment.provider_checkout_id
    );
  end if;

  if v_payment.checkout_claimed_until is not null and v_payment.checkout_claimed_until > now() then
    return jsonb_build_object(
      'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
      'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
      'existingCheckoutId', null,
      'checkoutPending', true
    );
  end if;

  update payments set checkout_claimed_until = now() + interval '90 seconds'
  where id = v_payment.id;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
    'existingCheckoutId', null
  );
end;
$$;

revoke execute on function api_create_payment(jsonb) from public, anon;
grant execute on function api_create_payment(jsonb) to authenticated, service_role;
