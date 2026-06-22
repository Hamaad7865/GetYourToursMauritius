-- Make Airport Transfers a bookable product (region × vehicle fare matrix, one-way / return).
--
-- Until now /airport-transfers was static SEO + a WhatsApp enquiry. This turns the seeded
-- `airport-transfer` activity into a real, bookable transfer priced by a fixed DESTINATION-region ×
-- vehicle matrix (SSR airport is the fixed origin), with one-way / return (admin return discount),
-- flight number + arrival time, and a per-hotel booking widget on each /airport-transfers/[slug] page.
--
-- Pricing is SERVER-AUTHORITATIVE and zero-trust: api_book looks up the destination region from
-- airport_transfer_hotels by the hotel SLUG (never a client-sent region or price) and recomputes the
-- fare. The TS airportTransferQuoteMinor() in src/lib/services/pricing.ts mirrors the functions below
-- cent-for-cent (pricing parity unit tests). Mirror this whole file into supabase/catch-up.sql per the
-- DB-sync convention ([[gytm-db-sync]]).
--
-- The airport-transfer activity becomes pricing_mode='vehicle' (books ONE vehicle slot per booking,
-- vehicle derived from party size + the ≤4 SUV upgrade — the same shape as sightseeing). create_booking
-- prices it from sightseeing_pricing; api_book then OVERRIDES the booking total + its single line item
-- with the airport fare, so the receipt's item == total. create_booking / api_create_hold are unchanged
-- (their winning bodies still apply); api_book / booking_json / api_get_activity are re-applied from their
-- WINNING bodies VERBATIM with the airport additions, so no guard or feature silently reverts
-- ([[gytm-migration-revert-drift]]).

-- 1) activities: flag the airport-transfer product.
alter table activities add column if not exists is_airport_transfer boolean not null default false;

-- 2) bookings: flight + trip details for the operator run sheet, confirmation and receipt.
alter table bookings add column if not exists trip_type text not null default 'one_way'
  check (trip_type in ('one_way', 'return'));
alter table bookings add column if not exists flight_number text;
alter table bookings add column if not exists arrival_time text;
alter table bookings add column if not exists return_date date;
alter table bookings add column if not exists return_time text;
alter table bookings add column if not exists departure_flight_number text;

-- 3) airport_transfer_fare: ONE flat fare per (destination region × vehicle bracket). Public read (shown
--    on the hotel pages), staff edit (admin pricing screen). Seeded from the region "from" prices.
create table if not exists airport_transfer_fare (
  region        text primary key check (region in ('North', 'South', 'East', 'West', 'Central')),
  sedan_minor   int not null,   -- 1-4
  suv_minor     int not null,   -- 1-4 upgrade
  family_minor  int not null,   -- 5-6
  van_minor     int not null,   -- 7-14
  coaster_minor int not null,   -- 15-25 (×N coasters above 25)
  updated_at    timestamptz not null default now()
);
insert into airport_transfer_fare (region, sedan_minor, suv_minor, family_minor, van_minor, coaster_minor) values
  ('South',   2500, 3500, 4000,  6500, 11000),  -- SSR sits in the south-east, so South is nearest
  ('East',    3500, 4500, 5500,  8500, 14000),
  ('Central', 3000, 4000, 4800,  7500, 12500),
  ('West',    4000, 5200, 6500,  9500, 16000),
  ('North',   5000, 6500, 8000, 12000, 20000)
on conflict (region) do nothing;
alter table airport_transfer_fare enable row level security;
grant select on airport_transfer_fare to anon, authenticated, service_role;
grant update on airport_transfer_fare to authenticated;
drop policy if exists airport_transfer_fare_read on airport_transfer_fare;
create policy airport_transfer_fare_read on airport_transfer_fare for select using (true);
drop policy if exists airport_transfer_fare_staff on airport_transfer_fare;
create policy airport_transfer_fare_staff on airport_transfer_fare for all using (is_staff()) with check (is_staff());

-- 4) airport_transfer_config: single-row config (the return-trip discount %). Mirrors planner_pricing.
create table if not exists airport_transfer_config (
  id                  boolean primary key default true check (id),
  return_discount_pct int not null default 10 check (return_discount_pct between 0 and 90),
  updated_at          timestamptz not null default now()
);
insert into airport_transfer_config (id) values (true) on conflict (id) do nothing;
alter table airport_transfer_config enable row level security;
grant select on airport_transfer_config to anon, authenticated, service_role;
grant update on airport_transfer_config to authenticated;
drop policy if exists airport_transfer_config_read on airport_transfer_config;
create policy airport_transfer_config_read on airport_transfer_config for select using (true);
drop policy if exists airport_transfer_config_staff on airport_transfer_config;
create policy airport_transfer_config_staff on airport_transfer_config for all using (is_staff()) with check (is_staff());

