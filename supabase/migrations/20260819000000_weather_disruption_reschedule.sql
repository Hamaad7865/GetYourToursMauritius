-- 20260819000000_weather_disruption_reschedule
-- Weather disruption + rescheduling. /refunds already PROMISES the customer a choice of full refund
-- or free reschedule when we call a trip off; nothing in the app could deliver it (there was no
-- reschedule mechanism anywhere). This closes that gap.
--
--  1. bookings.disruption jsonb -- a disrupted booking KEEPS status='confirmed'. A new booking_status
--     enum value would ripple through used_capacity(), enforce_booking_admin_update,
--     booking_json.cancellable and every admin filter for no gain.
--  2. api_reschedule_booking -- same-option occurrence swap under FOR UPDATE + a capacity re-check.
--     Same option => same price => this path never touches the payment ledger.
--  3. api_weather_cancel_occurrence -- staff fan-out: cancel the departure, stamp + notify its guests.
--  4. api_admin_calendar_month -- staff per-day aggregate for the new /admin/calendar.
--  5. api_cancel_booking re-applied from its WINNING body (20260806000000_security_lockdown lines
--     16-84) VERBATIM plus (a) the disruption bypass of the 24h window and (b) the customer email it
--     never sent (see below).
--  6. booking_json re-applied from its WINNING body (20260735000000_transfer_service_date lines 6-65)
--     VERBATIM plus disruption / activitySlug / activityOptionId / partySize / reschedulable and the
--     cancellable bypass. Kept `security invoker` -- definer-grants-lockdown.test.ts relies on
--     used_capacity staying anon-executable BECAUSE booking_json is invoker.
--
-- Re-applying both winning bodies verbatim is the drift guard ([[gytm-migration-revert-drift]]): a
-- migration that re-applies a stale body silently reverts an earlier fix. Keep this file identical to
-- the copy appended to supabase/catch-up.sql.
--
-- Re-run supabase/catch-up.sql after applying (idempotent).

alter table bookings add column if not exists disruption jsonb;

comment on column bookings.disruption is
  'Set only by api_weather_cancel_occurrence when WE call a departure off. '
  '{reason, occurrenceId, declaredAt, resolvedAt, resolution}. Non-null with a null resolvedAt means '
  'the guest still owes us a choice (new date or refund) and unlocks the 24h-window bypass in '
  'api_cancel_booking / api_reschedule_booking. Never written by a customer-facing path.';

-- ---------------------------------------------------------------------------
-- api_reschedule_booking. p = { ref, occurrenceId }
-- Moves every item of a confirmed+paid booking onto another occurrence OF THE SAME OPTION.
-- ---------------------------------------------------------------------------
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
  v_available int;
  v_disrupted boolean;
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

  -- pax is the PEOPLE count; quantity is the LINE count (a vehicle line is 1 quantity / N pax), so
  -- summing quantity alone undercounts and would slide a 6-guest booking into a 2-seat gap.
  select min(so.starts_at), coalesce(sum(coalesce(bi.pax, bi.quantity)), 0)
    into v_current_starts, v_party
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

  -- The free-change window mirrors the cancellation window -- EXCEPT when we called the trip off
  -- ourselves, in which case the guest must be able to move at short notice. disruption is written
  -- only by the staff-gated api_weather_cancel_occurrence, so this bypass is not self-servable.
  v_disrupted := v_booking.disruption is not null and v_booking.disruption ->> 'resolvedAt' is null;
  if not v_disrupted
     and (v_current_starts is null or v_current_starts <= now() + interval '24 hours') then
    raise exception 'reschedule_window_passed'
      using detail = 'self-service changes close 24 hours before the activity';
  end if;

  v_available := v_target.capacity - used_capacity(v_occ_id);
  if v_party > v_available then
    raise exception 'insufficient_capacity'
      using detail = format('requested %s, available %s', v_party, v_available);
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

