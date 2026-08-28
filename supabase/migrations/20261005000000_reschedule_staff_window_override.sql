-- 20261005000000_reschedule_staff_window_override
-- Staff may reschedule a booking INSIDE the 24h self-service window, behind a deliberate confirm step.
--
-- api_reschedule_booking's 24h "free-change window" guard was written for the customer self-service
-- path and was bypassed in exactly one case: a booking WE weather-cancelled (bookings.disruption set).
-- It had no exemption for staff, so an operator on /admin/calendar was held to the same wall as a
-- customer -- any booking whose departure is under 24h away was un-moveable from the back office, and
-- stayed that way once the date passed. (Found live: BMTFB153A1AD3381, a paid dolphin swim ~19h out,
-- "Could not move that booking.")
--
-- The fix adds ONE clause to that guard: a new optional flag p.staffOverride, honoured ONLY under
-- is_staff(). A customer (the /api/v1/bookings/:ref/reschedule path, or a hand-crafted request) who
-- sets the flag hits is_staff() = false and stays blocked exactly as before -- the bypass is not
-- self-servable. Everything else the RPC enforces is untouched: ownership, confirmed+paid, one-option,
-- same-option (same price => no payment ledger movement), and the capacity re-check under FOR UPDATE.
--
-- The function is re-applied here from its WINNING body (20260819000000_weather_disruption_reschedule
-- lines 54-239) VERBATIM except for (a) the v_staff_override declare and (b) the guard clause. This is
-- the drift guard ([[gytm-migration-revert-drift]]): keep this identical to the copy in
-- supabase/catch-up.sql, and re-run supabase/setup.sql (npm run setup:sql) after applying.
--
-- Re-run supabase/catch-up.sql after applying (idempotent).

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

-- Signature is unchanged, so `create or replace` keeps the existing grants; re-applied here for
-- idempotency and to match 20260819000000. api_reschedule_booking is customer-callable (it re-checks
-- ownership itself); the staff override inside it is gated separately by is_staff().
revoke execute on function api_reschedule_booking(jsonb) from public, anon;
grant execute on function api_reschedule_booking(jsonb) to authenticated, service_role;