-- 5) airport_transfer_hotels: the server's source of truth for each hotel's destination region (keyed by
--    the SEO page slug). api_book looks the region up here so it never trusts a client-sent region. Seeded
--    from src/lib/content/_transfers.gen.ts; re-sync if the SEO content workflow adds hotels.
create table if not exists airport_transfer_hotels (
  slug       text primary key,
  hotel_name text not null,
  region     text not null check (region in ('North', 'South', 'East', 'West', 'Central'))
);
insert into airport_transfer_hotels (slug, hotel_name, region) values
  ('lux-belle-mare', 'LUX* Belle Mare', 'East'),
  ('constance-belle-mare-plage', 'Constance Belle Mare Plage', 'East'),
  ('long-beach-mauritius', 'Long Beach Mauritius', 'East'),
  ('shangri-la-le-touessrok', 'Shangri-La Le Touessrok', 'East'),
  ('ambre-mauritius', 'Ambre Mauritius', 'East'),
  ('paradis-beachcomber', 'Paradis Beachcomber', 'West'),
  ('dinarobin-beachcomber', 'Dinarobin Beachcomber', 'West'),
  ('lux-le-morne', 'LUX* Le Morne', 'West'),
  ('st-regis-mauritius', 'The St. Regis Mauritius Resort', 'West'),
  ('sugar-beach-mauritius', 'Sugar Beach Mauritius', 'West'),
  ('sofitel-so-mauritius', 'Sofitel So Mauritius', 'South'),
  ('heritage-le-telfair', 'Heritage Le Telfair', 'South'),
  ('trou-aux-biches-beachcomber', 'Trou aux Biches Beachcomber', 'North'),
  ('canonnier-beachcomber', 'Canonnier Beachcomber', 'North'),
  ('lux-grand-gaube', 'LUX* Grand Gaube', 'North'),
  ('ravenala-attitude', 'The Ravenala Attitude', 'North'),
  ('westin-turtle-bay', 'The Westin Turtle Bay Resort & Spa', 'North'),
  ('le-meridien-ile-maurice', 'Le Méridien Ile Maurice', 'North'),
  ('victoria-beachcomber', 'Victoria Beachcomber', 'North'),
  ('radisson-blu-azuri', 'Radisson Blu Azuri Resort & Spa', 'East'),
  ('royal-palm-beachcomber', 'Royal Palm Beachcomber Luxury', 'North'),
  ('mauricia-beachcomber', 'Mauricia Beachcomber Resort & Spa', 'North'),
  ('veranda-grand-baie', 'Veranda Grand Baie', 'North'),
  ('lagoon-attitude', 'Lagoon Attitude', 'North'),
  ('zilwa-attitude', 'Zilwa Attitude', 'North'),
  ('recif-attitude', 'Recif Attitude', 'North'),
  ('coin-de-mire-attitude', 'Coin de Mire Attitude', 'North'),
  ('veranda-pointe-aux-biches', 'Veranda Pointe aux Biches', 'North'),
  ('anahita-golf-spa', 'Anahita Golf & Spa Resort', 'East'),
  ('four-seasons-anahita', 'Four Seasons Resort Mauritius at Anahita', 'East'),
  ('one-only-le-saint-geran', 'One&Only Le Saint Géran', 'East'),
  ('the-residence-mauritius', 'The Residence Mauritius', 'East'),
  ('emeraude-beach-attitude', 'Émeraude Beach Attitude', 'East'),
  ('tropical-attitude', 'Tropical Attitude', 'East'),
  ('solana-beach', 'Solana Beach Mauritius', 'East'),
  ('preskil-island-resort', 'Preskil Island Resort', 'South'),
  ('shandrani-beachcomber', 'Shandrani Beachcomber Resort & Spa', 'South'),
  ('tamassa-bel-ombre', 'Tamassa Bel Ombre', 'South'),
  ('outrigger-mauritius', 'Outrigger Mauritius Beach Resort', 'South'),
  ('hilton-mauritius', 'Hilton Mauritius Resort & Spa', 'West'),
  ('la-pirogue', 'La Pirogue Mauritius', 'West'),
  ('sands-suites', 'Sands Suites Resort & Spa', 'West'),
  ('maradiva-villas', 'Maradiva Villas Resort & Spa', 'West'),
  ('pearle-beach', 'Pearle Beach Resort & Spa', 'West'),
  ('riu-le-morne', 'Riu Le Morne', 'West')
on conflict (slug) do update set hotel_name = excluded.hotel_name, region = excluded.region;
alter table airport_transfer_hotels enable row level security;
grant select on airport_transfer_hotels to anon, authenticated, service_role;
grant insert, update, delete on airport_transfer_hotels to authenticated;
drop policy if exists airport_transfer_hotels_read on airport_transfer_hotels;
create policy airport_transfer_hotels_read on airport_transfer_hotels for select using (true);
drop policy if exists airport_transfer_hotels_staff on airport_transfer_hotels;
create policy airport_transfer_hotels_staff on airport_transfer_hotels for all using (is_staff()) with check (is_staff());

