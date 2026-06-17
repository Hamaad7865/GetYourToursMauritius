-- Restore the guest half of the F23 idempotency-replay guard in api_book.
--
-- Regression: api_book runs SECURITY DEFINER (RLS does not filter its returned DTO), so create_booking's
-- idempotency replay — which returns the EXISTING booking for a repeated key — can echo another person's
-- name/email/ref/items to whoever replays the key. 20260617180000_child_seats.sql closed this for BOTH
-- cases: an authenticated user replaying someone else's OWNED booking, AND an anonymous guest (user_id
-- NULL) whose supplied email doesn't match the booking on file. But 20260617210000_planner_vehicle_pricing
-- forked before that fix and did `create or replace function api_book` with the pre-fix guard, which only
-- covered the authenticated case. Being later in filename order, it silently reverted the guest branch —
-- a stolen/guessed key alone again hands back the original customer's PII (test F23 "guest-booking
-- idempotency replay with a mismatched email is refused").
--
-- This re-applies the winning planner_vehicle_pricing body of api_book VERBATIM except for the guard,
-- which is restored to the full child_seats version. No other behaviour changes.

create or replace function api_book(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_total_qty bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom') then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden (original F23);
  --   * an anonymous caller whose supplied email doesn't match the booking on file -> forbidden. This
  --     closes guest replays (user_id NULL): a stolen/guessed key alone would otherwise hand back the
  --     original customer's name/email/ref/items. A legitimate guest retry resends the same email and
  --     passes; a fresh create trivially passes (the row was just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (auth.uid() is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  return booking_json(v_booking.id);
end;
$$;
