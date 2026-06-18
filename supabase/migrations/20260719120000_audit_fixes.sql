-- Correctness-audit fixes (no oversell was found; these close undersell / flow / authz gaps):
--   1. NO SAME-DAY BOOKINGS. The earliest bookable day is TOMORROW (Mauritius). api_list_availability
--      stops advertising today's slot, and create_hold refuses a today-or-earlier occurrence, so the
--      client widgets/planner and the server agree (the widgets were already tomorrow-earliest).
--   2. F23 hardening: an AUTHENTICATED caller replaying an anonymous GUEST booking's idempotency key
--      could adopt + read its PII — the email check was skipped for logged-in callers. Make it apply to
--      any caller replaying an UNOWNED (guest) booking.
--   3. release_hold is no longer executable by `authenticated` (no app route calls it; it had no owner
--      check, so a leaked hold id let any logged-in user cancel a reservation).
--
-- Each function is re-applied from its WINNING body verbatim, with only the minimal change, so no
-- existing guard is dropped (avoids the migration-revert-drift class). Mirror these into catch-up.sql.

-- 1a. create_hold: keep the past-slot guard (occurrence_in_past), add a tomorrow-earliest guard.
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
  -- We don't fulfil same-day bookings: the earliest bookable day is tomorrow (Mauritius local time).
  if v_occ.starts_at < (((now() at time zone 'Indian/Mauritius')::date + 1)::timestamp at time zone 'Indian/Mauritius') then
    raise exception 'occurrence_too_soon';
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

-- 1b. api_list_availability: clamp the lower bound to TOMORROW (Mauritius) so today is never advertised
--     (winning body from 20260718120000, only `v_today` -> `v_today + 1` on the lower clamp).
create or replace function api_list_availability(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_activity activities;
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
  v_from date := coalesce((p ->> 'from')::date, v_today);
  v_to date := coalesce((p ->> 'to')::date, v_today + 30);
  v_result jsonb;
begin
  select * into v_activity from activities where slug = p ->> 'slug';
  if not found or v_activity.status <> 'published' then
    return '[]'::jsonb;
  end if;

  v_from := greatest(v_from, v_today + 1); -- earliest bookable day is tomorrow (no same-day)
  v_to := least(v_to, v_today + 400);

  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrenceId', so.id, 'activityOptionId', so.activity_option_id, 'optionName', o.name,
    'startsAt', so.starts_at, 'endsAt', so.ends_at, 'capacity', so.capacity,
    'seatsLeft', greatest(so.capacity - used_capacity(so.id), 0), 'status', so.status
  ) order by so.starts_at), '[]'::jsonb)
  into v_result
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  where o.activity_id = v_activity.id
    and so.status = 'open'
    and so.starts_at > now() -- mirror create_hold: never advertise a slot booking would reject
    and so.starts_at >= (v_from::timestamp at time zone 'Indian/Mauritius')
    and so.starts_at < ((v_to + 1)::timestamp at time zone 'Indian/Mauritius');

  return v_result;
end;
$$;

-- 2. api_book F23 guard: the email-knowledge check must apply to ANY caller replaying an UNOWNED guest
--    booking, not only anonymous callers (winning body from 20260618010000; only the guard precondition
--    `auth.uid() is null` -> `v_booking.user_id is null` changes).
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
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (v_booking.user_id is null
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

-- 3. release_hold has no ownership check (booking_holds carries no user_id) and no app route calls it;
--    a leaked hold id would let any logged-in user cancel a reservation. Owner / service_role only.
--    Revoke the implicit PUBLIC grant too (a create-function default the original migration never
--    dropped, which authenticated inherits) — revoking the explicit grant alone would do nothing.
revoke execute on function release_hold(uuid) from public, authenticated;