-- ---------------------------------------------------------------------------
-- api_weather_cancel_occurrence. p = { occurrenceId, reason }
-- Staff calls this ONCE per blown-out departure; it fans out to every booking on it.
-- ---------------------------------------------------------------------------
create or replace function api_weather_cancel_occurrence(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ_id uuid := nullif(p ->> 'occurrenceId', '')::uuid;
  v_reason text := coalesce(nullif(p ->> 'reason', ''), 'weather');
  v_occ session_occurrences;
  v_disruption jsonb;
  v_affected int := 0;
  r record;
begin
  -- Staff only. (A definer function bypasses RLS -- check here.)
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_occ_id is null then
    raise exception 'invalid_request' using detail = 'weather cancel: occurrenceId required';
  end if;
  if v_reason not in ('weather', 'sea_conditions', 'safety', 'min_group') then
    raise exception 'invalid_request' using detail = 'unknown reason: ' || v_reason;
  end if;

  select * into v_occ from session_occurrences where id = v_occ_id for update;
  if not found then
    raise exception 'occurrence_not_found';
  end if;

  -- Idempotent: a second call on an already-cancelled departure reports, it does not re-notify.
  if v_occ.status = 'cancelled' then
    return jsonb_build_object(
      'ok', true, 'occurrenceId', v_occ_id, 'affected', 0, 'alreadyCancelled', true
    );
  end if;

  -- Closing the occurrence stops anyone else booking the date. Seats already sold stay counted --
  -- correct, because the trip is off and the date is no longer offered.
  update session_occurrences set status = 'cancelled' where id = v_occ_id;

  v_disruption := jsonb_build_object(
    'reason', v_reason,
    'occurrenceId', v_occ_id,
    'declaredAt', now(),
    'resolvedAt', null,
    'resolution', null
  );

  for r in
    select distinct b.id, b.ref, b.customer_email, b.customer_name
      from bookings b
      join booking_items bi on bi.booking_id = b.id
     where bi.session_occurrence_id = v_occ_id
       and b.status = 'confirmed'
       and b.payment_state = 'paid'
       and b.disruption is null
  loop
    update bookings set disruption = v_disruption, updated_at = now() where id = r.id;

    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', r.customer_email, 'booking_weather_disrupted',
      jsonb_build_object(
        'ref', r.ref, 'customerName', r.customer_name,
        'reason', v_reason, 'startsAt', v_occ.starts_at
      ),
      r.id, 'booking_weather_disrupted:' || r.id || ':' || v_occ_id
    )
    on conflict (idempotency_key) do nothing;

    v_affected := v_affected + 1;
  end loop;

  -- Staff bell. AdminBell renders title/body straight through and never inspects type, so a new type
  -- needs no UI change.
  insert into notifications (user_id, type, title, body, data)
  select pr.id, 'admin_departure_called_off', 'Departure called off',
         v_affected || ' booking(s) on '
           || to_char(v_occ.starts_at at time zone 'Indian/Mauritius', 'DD Mon YYYY')
           || ' need a new date or a refund.',
         jsonb_build_object('occurrenceId', v_occ_id)
  from profiles pr
  where pr.role in ('staff', 'admin')
    and not exists (
      select 1 from notifications n
      where n.user_id = pr.id and n.type = 'admin_departure_called_off'
        and n.data ->> 'occurrenceId' = v_occ_id::text
    );

  -- entity_type 'occurrence' is new. Summary is counts + reason + date only, no PII, so the GDPR
  -- erasure scrub (which targets entity_type='booking' diffs) has nothing to reach here.
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (
    auth.uid(), 'staff', 'weather_cancel_occurrence', 'occurrence', v_occ_id,
    'called off for ' || v_reason || '; ' || v_affected || ' booking(s) affected'
  );

  return jsonb_build_object(
    'ok', true, 'occurrenceId', v_occ_id, 'affected', v_affected, 'reason', v_reason
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- api_admin_calendar_month. p = { from, to }  (Mauritius-local dates, inclusive)
-- Per-day aggregate for /admin/calendar. A month across the catalogue is ~1800 occurrences; the day
-- drawer reads detail through PostgREST under occurrences_staff, but the month view aggregates here.
-- ---------------------------------------------------------------------------
create or replace function api_admin_calendar_month(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := nullif(p ->> 'from', '')::date;
  v_to date := nullif(p ->> 'to', '')::date;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_from is null or v_to is null then
    raise exception 'invalid_request' using detail = 'calendar: from and to required';
  end if;
  if v_to < v_from or v_to > v_from + 62 then
    raise exception 'invalid_request' using detail = 'calendar: range must be 0-62 days';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'day', d.day,
        'departures', d.departures,
        'cancelled', d.cancelled,
        'pax', d.pax,
        'seatsLeft', d.seats_left
      ) order by d.day
    )
    from (
      select
        (o.starts_at at time zone 'Indian/Mauritius')::date          as day,
        count(*)                                                     as departures,
        count(*) filter (where o.status = 'cancelled')               as cancelled,
        coalesce(sum(o.booked), 0)                                   as pax,
        coalesce(sum(greatest(o.capacity - o.booked, 0)), 0)         as seats_left
      from (
        select
          so.starts_at, so.status, so.capacity,
          coalesce((
            select sum(coalesce(bi.pax, bi.quantity))
              from booking_items bi
              join bookings b on b.id = bi.booking_id
             where bi.session_occurrence_id = so.id
               and b.status in ('confirmed', 'completed')
          ), 0) as booked
        from session_occurrences so
        -- Half-open Mauritius-local range: sargable against session_occurrences_starts_idx, unlike
        -- (starts_at at time zone ...)::date = d.
        where so.starts_at >= (v_from::timestamp at time zone 'Indian/Mauritius')
          and so.starts_at <  ((v_to + 1)::timestamp at time zone 'Indian/Mauritius')
      ) o
      group by 1
    ) d
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- api_cancel_booking -- re-applied VERBATIM from its winning body
-- (20260806000000_security_lockdown lines 16-84) with exactly two changes:
--   (a) the 24h window is bypassed for a booking WE disrupted and the guest hasn't resolved;
--   (b) a customer confirmation email is enqueued.
-- (b) fixes a live gap: the owner alert below suppresses the refund_pending trigger's generic block
-- (so the owner isn't double-alerted), and that same block held the ONLY customer-facing email -- so
-- a guest who self-cancelled was told nothing at all. That is merely confusing today; once "get a
-- full refund" is a button on a called-off-trip banner it is a guest staring at a dead screen.
-- ---------------------------------------------------------------------------
create or replace function api_cancel_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(p ->> 'ref', '');
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_starts_at timestamptz;
  v_disrupted boolean;
begin
  if v_ref is null then
    raise exception 'invalid_request' using detail = 'cancel: ref required';
  end if;

  select * into v_booking from bookings where ref = v_ref;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Ownership: the booking's own customer, or staff. (A definer function bypasses RLS -- check here.)
  if not (is_staff() or (v_uid is not null and v_booking.user_id = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: already cancelled / refund in flight / refunded -> return current state, no re-enqueue.
  if v_booking.status in ('refund_pending', 'cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', v_booking.status, 'alreadyCancelled', true);
  end if;

  -- Only a confirmed, paid booking can be self-cancelled for a refund.
  if not (v_booking.status = 'confirmed' and v_booking.payment_state = 'paid') then
    raise exception 'not_cancellable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- The 24-hour window: the EARLIEST occurrence on this booking must start more than 24h from now.
  -- BYPASSED when we called the trip off ourselves -- a guest whose Tuesday departure we cancelled on
  -- Monday must still be able to take the refund. disruption is written only by the staff-gated
  -- api_weather_cancel_occurrence, so this is not self-servable.
  v_disrupted := v_booking.disruption is not null and v_booking.disruption ->> 'resolvedAt' is null;
  select min(so.starts_at) into v_starts_at
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_booking.id;
  if not v_disrupted and (v_starts_at is null or v_starts_at <= now() + interval '24 hours') then
    raise exception 'cancellation_window_passed'
      using detail = 'self-service cancellation closes 24 hours before the activity';
  end if;

  -- Heads-up to the owner to process the refund (best-effort; the admin refund_pending queue is the
  -- authoritative work-list). Enqueued BEFORE the status flip so the refund_pending trigger sees this
  -- row and skips its generic trio (no double-alert). The idempotency key stops a double-cancel
  -- enqueuing twice.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'booking_cancellation',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'booking_cancellation:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;

  -- The guest's own confirmation -- see the header. Copy serves both a plain self-cancel and taking
  -- the refund arm of a called-off trip.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', v_booking.customer_email, 'booking_cancelled_confirmation',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'booking_cancelled_confirmation:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;

  -- Cancel -> refund_pending (refund_pending frees used_capacity, so the seat is resellable at once). The
  -- actual money movement is recorded later through api_mark_refunded -> append_payment_event.
  update bookings
     set status = 'refund_pending',
         disruption = case
           when v_disrupted then v_booking.disruption
             || jsonb_build_object('resolvedAt', now(), 'resolution', 'refunded')
           else v_booking.disruption
         end,
         updated_at = now()
   where id = v_booking.id;

  return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', 'refund_pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- booking_json -- re-applied VERBATIM from its winning body
-- (20260735000000_transfer_service_date lines 6-65) plus: disruption, activitySlug,
-- activityOptionId, partySize, reschedulable, and the cancellable disruption bypass.
-- activitySlug + activityOptionId are what let the confirmation page ask the PUBLIC availability
-- endpoint for replacement dates (it is keyed by slug and filtered by option).
-- STAYS `security invoker` -- definer-grants-lockdown.test.ts pins used_capacity as anon-executable
-- precisely because booking_json / api_get_activity are invoker.
-- ---------------------------------------------------------------------------
create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'pickupPending', b.pickup_pending,
    'pickupHotelSlug', b.pickup_hotel_slug,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'pickupRegion', b.pickup_region,
    'tripType', b.trip_type,
    'tripDirection', b.trip_direction,
    'flightNumber', b.flight_number,
    'arrivalTime', b.arrival_time,
    'returnDate', b.return_date,
    'returnTime', b.return_time,
    'departureFlightNumber', b.departure_flight_number,
    'roomOrCabin', b.room_or_cabin,
    'luggageDetails', b.luggage_details,
    'childSeatAge', b.child_seat_age,
    'travellerGender', b.traveller_gender,
    'travellerCompany', b.traveller_company,
    'travellerCountry', b.traveller_country,
    'specialNotes', b.special_notes,
    'disruption', b.disruption,
    'partySize', coalesce((
      select sum(coalesce(bi.pax, bi.quantity))
        from booking_items bi where bi.booking_id = b.id
    ), 0),
    'activityOptionId', (
      select bi.activity_option_id
        from booking_items bi where bi.booking_id = b.id order by bi.id limit 1
    ),
    'activitySlug', (
      select a.slug
        from booking_items bi
        join activity_options ao on ao.id = bi.activity_option_id
        join activities a on a.id = ao.activity_id
       where bi.booking_id = b.id
       order by bi.id limit 1
    ),
    'cancellable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and (
        (b.disruption is not null and b.disruption ->> 'resolvedAt' is null)
        or coalesce((
          select min(so.starts_at)
            from booking_items bi
            join session_occurrences so on so.id = bi.session_occurrence_id
           where bi.booking_id = b.id
        ), 'epoch'::timestamptz) > now() + interval '24 hours'
      )
    ),
    'reschedulable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and (
        (b.disruption is not null and b.disruption ->> 'resolvedAt' is null)
        or coalesce((
          select min(so.starts_at)
            from booking_items bi
            join session_occurrences so on so.id = bi.session_occurrence_id
           where bi.booking_id = b.id
        ), 'epoch'::timestamptz) > now() + interval '24 hours'
      )
    ),
    'serviceDate', (
      select min(so.starts_at)
        from booking_items bi
        join session_occurrences so on so.id = bi.session_occurrence_id
       where bi.booking_id = b.id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- Grants. Supabase's ALTER DEFAULT PRIVILEGES hands every new function EXECUTE to anon +
-- authenticated, and `revoke from public` alone does NOT strip that -- name the roles explicitly
-- ([[gytm-definer-grant-leak]]). api_reschedule_booking is customer-callable (it re-checks ownership
-- itself); the two staff RPCs need `authenticated` because admin calls them straight from the browser
-- under is_staff().
revoke execute on function api_reschedule_booking(jsonb) from public, anon;
grant execute on function api_reschedule_booking(jsonb) to authenticated, service_role;

revoke execute on function api_weather_cancel_occurrence(jsonb) from public, anon;
grant execute on function api_weather_cancel_occurrence(jsonb) to authenticated, service_role;

revoke execute on function api_admin_calendar_month(jsonb) from public, anon;
grant execute on function api_admin_calendar_month(jsonb) to authenticated, service_role;

revoke execute on function api_cancel_booking(jsonb) from public, anon;
grant execute on function api_cancel_booking(jsonb) to authenticated, service_role;
