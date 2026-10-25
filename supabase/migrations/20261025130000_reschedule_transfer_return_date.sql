-- 20261025130000_reschedule_transfer_return_date
-- Moving an airport transfer keeps its first-leg date on the slot it moves to.
--
-- An airport transfer's day-slot is the only date its first leg has; a departure-only trip's hotel
-- pickup date rides in bookings.return_date, and so does a return trip's second leg. 20261025120000
-- made api_book refuse a booking whose returnDate disagrees with its slot. But api_reschedule_booking
-- repoints booking_items at another occurrence without touching return_date, so moving a departure
-- (staff on /admin/calendar, or the owner via POST /bookings/:ref/reschedule) left the slot on the
-- new day and the pickup on the old one — the BMT61C672F6CC1B6 shape again, through another door.
--
-- For an airport transfer (the booking's option → activities.is_airport_transfer), direction resolved
-- exactly as api_book resolves it (trip_direction, else trip_type = 'return', else arrival):
--   * departure → return_date := the new slot's Mauritius day. SET, not shifted by the day delta: it
--     stays equal to the slot, and moving one of the two broken prod bookings (slot 9 Oct, return_date
--     15 Oct) to 15 Oct repairs it instead of pushing the pickup to 21 Oct.
--   * return    → return_date is left alone (a changed arrival flight rarely moves the departure), but
--     a move that would put the arrival AFTER it is refused with `transfer_return_before_arrival`,
--     before anything is written. A null return_date passes, as in api_book.
--   * arrival   → unchanged.
--
-- Change-of-tour (apply_booking_change) is NOT redefined: change_request_quote refuses any
-- private/vehicle source, and every airport transfer is vehicle-mode, so no change request can exist
-- for one. tests/integration/reschedule-transfer-date.test.ts pins that refusal.
--
-- Re-applies api_reschedule_booking from its WINNING body (20261005000000_reschedule_staff_window_override)
-- VERBATIM except for the three transfer declares, the refusal block and the return_date assignment.
-- Keep it identical to the copy in supabase/catch-up.sql; grants unchanged (customer-callable).

create or replace function api_reschedule_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(p ->> 'ref', '');
  v_occ_id uuid := nullif(p ->> 'occurrenceId', '')::uuid;
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_target session_occurrences;
  v_option_count int;
  v_current_option uuid;
  v_current_starts timestamptz;
  v_party int;
  v_units int;
  v_available int;
  v_disrupted boolean;
  -- Staff-only bypass of the 24h window, requested explicitly from the admin calendar's "move anyway"
  -- confirm step. Read here but honoured ONLY under is_staff() in the guard below, so a customer who
  -- sends it cannot self-grant it.
  v_staff_override boolean := coalesce((p ->> 'staffOverride')::boolean, false);
  -- Airport transfer only: the resolved direction and the target slot's Mauritius day. v_direction
  -- stays NULL for anything else, which leaves return_date untouched below.
  v_is_airport boolean;
  v_direction text;
  v_new_day date;
begin
  if v_ref is null or v_occ_id is null then
    raise exception 'invalid_request' using detail = 'reschedule: ref and occurrenceId required';
  end if;

  select * into v_booking from bookings where ref = v_ref;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Ownership: the booking's own customer, or staff. (A definer function bypasses RLS -- check here.)
  if not (is_staff() or (v_uid is not null and v_booking.user_id = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Same gate as api_cancel_booking: a draft/held/payment_pending booking has no seat to move, and a
  -- cancelled/refunded one is finished.
  if not (v_booking.status = 'confirmed' and v_booking.payment_state = 'paid') then
    raise exception 'not_reschedulable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- One option per booking is the only shape a same-option move can honour. (No production booking
  -- spans options today; fail loudly rather than silently moving half of one.)
  select count(distinct bi.activity_option_id) into v_option_count
    from booking_items bi where bi.booking_id = v_booking.id;
  if v_option_count <> 1 then
    raise exception 'not_reschedulable'
      using detail = format('booking spans %s options', v_option_count);
  end if;

  -- order by/limit 1 rather than min(): Postgres has no min(uuid) aggregate.
  select bi.activity_option_id into v_current_option
    from booking_items bi where bi.booking_id = v_booking.id order by bi.id limit 1;

  -- TWO different counts, and mixing them is a live bug class:
  --   v_units = sum(quantity) -- the BOOKING-UNIT count, the same unit occurrence.capacity and
  --     used_capacity() are denominated in. For a per-person option that IS the headcount; for a
  --     vehicle/private option it is 1 (one van / one trip, any group size) -- see create_booking and
  --     'daily_capacity counts vehicles, not people'. This is what the capacity gate must use.
  --   v_party = sum(pax ?? quantity) -- the PEOPLE count, for humans reading the audit line.
  -- Gating capacity on v_party would demand 6 free VANS for a 6-guest transfer and make any party
  -- larger than daily_capacity permanently un-reschedulable, on a departure that is in fact empty.
  select min(so.starts_at),
         coalesce(sum(coalesce(bi.pax, bi.quantity)), 0),
         coalesce(sum(bi.quantity), 0)
    into v_current_starts, v_party, v_units
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_booking.id;

  -- Idempotent: already entirely on the requested date -> report, do not re-enqueue.
  if v_current_starts is not null and not exists (
    select 1 from booking_items
     where booking_id = v_booking.id and session_occurrence_id is distinct from v_occ_id
  ) then
    return jsonb_build_object(
      'ok', true, 'ref', v_booking.ref, 'occurrenceId', v_occ_id, 'alreadyOnDate', true
    );
  end if;

  -- Lock the TARGET before reading its capacity (mirrors create_hold) -- two guests racing for the
  -- last seat must serialise here, not both pass the check.
  select * into v_target from session_occurrences where id = v_occ_id for update;
  if not found then
    raise exception 'occurrence_not_found';
  end if;
  -- Distinct from create_hold's `occurrence_not_bookable`: that code is already mapped to the generic
  -- "Invalid booking request", which reads terribly for a guest told their replacement date just went
  -- away. Own code => own message.
  if v_target.status <> 'open' or v_target.starts_at <= now() then
    raise exception 'target_not_bookable' using detail = v_target.status::text;
  end if;

  -- SAME OPTION ONLY. Price lives on the option, not the occurrence, so a same-option move is
  -- price-neutral and never touches payments/append_payment_event. A different option is a different
  -- price and must go through cancel-and-rebook.
  if v_target.activity_option_id <> v_current_option then
    raise exception 'option_mismatch'
      using detail = 'a reschedule must stay on the same activity option';
  end if;

  -- The free-change window mirrors the cancellation window -- EXCEPT (a) when we called the trip off
  -- ourselves (the guest must be able to move at short notice), or (b) when a STAFF operator explicitly
  -- asks to, from the admin calendar (a change a guest phones in the day before). Both bypasses are
  -- un-self-servable: disruption is written only by the staff-gated api_weather_cancel_occurrence, and
  -- staffOverride is honoured only under is_staff() -- a customer passing it hits is_staff() = false and
  -- stays blocked exactly as before.
  v_disrupted := booking_awaiting_choice(v_booking.disruption);
  if not v_disrupted
     and not (v_staff_override and is_staff())
     and (v_current_starts is null or v_current_starts <= now() + interval '24 hours') then
    raise exception 'reschedule_window_passed'
      using detail = 'self-service changes close 24 hours before the activity';
  end if;

  -- Units, not people -- see the v_units/v_party note above.
  v_available := v_target.capacity - used_capacity(v_occ_id);
  if v_units > v_available then
    raise exception 'insufficient_capacity'
      using detail = format('requested %s, available %s', v_units, v_available);
  end if;

  -- An airport transfer's slot IS its first leg's day (see the header). Resolve the direction the way
  -- api_book does; a return whose second leg would now come before the arrival is refused here,
  -- before anything is written. A departure's return_date is re-set in the bookings UPDATE below.
  select coalesce(a.is_airport_transfer, false) into v_is_airport
    from activity_options o join activities a on a.id = o.activity_id
   where o.id = v_current_option;
  if v_is_airport then
    v_direction := case
      when v_booking.trip_direction in ('arrival', 'departure', 'return') then v_booking.trip_direction
      when v_booking.trip_type = 'return' then 'return'
      else 'arrival'
    end;
    v_new_day := (v_target.starts_at at time zone 'Indian/Mauritius')::date;
    if v_direction = 'return' and v_booking.return_date < v_new_day then
      raise exception 'transfer_return_before_arrival'
        using detail = format('return leg %s, new arrival day %s', v_booking.return_date, v_new_day);
    end if;
  end if;

  -- Move every item. booking_items has no per-item status, so a partial move has no representation;
  -- all-or-nothing is the only honest semantics available.
  update booking_items set session_occurrence_id = v_occ_id where booking_id = v_booking.id;

  -- status is deliberately UNTOUCHED: enqueue_booking_notification is a status-transition trigger, so
  -- leaving status alone keeps it quiet and lets us queue the tailored mails below ourselves.
  update bookings
     set disruption = case
           when v_disrupted then v_booking.disruption
             || jsonb_build_object('resolvedAt', now(), 'resolution', 'rescheduled')
           else v_booking.disruption
         end,
         -- A departure's hotel pickup date follows its slot; every other booking keeps its own.
         return_date = case when v_direction = 'departure' then v_new_day else return_date end,
         updated_at = now()
   where id = v_booking.id;

  -- Counts and dates only, no PII (audit_logs convention).
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (
    v_uid,
    case when is_staff() then 'staff' else 'user' end,
    'reschedule_booking',
    'booking',
    v_booking.id,
    'moved ' || v_party || ' pax from ' || coalesce(v_current_starts::text, 'unknown')
      || ' to ' || v_target.starts_at::text
  );

  -- Keyed by TARGET occurrence so a second, different move mails again -- but bouncing back to a date
  -- already used stays silent, which also bounds any loop.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', v_booking.customer_email, 'booking_rescheduled',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'startsAt', v_target.starts_at, 'previousStartsAt', v_current_starts
    ),
    v_booking.id, 'booking_rescheduled:' || v_booking.id || ':' || v_occ_id
  )
  on conflict (idempotency_key) do nothing;

  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'owner_date_changed',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'startsAt', v_target.starts_at, 'previousStartsAt', v_current_starts
    ),
    v_booking.id, 'owner_date_changed:' || v_booking.id || ':' || v_occ_id
  )
  on conflict (idempotency_key) do nothing;

  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'telegram', 'owner', 'owner_date_changed',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'startsAt', v_target.starts_at, 'previousStartsAt', v_current_starts
    ),
    v_booking.id, 'owner_date_changed_tg:' || v_booking.id || ':' || v_occ_id
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true, 'ref', v_booking.ref, 'occurrenceId', v_occ_id,
    'startsAt', v_target.starts_at, 'previousStartsAt', v_current_starts
  );
end;
$$;

-- Signature is unchanged, so `create or replace` keeps the existing grants; re-applied here for
-- idempotency and to match 20260819000000. api_reschedule_booking is customer-callable (it re-checks
-- ownership itself); the staff override inside it is gated separately by is_staff().
revoke execute on function api_reschedule_booking(jsonb) from public, anon;
grant execute on function api_reschedule_booking(jsonb) to authenticated, service_role;
