-- Security & integrity fixes from the Phase 1 adversarial review.
-- Additive: ALTERs + create-or-replace functions + a trigger + RLS tightening.

-- ---------------------------------------------------------------------------
-- Money columns -> bigint (int capped at ~21.4M EUR-cents; full-boat charters overflow)
-- ---------------------------------------------------------------------------
alter table activity_option_prices alter column amount_minor type bigint;
alter table bookings
  alter column total_minor type bigint,
  alter column agency_commission_minor type bigint,
  alter column operator_payout_minor type bigint;
alter table booking_items
  alter column unit_amount_minor type bigint,
  alter column subtotal_minor type bigint;
alter table payments
  alter column amount_minor type bigint,
  alter column paid_minor type bigint,
  alter column refunded_minor type bigint;
alter table payment_events alter column amount_minor type bigint;

-- ---------------------------------------------------------------------------
-- Integrity constraints
-- ---------------------------------------------------------------------------
-- Deleting a booking must not orphan an 'active' hold that keeps reserving a seat.
alter table booking_holds drop constraint if exists booking_holds_booking_id_fkey;
alter table booking_holds
  add constraint booking_holds_booking_id_fkey
  foreign key (booking_id) references bookings (id) on delete cascade;

-- Makes the seed occurrence generator idempotent and prevents duplicate departures.
alter table session_occurrences
  add constraint session_occurrences_option_start_key unique (activity_option_id, starts_at);

-- ---------------------------------------------------------------------------
-- RLS: bookings/payments are created ONLY via the SECURITY DEFINER RPCs.
-- Dropping the customer insert policy means RLS denies any direct customer insert
-- (no matching policy); the create_booking RPC bypasses RLS as the table owner.
-- ---------------------------------------------------------------------------
drop policy if exists bookings_insert on bookings;

-- Prevent privilege escalation: a customer must not be able to set/raise their own
-- role. Column-level GRANTs are ineffective here because a table-level GRANT already
-- covers every column, so we enforce with a trigger. service_role / the migration
-- owner (current_user not in the public roles) and existing staff may set roles.
create or replace function enforce_profile_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new; -- service_role / owner / superuser
  end if;
  if is_staff() then
    return new; -- staff & admin may assign roles
  end if;
  if tg_op = 'INSERT' then
    new.role := 'customer';
  else
    new.role := old.role; -- self-update cannot change role
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on profiles;
create trigger profiles_role_guard
  before insert or update on profiles
  for each row execute function enforce_profile_role();

-- ---------------------------------------------------------------------------
-- create_booking: lock + validate the occurrence is still bookable, aggregate
-- quantities PER price tier (so per-tier max_guests is enforced on the summed
-- quantity, not per duplicated line), price from the DB. bigint money.
-- ---------------------------------------------------------------------------
create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  -- Aggregate quantity per price_label (collapses duplicate lines).
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;

  -- Price + validate each aggregated tier from the DB.
  for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
    select amount_minor, max_guests into v_unit, v_max
    from activity_option_prices
    where activity_option_id = v_option_id and label = v_label;
    if not found then
      raise exception 'unknown_price_tier' using detail = v_label;
    end if;
    if v_max is not null and v_qty > v_max then
      raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_total := v_total + (v_unit * v_qty);
  end loop;

  if v_qty_total <> v_hold.quantity then
    raise exception 'items_quantity_mismatch'
      using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
    select amount_minor into v_unit
    from activity_option_prices
    where activity_option_id = v_option_id and label = v_label;
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor
    )
    values (v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit, v_unit * v_qty);
  end loop;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- append_payment_event: on first full payment, RE-CHECK capacity under an
-- occurrence lock before confirming. If the seat is gone (hold expired + resold),
-- route to refund_pending instead of overselling. A payment landing on a dead
-- (expired/cancelled) booking also routes to refund_pending. Refund releases holds.
-- ---------------------------------------------------------------------------
-- Drop the previous int-signature version (we widen p_amount_minor to bigint).
drop function if exists append_payment_event(uuid, text, text, integer, timestamptz, jsonb);

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
  on conflict (payment_id, provider_event_id) do nothing;

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
  elsif v_paid >= v_payment.amount_minor then
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

revoke execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) from public;
grant execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) to service_role;
