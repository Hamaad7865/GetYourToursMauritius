-- Align a TRANSFER booking's vehicle price_label with the words the customer actually picked.
--
-- create_booking stamps a vehicle-mode line's price_label from the SIGHTSEEING vocabulary
-- (Sedan / Family car / Van / Coaster). For airport + hotel transfers the customer never sees those
-- words: the widget and the activity_options speak the airport vocabulary (Standard car / SUV /
-- Family car / Minibus / Coaster, per airportVehicleLabel() in pricing.ts). api_book already OVERRIDES
-- the transfer line's price + total from the zone/band matrix; it just never overrode the label, so a
-- transfer booking read "Standard car (4 seats, 2 suitcases) · 1 × Sedan" — the option and the label
-- disagreeing on the same line. Override price_label in BOTH transfer branches to the airport vocabulary
-- so the two agree everywhere the line is shown (drawer, calendar, voucher, receipt, invoice).
--
-- Sightseeing vehicle tours are untouched — they keep Sedan / Van. Transfers-only, by owner's choice.
-- Reproduces api_book VERBATIM from 20260908000000_multi_supplements_trip_capacity (the winning body)
-- with only the two price_label lines added; the resolved-function-bodies + setup-sql parity tests hold.

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
  v_is_private boolean := false;
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_supp_total bigint := 0;
  v_activity_id uuid;
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
  v_actor uuid;
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
         coalesce(a.is_hotel_transfer, false),
         (o.private_base_minor is not null),
         a.id
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel, v_is_private,
         v_activity_id
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom')
                       or coalesce(v_is_private, false) then 1 else v_total_qty::int end;

  -- Actor identity, resolved BEFORE the hold-reuse gate so ownership can bind reuse. api_book is
  -- service-role-only, so auth.uid() is null; the JWKS-verified caller id arrives as p.actorUserId
  -- (trustworthy BECAUSE only the server can execute this function). auth.uid() stays first as
  -- belt-and-suspenders.
  v_actor := coalesce(auth.uid(), nullif(p ->> 'actorUserId', '')::uuid);

  if v_hold_id is not null then
    -- FOR UPDATE: two concurrent api_book calls quoting the same holdId must serialise here, or both
    -- read booking_id IS NULL and both proceed (create_booking's own lock cannot save the second one
    -- on its own — it re-checks under the lock, but only because of the guard added alongside this).
    -- Ownership: an OWNED hold (created_by set) is only reusable by its owner; an ownerless hold
    -- (guest checkout, or created before sign-in) stays reusable by whoever holds the unguessable id,
    -- which keeps the guest → sign-in-mid-checkout flow working.
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty
      and (created_by is null or created_by = v_actor)
    for update;
    if found then v_reused := true; end if;
  end if;
  -- A REPLAY whose booking already exists must not mint a hold.
  --
  -- create_booking's idempotency check runs before it ever looks at p_hold_id, so on a replay it
  -- returns the existing booking and never attaches whatever hold we passed. The original hold is by
  -- then consumed (booking_id set), so the reuse SELECT above cannot match it and v_reused is false --
  -- and create_hold would mint a fresh one that nothing ever claims. It then sits ACTIVE, counted by
  -- used_capacity, for its whole TTL. Worse, on a nearly-full departure create_hold raises
  -- insufficient_capacity, so a legitimate retry of a booking that ALREADY SUCCEEDED fails instead of
  -- returning it -- the caller is told the booking failed when it did not.
  -- (Only ever one orphan: a second replay finds it by idempotency key. One is enough to sell out a
  -- last vehicle.)
  if not v_reused and not exists (select 1 from bookings where idempotency_key = v_key) then
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
  if (v_booking.user_id is not null and v_booking.user_id is distinct from v_actor)
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if v_actor is not null then
    update bookings set user_id = v_actor where id = v_booking.id and user_id is null;
  end if;

  -- Ownership for the FALLBACK hold: when no reusable holdId was supplied, api_book mints its own
  -- hold above via create_hold, which runs under service_role here (server-only RPC) and so wrote
  -- created_by = auth.uid() = NULL. Stamp the actor onto it so the customer's owner-scoped hold
  -- status/release endpoints work. A REUSED hold already carries its owner (created_by not null),
  -- so the guard leaves it alone; a guest booking (v_actor null) leaves the hold ownerless as before.
  if v_actor is not null then
    update booking_holds set created_by = v_actor where id = v_hold.id and created_by is null;
  end if;

  -- The language the guest booked in. Email and PDFs render later, often from a cron worker with no
  -- request context, so the locale must be stored rather than inferred at send time. Unconditional: by
  -- this point the F23 guard above has already verified the caller may act on this booking, so re-
  -- asserting the same value on an idempotent replay is harmless. Absent/empty collapses to 'en' (never
  -- SQL NULL, never a failed enum cast), so an older client that sends no locale still books cleanly.
  update bookings
  set locale = coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale
  where id = v_booking.id;

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
    -- Replay guard, matching the pattern every other post-create mutation in this function already
    -- uses (`and custom_itinerary is null`, `and pickup_location is null`, `and pickup_pending = false`).
    -- create_booking returns the EXISTING row on an idempotency-key replay, so unguarded this silently
    -- re-prices a booking that has already started paying -- moving total_minor out from under the MUR
    -- charge pinned on its payment row and a Peach session already minted for the old amount.
    if v_fare > 0 and not exists (select 1 from payments pay where pay.booking_id = v_booking.id) then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare,
            -- Align the line's vehicle name with the airport vocabulary the customer picked
            -- (airportVehicleLabel in pricing.ts) so the option and the price_label agree — the line
            -- otherwise read "Standard car (…) · 1 × Sedan". Sightseeing keeps its own Sedan/Van.
            price_label = case
              when v_total_qty <= 4 then case when v_suv then 'SUV' else 'Standard car' end
              when v_total_qty <= 6 then 'Family car'
              when v_total_qty <= 14 then 'Minibus'
              else 'Coaster'
            end
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
    -- Replay guard, matching the pattern every other post-create mutation in this function already
    -- uses (`and custom_itinerary is null`, `and pickup_location is null`, `and pickup_pending = false`).
    -- create_booking returns the EXISTING row on an idempotency-key replay, so unguarded this silently
    -- re-prices a booking that has already started paying -- moving total_minor out from under the MUR
    -- charge pinned on its payment row and a Peach session already minted for the old amount.
    if v_fare > 0 and not exists (select 1 from payments pay where pay.booking_id = v_booking.id) then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare,
            -- Align the line's vehicle name with the airport vocabulary the customer picked
            -- (airportVehicleLabel in pricing.ts) so the option and the price_label agree — the line
            -- otherwise read "Standard car (…) · 1 × Sedan". Sightseeing keeps its own Sedan/Van.
            price_label = case
              when v_total_qty <= 4 then case when v_suv then 'SUV' else 'Standard car' end
              when v_total_qty <= 6 then 'Family car'
              when v_total_qty <= 14 then 'Minibus'
              else 'Coaster'
            end
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

  -- Per-activity supplements (e.g. the lobster lunch upgrade), MANY per activity since 20260908.
  -- Priced PER PERSON from each activity_supplements row, resolved by id AND scoped to the activity
  -- behind the occurrence — an unknown or foreign id simply doesn't join and charges nothing.
  -- Duplicate ids in the payload aggregate; every count clamps to the head count. Replay guards:
  -- rows already snapshot (the normal replay) or a payment already exists (a mutated replay must
  -- never re-price a booking mid-payment — [[gytm-drift-gate-double-charge]]). A configured-but-free
  -- supplement (price 0) still records the guest's request — the kitchen needs the head count.
  -- Sits after the transfer overrides for the same reason the child seats do: those OVERWRITE
  -- total_minor, so additive add-ons belong at the end.
  if p ? 'supplements'
     and jsonb_typeof(p -> 'supplements') = 'array'
     and jsonb_array_length(p -> 'supplements') between 1 and 20
     and not exists (select 1 from booking_supplements bs where bs.booking_id = v_booking.id)
     and not exists (select 1 from payments pay where pay.booking_id = v_booking.id)
  then
    for r in
      select s.id, s.name, s.price_minor, s.position,
             least(
               sum(least(greatest(coalesce(nullif(e ->> 'qty', '')::int, 0), 0), v_total_qty::int)),
               v_total_qty
             )::int as q
      from jsonb_array_elements(p -> 'supplements') e
      join activity_supplements s
        on s.id = nullif(e ->> 'id', '')::uuid
       and s.activity_id = v_activity_id
      group by s.id, s.name, s.price_minor, s.position
      order by s.position, s.id
    loop
      if r.q > 0 then
        insert into booking_supplements (booking_id, supplement_id, name, qty, unit_minor, total_minor, position)
        values (v_booking.id, r.id, r.name, r.q, r.price_minor, r.price_minor::bigint * r.q, r.position)
        on conflict (booking_id, supplement_id) where supplement_id is not null do nothing;
        v_supp_total := v_supp_total + r.price_minor::bigint * r.q;
      end if;
    end loop;
    if v_supp_total > 0 then
      update bookings
      set total_minor = total_minor + v_supp_total,
          operator_payout_minor = operator_payout_minor + v_supp_total
      where id = v_booking.id;
    end if;
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

revoke execute on function api_book(jsonb) from public, anon, authenticated;
grant execute on function api_book(jsonb) to service_role;
