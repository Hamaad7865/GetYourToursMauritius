-- Customer-initiated "Cancel activity & claim refund".
--
-- A signed-in customer cancels their OWN confirmed + paid booking while the trip is still more than
-- 24 hours away. The booking moves to refund_pending (the money-owed obligation is explicit and the
-- seat frees for resale), and the owner is notified; the owner then refunds in the Peach dashboard and
-- marks it refunded via api_mark_refunded (the existing flow). Self-service is blocked inside the 24h
-- window / after the start time — the owner handles those case-by-case in admin. No automated refund.

-- ── api_cancel_booking ──────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER (bypasses RLS), so ownership + the 24h window are enforced INSIDE, zero-trust. Modeled
-- on api_mark_refunded: typed errors, idempotent. A definer UPDATE also bypasses the browser-session
-- field-pinning trigger, so it can set the status directly.
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
begin
  if v_ref is null then
    raise exception 'invalid_request' using detail = 'cancel: ref required';
  end if;

  select * into v_booking from bookings where ref = v_ref;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Ownership: the booking's own customer, or staff. (A definer function bypasses RLS — check here.)
  if not (is_staff() or (v_uid is not null and v_booking.user_id = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: already cancelled / refund in flight / refunded → return current state, no re-enqueue.
  if v_booking.status in ('refund_pending', 'cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', v_booking.status, 'alreadyCancelled', true);
  end if;

  -- Only a confirmed, paid booking can be self-cancelled for a refund.
  if not (v_booking.status = 'confirmed' and v_booking.payment_state = 'paid') then
    raise exception 'not_cancellable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- The 24-hour window: the EARLIEST occurrence on this booking must start more than 24h from now.
  select min(so.starts_at) into v_starts_at
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_booking.id;
  if v_starts_at is null or v_starts_at <= now() + interval '24 hours' then
    raise exception 'cancellation_window_passed'
      using detail = 'self-service cancellation closes 24 hours before the activity';
  end if;

  -- Cancel → refund_pending (refund_pending frees used_capacity, so the seat is resellable at once). The
  -- actual money movement is recorded later through api_mark_refunded → append_payment_event.
  update bookings set status = 'refund_pending', updated_at = now() where id = v_booking.id;

  -- Heads-up to the owner to process the refund (best-effort; the admin refund_pending queue is the
  -- authoritative work-list). The idempotency key stops a double-cancel enqueuing twice.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'bookings@getyourtoursmauritius.com', 'booking_cancellation',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'booking_cancellation:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', 'refund_pending');
end;
$$;

revoke execute on function api_cancel_booking(jsonb) from public;
grant execute on function api_cancel_booking(jsonb) to authenticated, service_role;

-- ── booking_json: add `cancellable` ─────────────────────────────────────────────────────────────────
-- Re-applied from the current WINNING body (drift guard) with one new field: `cancellable` — true only
-- when the booking is confirmed + paid AND its earliest occurrence starts more than 24h from now. The UI
-- uses it to show the cancel button only when self-service applies; api_cancel_booking re-checks anyway.
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
    'cancellable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and coalesce((
        select min(so.starts_at)
          from booking_items bi
          join session_occurrences so on so.id = bi.session_occurrence_id
         where bi.booking_id = b.id
      ), 'epoch'::timestamptz) > now() + interval '24 hours'
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
