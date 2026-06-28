-- Bug-sweep fixes (DB): hotel-to-hotel pickup TIME persistence + quote/charge coords parity.
--
-- 1) api_book — persist the hotel-to-hotel pickup TIME (arrival_time). The htransfer branch stored
--    return_time but NOT the forward-leg pickup time the customer enters at checkout, so it was lost
--    from the run sheet / voucher / receipt (mis-timed pickups). Re-applied from its winning body
--    (20260745000000_hotel_transfer_coords) + that single field; every other branch is byte-identical.
-- 2) api_transfer_quote — resolve hotel-to-hotel regions via hotel_end_region(slug,lat,lng,area), the
--    SAME slug -> coords -> area_region precedence api_book uses, so the public quote equals the booked
--    charge for free Google-Places picks (it previously over-quoted: area_region()=NULL -> 'far').
--
-- Migration-revert-drift guard: both bodies are byte-identical to supabase/catch-up.sql (parity test
-- compares the two). The owner re-runs catch-up.sql to apply on the live DB.

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
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
  v_is_airport boolean := false;
  v_is_hotel boolean := false;
  v_dropoff_zone text;
  v_trip_type text;
  v_trip_direction text;
  v_ret_pct int;
  v_fare bigint;
  v_hotel_pickup_region text;
  v_hotel_dropoff_region text;
  v_band text;
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

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false),
         coalesce(a.is_hotel_transfer, false)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel
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

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  -- Airport transfer (server-authoritative, zero-trust): the destination ZONE comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent zone. When the guest's hotel isn't listed
  -- (no dropoffSlug), classify the zone from the supplied AREA instead (Zone 2 = the near-airport
  -- south-east areas), still never trusting a client price. The whole fare is the zone × vehicle matrix
  -- (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    v_trip_direction := case
      when (p ->> 'tripDirection') in ('arrival', 'departure', 'return') then p ->> 'tripDirection'
      when (p ->> 'tripType') = 'return' then 'return'
      else 'arrival'
    end;
    v_trip_type := case when v_trip_direction = 'return' then 'return' else 'one_way' end;
    if nullif(p ->> 'dropoffSlug', '') is not null then
      select zone into v_dropoff_zone from airport_transfer_hotels
        where slug = nullif(p ->> 'dropoffSlug', '');
    end if;
    if v_dropoff_zone is null then
      v_dropoff_zone := airport_transfer_area_zone(p ->> 'dropoffArea');
    end if;
    v_fare := airport_transfer_fare_minor(v_dropoff_zone, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        trip_direction = v_trip_direction,
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        child_seat_age = nullif(p ->> 'childSeatAge', '')::int,
        traveller_gender = left(nullif(btrim(p ->> 'travellerGender'), ''), 20),
        traveller_company = left(nullif(btrim(p ->> 'travellerCompany'), ''), 120),
        traveller_country = left(nullif(btrim(p ->> 'travellerCountry'), ''), 80),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  -- Hotel-to-hotel transfer (server-authoritative, zero-trust): derive BOTH endpoints' regions from the
  -- hotel SLUGS via airport_transfer_hotels (or area_region() for a free-text end), reject a same-hotel
  -- trip, classify the distance band (region_distance_band), and price band × vehicle (× return discount).
  -- OVERRIDE the booking total + payout + line item. Mirrors hotelTransferQuoteMinor() in pricing.ts.
  if v_is_hotel then
    if nullif(p ->> 'pickupSlug', '') is not null
       and nullif(p ->> 'pickupSlug', '') = nullif(p ->> 'dropoffSlug', '') then
      raise exception 'same_hotel';
    end if;
    v_trip_type := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
    v_hotel_pickup_region := hotel_end_region(
      p ->> 'pickupSlug',
      nullif(p ->> 'pickupLat', '')::double precision,
      nullif(p ->> 'pickupLng', '')::double precision,
      p ->> 'pickupArea');
    v_hotel_dropoff_region := hotel_end_region(
      p ->> 'dropoffSlug',
      nullif(p ->> 'dropoffLat', '')::double precision,
      nullif(p ->> 'dropoffLng', '')::double precision,
      p ->> 'dropoffArea');
    v_band := region_distance_band(v_hotel_pickup_region, v_hotel_dropoff_region);
    v_fare := hotel_transfer_fare_minor(v_band, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        pickup_hotel_slug = left(nullif(btrim(p ->> 'pickupSlug'), ''), 120),
        pickup_region = v_hotel_pickup_region,
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
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

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

create or replace function api_transfer_quote(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text := p ->> 'transferSlug';
  v_pax int := 0;
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_trip_type text := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
  v_zone text;
  v_band text;
  v_pickup_region text;
  v_dropoff_region text;
  v_one_way bigint;
  v_ret_pct int;
  v_total bigint;
  v_zone_or_band text;
  v_vehicle text;
begin
  if v_kind not in ('airport-transfer', 'hotel-transfer') then
    raise exception 'invalid_request: unknown transferSlug';
  end if;
  if jsonb_typeof(p -> 'party') = 'object' then
    select coalesce(sum(value::int), 0) into v_pax from jsonb_each_text(p -> 'party');
  end if;
  if v_pax < 1 then
    v_pax := greatest(coalesce(nullif(p ->> 'pax', '')::int, 1), 1);
  end if;
  if v_kind = 'airport-transfer' then
    v_zone := coalesce(
      (select zone from airport_transfer_hotels where slug = nullif(p ->> 'dropoffSlug', '')),
      airport_transfer_area_zone(p ->> 'dropoffArea'));
    v_one_way := airport_transfer_fare_minor(v_zone, v_pax, v_suv);
    select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
    v_zone_or_band := v_zone;
  else
    -- Resolve each end exactly as api_book does (slug -> coords -> area_region) so the quote equals the
    -- booked charge for free Google-Places picks, not just listed hotels/known areas.
    v_pickup_region := hotel_end_region(
      p ->> 'pickupSlug',
      nullif(p ->> 'pickupLat', '')::double precision,
      nullif(p ->> 'pickupLng', '')::double precision,
      p ->> 'pickupArea');
    v_dropoff_region := hotel_end_region(
      p ->> 'dropoffSlug',
      nullif(p ->> 'dropoffLat', '')::double precision,
      nullif(p ->> 'dropoffLng', '')::double precision,
      p ->> 'dropoffArea');
    v_band := region_distance_band(v_pickup_region, v_dropoff_region);
    v_one_way := hotel_transfer_fare_minor(v_band, v_pax, v_suv);
    select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
    v_zone_or_band := v_band;
  end if;
  v_ret_pct := coalesce(v_ret_pct, 0);
  v_total := case when v_trip_type = 'return'
    then round(v_one_way::numeric * 2 * (100 - v_ret_pct) / 100)::bigint
    else v_one_way end;
  v_vehicle := case
    when v_pax <= 4 then case when v_suv then 'SUV' else 'Sedan' end
    when v_pax <= 6 then 'Family'
    when v_pax <= 14 then 'Van'
    when v_pax <= 25 then 'Coaster'
    else 'Coaster x' || ceil(v_pax::numeric / 25)::int
  end;
  return jsonb_build_object(
    'totalEur', v_total::float / 100,
    'vehicle', v_vehicle,
    'zoneOrBand', v_zone_or_band,
    'tripType', v_trip_type,
    'oneWayEur', v_one_way::float / 100,
    'returnDiscountPct', v_ret_pct
  );
end;
$$;
grant execute on function api_transfer_quote(jsonb) to anon, authenticated, service_role;