-- 6) airport_transfer_fare_minor(): region row -> vehicle bracket by party size (Sedan ≤4, Family ≤6,
--    Van ≤14, Coaster ≤25, ×ceil(pax/25) coasters above 25). SUV is the ≤4 upgrade. Mirrors
--    airportTransferFareMinor() in pricing.ts cent-for-cent. Returns 0 when inputs are missing.
create or replace function airport_transfer_fare_minor(p_region text, p_pax int, p_suv boolean)
returns bigint
language plpgsql
stable
as $$
declare
  v_row airport_transfer_fare;
begin
  if p_region is null or p_pax is null or p_pax < 1 then
    return 0;
  end if;
  select * into v_row from airport_transfer_fare where region = p_region;
  if not found then
    return 0;
  end if;
  if p_pax <= 4 then
    return case when coalesce(p_suv, false) then v_row.suv_minor else v_row.sedan_minor end;
  elsif p_pax <= 6 then
    return v_row.family_minor;
  elsif p_pax <= 14 then
    return v_row.van_minor;
  elsif p_pax <= 25 then
    return v_row.coaster_minor;
  else
    return v_row.coaster_minor * ceil(p_pax::numeric / 25)::int;
  end if;
end;
$$;
grant execute on function airport_transfer_fare_minor(text, int, boolean) to anon, authenticated, service_role;

-- 7) api_book: re-applied from its WINNING body (20260721000000_booking_dropoff) VERBATIM, with the
--    airport-transfer additions: read is_airport_transfer with the activity row; after the pickup blocks,
--    look up the destination region from airport_transfer_hotels by dropoffSlug (zero-trust), recompute
--    the fare (× return discount), OVERRIDE the booking total + operator payout + the single line item,
--    and store the flight/trip fields. Carrying the full body keeps the F23 guard + every branch.
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
  v_dropoff_region text;
  v_trip_type text;
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

  -- Airport transfer (server-authoritative, zero-trust): the destination region comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent region. The whole fare is the region × vehicle
  -- matrix (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    v_trip_type := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
    select region into v_dropoff_region from airport_transfer_hotels
      where slug = nullif(p ->> 'dropoffSlug', '');
    v_fare := airport_transfer_fare_minor(v_dropoff_region, v_total_qty::int, v_suv);
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
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40)
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

-- 8) booking_json: re-applied from its WINNING body (20260721000000_booking_dropoff) VERBATIM, plus the
--    flight/trip fields so the run sheet / confirmation / receipt can show them.
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
    'flightNumber', b.flight_number,
    'arrivalTime', b.arrival_time,
    'returnDate', b.return_date,
    'returnTime', b.return_time,
    'departureFlightNumber', b.departure_flight_number,
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

-- 9) api_get_activity: re-applied from its WINNING body (20260728000000_activity_min_advance) VERBATIM,
--    plus isAirportTransfer + the airport fare matrix + return discount, so the hotel booking widget can
--    show a live, exact transfer quote.
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.region, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'returnDiscountPct', case when coalesce(a.is_airport_transfer, false)
      then (select return_discount_pct from airport_transfer_config limit 1) else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

-- 10) Configure the seeded airport-transfer activity as a bookable vehicle product (idempotent; runs LAST
--     so it wins over the 20260617190000 per_group correction). min_advance_days = 0 so same-day flights
--     book. Then directly materialize the open-ended day-slots (the materialize_availability function is
--     staff/service-role gated and would raise if called from a plain SQL session, so inline the insert).
update activities
set is_airport_transfer = true,
    pricing_mode = 'vehicle',
    min_advance_days = 0,
    region = coalesce(region, 'South'),
    lat = coalesce(lat, -20.43),
    lng = coalesce(lng, 57.68),
    daily_capacity = coalesce(daily_capacity, 40)
where slug = 'airport-transfer';

insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
select o.id,
       a.operator_id,
       (d::date + time '12:00') at time zone 'Indian/Mauritius',
       ((d::date + time '12:00') at time zone 'Indian/Mauritius') + make_interval(mins => coalesce(a.duration_minutes, 240)),
       a.daily_capacity,
       'open'
from activities a
join activity_options o on o.activity_id = a.id
cross join generate_series(
  (now() at time zone 'Indian/Mauritius')::date,
  (now() at time zone 'Indian/Mauritius')::date + 185,
  interval '1 day'
) d
where a.slug = 'airport-transfer'
  and a.status = 'published'
  and coalesce(a.daily_capacity, 0) > 0
  and exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
  and not exists (
    select 1 from session_occurrences x
    where x.activity_option_id = o.id
      and (x.starts_at at time zone 'Indian/Mauritius')::date = d::date
  )
on conflict (activity_option_id, starts_at) do nothing;
