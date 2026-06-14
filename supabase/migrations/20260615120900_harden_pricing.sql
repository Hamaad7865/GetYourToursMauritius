-- Hardening pass (correctness/safety fixes):
--  1. create_booking now sources prices from the DB (activity_option_prices) and
--     forces items onto the occurrence's option — the client can no longer dictate
--     price or option ("prices only from the DB, never the client"). Also enforces
--     per-tier max_guests.
--  2. append_payment_event only confirms a booking when paid_minor >= amount_minor
--     (a partial payment must NOT confirm). Underpayment stays 'pending'.
--  3. create_hold rejects occurrences whose start time is already in the past.
-- These are additive `create or replace`s so they override the originals whether or
-- not the earlier migration was already applied.

create or replace function create_hold(
  p_occurrence_id uuid,
  p_quantity int,
  p_idempotency_key text
)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing booking_holds;
  v_occ session_occurrences;
  v_available int;
  v_hold booking_holds;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity' using detail = 'quantity must be > 0';
  end if;

  select * into v_existing from booking_holds where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_occ from session_occurrences where id = p_occurrence_id for update;
  if not found then
    raise exception 'occurrence_not_found';
  end if;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  if v_occ.starts_at <= now() then
    raise exception 'occurrence_in_past';
  end if;

  v_available := v_occ.capacity - used_capacity(p_occurrence_id);
  if p_quantity > v_available then
    raise exception 'insufficient_capacity'
      using detail = format('requested %s, available %s', p_quantity, v_available);
  end if;

  insert into booking_holds (session_occurrence_id, quantity, idempotency_key)
  values (p_occurrence_id, p_quantity, p_idempotency_key)
  returning * into v_hold;
  return v_hold;
end;
$$;

create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  -- items: [{ "price_label": "Adult", "quantity": 2 }]; price + option come from the DB.
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
  v_unit int;
  v_max int;
  v_total int := 0;
  v_qty_total int := 0;
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

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id;
  v_option_id := v_occ.activity_option_id;

  -- Validate + price each line from the DB (never from the client payload).
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;

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

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
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

create or replace function append_payment_event(
  p_payment_id uuid,
  p_type text,
  p_provider_event_id text,
  p_amount_minor int,
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
  v_paid int;
  v_refunded int;
  v_failed boolean;
  v_state payment_state;
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
  elsif v_refunded > 0 then
    v_state := 'partially_refunded';
  elsif v_paid >= v_payment.amount_minor then
    v_state := 'paid';
  elsif v_paid > 0 then
    -- Money received but not the full amount yet: do NOT confirm.
    v_state := 'pending';
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
    update bookings set status = 'confirmed', updated_at = now()
    where id = v_payment.booking_id and status in ('draft', 'held', 'payment_pending');
    update booking_holds set status = 'consumed'
    where booking_id = v_payment.booking_id and status = 'active';
  elsif v_state = 'refunded' then
    update bookings set status = 'refunded', updated_at = now()
    where id = v_payment.booking_id and status <> 'cancelled';
  end if;

  return v_payment;
end;
$$;
