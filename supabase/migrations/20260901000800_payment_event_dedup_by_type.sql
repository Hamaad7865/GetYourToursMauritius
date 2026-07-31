-- Dedup the payment ledger by EVENT TYPE as well as provider transaction id.
--
-- append_payment_event absorbs each webhook with `insert … on conflict (<key>) do nothing`, so the
-- conflict target IS the idempotency rule. It shipped as (payment_id, provider_event_id) — no event
-- type. Peach reuses ONE transaction id across the Pending and the Successful notification for a
-- payment, so the Successful collided with the already-stored Pending and was silently discarded:
--
--   * the ledger never credited the money — v_paid stayed 0, so the booking was never confirmed;
--   * nothing raised, so reconcile.ts returned `confirmed: true` for a payment the database had just
--     thrown away: success was REPORTED while nothing was recorded;
--   * the booking stayed payment_pending, and run_booking_maintenance expired it and released the
--     seat on the 30-minute timer — with the customer's money taken.
--
-- Verified on the live schema before writing this: the constraint was
--   payment_events_payment_id_provider_event_id_key UNIQUE (payment_id, provider_event_id)
-- and a real booking (BMT66C2B86F5E2C9) carried three stored `pending` events, one of which reused
-- the checkout id as its provider_event_id — i.e. the collision space is real, not theoretical.
--
-- Adding `type` PRESERVES genuine idempotency: a provider retrying the same Successful with the same
-- transaction id still lands exactly once (same type + same id). It only stops two DIFFERENT events
-- being mistaken for each other. The new key is strictly weaker than the old one, so every existing
-- row satisfies it and the constraint swap cannot fail on live data.
--
-- NULL provider_event_id (our own 'intent' rows) is unaffected: NULLs never collide in either key.

alter table payment_events drop constraint if exists payment_events_payment_id_provider_event_id_key;
-- Idempotent (catch-up.sql re-runs this file): drop-then-add, the same pattern 20260830000000 uses.
alter table payment_events drop constraint if exists payment_events_payment_id_provider_event_id_type_key;
alter table payment_events add constraint payment_events_payment_id_provider_event_id_type_key
  unique (payment_id, provider_event_id, type);

comment on constraint payment_events_payment_id_provider_event_id_type_key on payment_events is
  'Webhook idempotency. Includes `type` because Peach reuses one transaction id across its Pending '
  'and Successful notifications — keying on the id alone discarded the Successful and left the '
  'customer charged with an unconfirmed, then auto-expired, booking.';

-- Verbatim from 20260805000000 with ONE change: the on-conflict target now carries `type`.
-- Signature is byte-identical, so the execute grants pinned in 20260814000000 survive the replace;
-- they are re-issued below anyway (see the definer-grant-leak history).
create or replace function append_payment_event(
  p_payment_id uuid,
  p_type text,
  p_provider_event_id text,
  p_amount_minor bigint,
  p_occurred_at timestamptz,
  p_payload jsonb
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_paid bigint;
  v_refunded bigint;
  v_failed boolean;
  v_state payment_state;
  v_booking_status booking_status;
  v_occ_id uuid;
  v_needed bigint;
  v_cap bigint;
  v_used_conf bigint;
  v_used_hold bigint;
  v_oversold boolean := false;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  insert into payment_events (payment_id, type, provider_event_id, amount_minor, occurred_at, payload)
  values (
    p_payment_id, p_type, p_provider_event_id, coalesce(p_amount_minor, 0),
    coalesce(p_occurred_at, now()), coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (payment_id, provider_event_id, type) do nothing;

  select
    coalesce(sum(amount_minor) filter (where type in ('paid', 'captured')), 0),
    coalesce(sum(amount_minor) filter (where type = 'refunded'), 0),
    bool_or(type = 'failed')
  into v_paid, v_refunded, v_failed
  from payment_events
  where payment_id = p_payment_id;

  if v_paid > 0 and v_refunded >= v_paid then
    v_state := 'refunded';
  elsif v_paid > 0 and v_refunded > 0 then
    v_state := 'partially_refunded';
  -- amount_minor > 0: a zero-amount payment must never read as fully paid (0 >= 0) -- the 'failed'
  -- branch below has to win for it.
  elsif v_payment.amount_minor > 0 and v_paid >= v_payment.amount_minor then
    v_state := 'paid';
  elsif v_paid > 0 then
    v_state := 'pending'; -- underpaid: do not confirm
  elsif coalesce(v_failed, false) then
    v_state := 'failed';
  else
    v_state := 'pending';
  end if;

  update payments
  set status = v_state, paid_minor = v_paid, refunded_minor = v_refunded, updated_at = now()
  where id = p_payment_id
  returning * into v_payment;

  update bookings set payment_state = v_state, updated_at = now() where id = v_payment.booking_id;

  if v_state = 'paid' then
    select status into v_booking_status from bookings where id = v_payment.booking_id;

    if v_booking_status in ('draft', 'held', 'payment_pending') then
      -- Re-validate capacity per occurrence, excluding this booking's own items/holds.
      for v_occ_id in
        select distinct session_occurrence_id from booking_items where booking_id = v_payment.booking_id
      loop
        perform 1 from session_occurrences where id = v_occ_id for update;
        select coalesce(sum(quantity), 0) into v_needed
        from booking_items where booking_id = v_payment.booking_id and session_occurrence_id = v_occ_id;
        select capacity into v_cap from session_occurrences where id = v_occ_id;
        select coalesce(sum(bi.quantity), 0) into v_used_conf
        from booking_items bi join bookings b on b.id = bi.booking_id
        where bi.session_occurrence_id = v_occ_id
          and b.status in ('confirmed', 'completed')
          and b.id <> v_payment.booking_id;
        select coalesce(sum(h.quantity), 0) into v_used_hold
        from booking_holds h
        where h.session_occurrence_id = v_occ_id
          and h.status = 'active' and h.expires_at > now()
          and (h.booking_id is null or h.booking_id <> v_payment.booking_id);
        if v_needed > v_cap - v_used_conf - v_used_hold then
          v_oversold := true;
        end if;
      end loop;

      if v_oversold then
        update bookings set status = 'refund_pending', updated_at = now() where id = v_payment.booking_id;
      else
        update bookings set status = 'confirmed', updated_at = now() where id = v_payment.booking_id;
        update booking_holds set status = 'consumed'
        where booking_id = v_payment.booking_id and status = 'active';
      end if;
    elsif v_booking_status not in ('confirmed', 'completed') then
      -- Money captured on an expired/cancelled booking: must be refunded, not confirmed.
      update bookings set status = 'refund_pending', updated_at = now() where id = v_payment.booking_id;
    end if;
  elsif v_state = 'refunded' then
    update bookings set status = 'refunded', updated_at = now()
    where id = v_payment.booking_id and status <> 'cancelled';
    update booking_holds set status = 'released'
    where booking_id = v_payment.booking_id and status = 'active';
  end if;

  return v_payment;
end;
$$;

revoke execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) to service_role;
