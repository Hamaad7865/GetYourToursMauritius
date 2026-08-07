-- The guest's own booking page could not describe a booking made from a quote.
--
-- api_convert_quote sends every non-occurrence line — custom, rental and the transport add-on — to
-- booking_custom_items, because booking_items' NOT NULL occurrence + option are load-bearing for
-- capacity, the day sheet and the voucher. booking_json only ever aggregated booking_items, so a
-- quote booking arrived at /bookings/{ref} as a bare "Total EUR 616.00" with NOTHING itemising it —
-- and, because payment_state flips to 'paid' the moment the DEPOSIT clears, no mention that a
-- balance was still owed at all. Observed on BMT2D0A9EF6FF61C: 0 booking_items, 1 custom item, and
-- EUR 0.90 of EUR 1.00 outstanding and invisible.
--
-- This widens the shared DTO with four ADDITIVE keys: customItems, depositEur, balanceDueEur and
-- firstActivityAt. Additive on purpose — every other reader of booking_json (api_book, the receipt,
-- the confirmation email) keeps the exact keys it already had, and a Zod schema that does not know
-- the new ones ignores them.
--
-- The body below is the verbatim 20260910000000 definition plus those keys; nothing else is
-- touched. Mirror into supabase/catch-up.sql per the DB-sync convention (and `npm run setup:sql`).

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
    'supplements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', bs.name, 'qty', bs.qty,
        'unitEur', bs.unit_minor::float / 100, 'totalEur', bs.total_minor::float / 100
      ) order by bs.position, bs.name)
      from booking_supplements bs where bs.booking_id = b.id
    ), '[]'::jsonb),
    'pendingPickup', (
      select jsonb_build_object(
        'pickupLocation', r.pickup_location,
        'dropoffLocation', r.dropoff_location,
        'feeEur', r.fee_minor::float / 100,
        'paymentId', r.payment_id,
        'createdAt', r.created_at
      )
      from booking_pickup_requests r
      where r.booking_id = b.id and r.applied_at is null and r.fee_minor > 0
      order by r.created_at desc
      limit 1
    ),
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
    -- The BOOKING-UNIT count, the unit seatsLeft is denominated in. For a per-person option it equals
    -- partySize; for a vehicle/private one it is 1 (one van / one trip, any group size). The date
    -- picker must filter on THIS, not partySize, or a 6-guest transfer is offered nothing.
    'unitsNeeded', coalesce((
      select sum(bi.quantity)
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
        booking_awaiting_choice(b.disruption)
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
        booking_awaiting_choice(b.disruption)
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
    ), '[]'::jsonb),
    -- ── A QUOTE BOOKING'S OWN LINES ─────────────────────────────────────────────────────────────
    -- api_convert_quote writes every non-occurrence line (custom, rental, transport) to
    -- booking_custom_items, so a booking minted from a quote has NO booking_items at all and the
    -- 'items' array above is empty. The guest's own page then showed a bare total with nothing
    -- explaining it. Ordered by `position` — the order the guest read the offer in.
    'customItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', ci.description,
        'quantity', ci.quantity,
        'unitAmountEur', ci.unit_amount_minor::float / 100,
        'subtotalEur', ci.subtotal_minor::float / 100,
        'startsAt', ci.starts_at
      ) order by ci.position)
      from booking_custom_items ci where ci.booking_id = b.id
    ), '[]'::jsonb),
    -- What was taken up front and what is still owed. payment_state reads 'paid' the moment the
    -- DEPOSIT clears, so without these the page calls a 10%-paid booking settled.
    'depositEur', b.deposit_minor::float / 100,
    'balanceDueEur', b.balance_due_minor::float / 100,
    -- The earliest thing the guest is booked on, across BOTH line tables — the balance falls due 24h
    -- before it. `serviceDate` above sees only session occurrences and is left alone (receipts read
    -- it); this is the quote-aware one. Null when no line carries a date, and the page then shows no
    -- deadline rather than inventing one.
    'firstActivityAt', least(
      (select min(so.starts_at) from booking_items bi
         join session_occurrences so on so.id = bi.session_occurrence_id
        where bi.booking_id = b.id),
      (select min(ci.starts_at) from booking_custom_items ci where ci.booking_id = b.id)
    )
  )
  from bookings b where b.id = p_booking_id;
$$;
