-- Hold-on-Continue: a dedicated anonymous hold RPC + api_book reuse of an existing hold (so the spot
-- is reserved when the customer clicks Continue, and the same hold is settled at pay — no double-hold).

-- 1) api_create_hold: reserve the spot for a date. qty is authoritative from the pricing mode
--    (vehicle → 1 vehicle; else the people count). Anonymous-friendly (no email needed).
create or replace function api_create_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_people bigint := coalesce((p ->> 'people')::bigint, 0);
  v_mode text := 'per_person';
  v_qty int;
  v_hold booking_holds;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;
  if v_people <= 0 or v_people > 1000000 then
    raise exception 'invalid_party';
  end if;
  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_qty := case when coalesce(v_mode, 'per_person') = 'vehicle' then 1 else v_people::int end;

  v_hold := create_hold(v_occ, v_qty, v_key);
  return jsonb_build_object('holdId', v_hold.id, 'quantity', v_hold.quantity, 'expiresAt', v_hold.expires_at);
end;
$$;

grant execute on function api_create_hold(jsonb) to anon, authenticated, service_role;

-- 2) api_book: reuse a hold passed by Continue (holdId) instead of creating a fresh one. Falls back
--    to creating one if holdId is absent/expired/mismatched, so a stale hold never blocks booking.
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
  v_want_qty := case when v_mode = 'vehicle' then 1 else v_total_qty::int end;

  -- Reuse the Continue hold when it's still valid for this exact occurrence + qty and not yet linked
  -- to a booking (so a leaked/already-consumed hold can't be re-attached).
  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  -- Fall back to a FRESH hold on any reuse miss. The key must differ from the Continue hold's
  -- '<key>:hold' (api_create_hold) — otherwise create_hold's idempotency short-circuit would hand back
  -- the very hold that just failed the guard (e.g. expired), hard-locking the booking.
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
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

  return booking_json(v_booking.id);
end;
$$;
