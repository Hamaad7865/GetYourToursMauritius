-- Airport-transfer booking form: capture the owner-confirmed traveller + trip details, add the
-- arrival/departure/return TRIP DIRECTION, and close the Zone 2 coverage gap (AT-2).
--
-- AT-1 (20260731000000) made the transfer bookable on a TWO-ZONE fare matrix and stored the basic
-- flight/trip fields (trip_type, flight_number, arrival_time, return_date, return_time,
-- departure_flight_number). This migration ADDS the rest of the form: trip_direction
-- (arrival | departure | return), the lead-traveller fields (gender, company, country, special notes)
-- and the trip extras (room/cabin number, luggage details, child-seat age). Every field is additive and
-- nullable, so existing bookings keep working unchanged.
--
-- Trip-direction model: `trip_direction` is the customer-facing choice (arrival/departure/return).
-- PRICING still keys off the existing `trip_type` — arrival/departure are a single leg (one_way), return
-- is both legs minus the configured discount — so AT-1's zone pricing is untouched. The checkout sends
-- BOTH: trip_direction (stored) and the derived tripType (priced). For a free-text "my hotel isn't listed"
-- drop-off, the server classifies the ZONE from the supplied AREA (Zone 2 = the near-airport south-east
-- areas), never trusting a client price.
--
-- api_book / booking_json are re-applied from their WINNING bodies (20260731000000_airport_transfer_zones)
-- VERBATIM, adding ONLY the new field reads/writes + the area→zone fallback — no zone-pricing or guard
-- reverts ([[gytm-migration-revert-drift]]). Mirror this whole file into supabase/catch-up.sql per the
-- DB-sync convention ([[gytm-db-sync]]).

-- 1) bookings: the new traveller + trip detail columns (all nullable/additive). trip_direction defaults
--    to 'arrival' so an old client that sends no direction still classifies sensibly; the check allows the
--    three confirmed values.
alter table bookings add column if not exists trip_direction text;
alter table bookings drop constraint if exists bookings_trip_direction_check;
alter table bookings add constraint bookings_trip_direction_check
  check (trip_direction is null or trip_direction in ('arrival', 'departure', 'return'));
alter table bookings add column if not exists traveller_gender text;
alter table bookings add column if not exists traveller_company text;
alter table bookings add column if not exists traveller_country text;
alter table bookings add column if not exists special_notes text;
alter table bookings add column if not exists room_or_cabin text;
alter table bookings add column if not exists luggage_details text;
alter table bookings add column if not exists child_seat_age int;

-- 2) airport_transfer_hotels: add the named Zone 2 hotels the owner confirmed that weren't yet seeded
--    (Anantara IKO, Holiday Inn Mauritius, Astroea Beach, Le Peninsula Bay) and ensure they're zoned 2.
--    These have no SEO landing page yet, so they're searchable at checkout only (the hotel-search reads
--    this table via the activity DTO is not needed — the checkout typeahead reads the static transfers
--    list; these rows make the SERVER price them correctly when booked by slug).
insert into airport_transfer_hotels (slug, hotel_name, region, zone) values
  ('anantara-iko-mauritius', 'Anantara Iko Mauritius Resort', 'South', 'zone2'),
  ('holiday-inn-mauritius', 'Holiday Inn Mauritius Mon Trésor', 'South', 'zone2'),
  ('astroea-beach', 'Astroea Beach', 'South', 'zone2'),
  ('le-peninsula-bay', 'Le Peninsula Bay Beach Resort', 'South', 'zone2')
on conflict (slug) do update set hotel_name = excluded.hotel_name, zone = excluded.zone;
-- Re-affirm the near-airport cluster's zone (idempotent; the AT-1 migration already set the two seeded
-- hotels, this keeps catch-up self-consistent for the added rows + the originals).
update airport_transfer_hotels set zone = 'zone2'
  where slug in ('shandrani-beachcomber', 'preskil-island-resort',
                 'anantara-iko-mauritius', 'holiday-inn-mauritius', 'astroea-beach', 'le-peninsula-bay');

-- 3) airport_transfer_area_zone(): classify a free-text drop-off AREA to a pricing zone for the
--    "my hotel isn't listed" path. Zone 2 = the near-airport south-east areas (Mahébourg, Blue Bay,
--    Pointe d'Esny, Ferney, Grand Port). Everything else is Zone 1. Case/space-insensitive, accent-light
--    (the client may send "Mahebourg" or "Mahébourg"). Mirrors airportAreaZone() in pricing.ts.
create or replace function airport_transfer_area_zone(p_area text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(btrim(coalesce(p_area, '')));
begin
  if v = '' then
    return 'zone1';
  end if;
  -- Normalise the common accented spelling so "mahébourg" and "mahebourg" both match.
  v := replace(v, 'é', 'e');
  if v like '%mahebourg%' or v like '%blue bay%' or v like '%pointe d%esny%'
     or v like '%ferney%' or v like '%grand port%' then
    return 'zone2';
  end if;
  return 'zone1';
end;
$$;
grant execute on function airport_transfer_area_zone(text) to anon, authenticated, service_role;

-- 4) api_book: re-applied from its WINNING body (20260731000000_airport_transfer_zones) VERBATIM, adding
--    ONLY: (a) the area→zone fallback when no dropoffSlug is sent (free-text "not listed" hotel), and
--    (b) persisting the new trip_direction + traveller/trip detail fields. The zone pricing + return
--    discount + F23 guard are unchanged.
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
  v_dropoff_zone text;
  v_trip_type text;
  v_trip_direction text;
  v_ret_pct int;
  v_fare bigint;
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
         coalesce(a.is_airport_transfer, false)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport
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
    -- trip_direction (customer-facing) drives the priced trip_type: return = both legs, arrival/departure
    -- = a single leg (one_way). An old client sending only tripType still works (direction falls back).
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
    -- Free-text "not listed" drop-off: classify from the area.
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

-- 5) booking_json: re-applied from its WINNING body (20260721000000_booking_dropoff via the zone
--    migration's chain) VERBATIM, plus the new trip_direction + traveller/trip detail fields so the
--    voucher (PDF/email) + admin booking drawer can show them.
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
