-- Region-based transport add-on for per_person / per_group activities.
--
-- Activities like "Swimming with Dolphins" board in a fixed part of the island (the West). The real
-- cost to Belle Mare Tours is the ROUND-TRIP drive from the customer's hotel to that boarding point —
-- same region = short drive = cheap; North/East/South = farther = more. This adds an OPTIONAL transport
-- line that scales with that distance:
--   fare = transport_band_pricing[ band(pickupRegion, activityRegion) ][ vehicle(pax, suv) ]
-- where band is Same (same region) / Near / Far. One global config; each activity just needs its home
-- region (or lat/lng, from which the region is derived).
--
-- EXCLUDED: 'vehicle' (Private Sightseeing) and 'vehicle_custom' (Custom planner) — those already price
-- the whole drive. The add-on applies ONLY to per_person / per_group activities with pickup_available.
--
-- Server is authoritative: api_book RE-DERIVES the pickup region from coordinates and looks up the fare;
-- it never trusts a client-sent price. The TS transportFare() in src/lib/services/pricing.ts mirrors the
-- functions below cent-for-cent (covered by the pricing parity unit tests). Mirror this whole file into
-- supabase/catch-up.sql per the DB-sync convention.

-- 1) activities: home/boarding region + coords. region resolves as coalesce(region, region_from_coords(lat,lng)).
alter table activities add column if not exists region text;
alter table activities add column if not exists lat double precision;
alter table activities add column if not exists lng double precision;

-- 2) bookings: record the transport add-on + the pickup geo (for receipts and the operator's run sheet).
alter table bookings add column if not exists transport_minor bigint not null default 0;
alter table bookings add column if not exists pickup_region text;
alter table bookings add column if not exists pickup_lat double precision;
alter table bookings add column if not exists pickup_lng double precision;

-- 3) region_from_coords(): SQL port of regionFromCoords() in src/lib/maps/google-places.ts — EXACTLY the
--    same thresholds, so the widget, the planner and the server all classify a point identically.
create or replace function region_from_coords(p_lat double precision, p_lng double precision)
returns text
language sql
immutable
as $$
  select case
    when p_lat is null or p_lng is null then null
    when p_lat >= -20.08 then 'North'
    when p_lat <= -20.42 then 'South'
    when p_lng >= 57.63 then 'East'
    when p_lng <= 57.43 then 'West'
    else 'Central'
  end;
$$;

-- 4) transport_band_pricing: ONE flat fare per (band × vehicle bracket). Public read (shown in the widget),
--    staff edit (admin pricing screen). Seeded with sensible defaults; the owner tunes them in /admin.
create table if not exists transport_band_pricing (
  band          text primary key check (band in ('same', 'near', 'far')),
  sedan_minor   int not null,   -- 1-4
  suv_minor     int not null,   -- 1-4 upgrade
  family_minor  int not null,   -- 5-6
  van_minor     int not null,   -- 7-14
  coaster_minor int not null,   -- 15-25 (×N coasters above 25)
  updated_at    timestamptz not null default now()
);
insert into transport_band_pricing (band, sedan_minor, suv_minor, family_minor, van_minor, coaster_minor) values
  ('same', 1500, 2000, 2500, 4000, 7000),    -- €15 / €20 / €25 / €40 / €70
  ('near', 3000, 3800, 4500, 7000, 12000),   -- €30 / €38 / €45 / €70 / €120
  ('far',  5000, 6000, 7000, 11000, 18000)   -- €50 / €60 / €70 / €110 / €180
on conflict (band) do nothing;
alter table transport_band_pricing enable row level security;
grant select on transport_band_pricing to anon, authenticated, service_role;
grant update on transport_band_pricing to authenticated;
drop policy if exists transport_band_pricing_read on transport_band_pricing;
create policy transport_band_pricing_read on transport_band_pricing for select using (true);
drop policy if exists transport_band_pricing_staff on transport_band_pricing;
create policy transport_band_pricing_staff on transport_band_pricing for all using (is_staff()) with check (is_staff());

-- 5) region_zone_distance: unordered region pair -> 'near' | 'far' (same-region is handled in code as 'same').
--    Stored canonically (region_a <= region_b). All 10 cross-pairs seeded from Mauritius geography.
create table if not exists region_zone_distance (
  region_a text not null,
  region_b text not null,
  band     text not null check (band in ('near', 'far')),
  primary key (region_a, region_b),
  check (region_a < region_b)
);
insert into region_zone_distance (region_a, region_b, band) values
  ('Central', 'East',  'near'),
  ('Central', 'North', 'near'),
  ('Central', 'South', 'near'),
  ('Central', 'West',  'near'),
  ('East',    'North', 'near'),
  ('East',    'South', 'near'),
  ('East',    'West',  'far'),
  ('North',   'South', 'far'),
  ('North',   'West',  'near'),
  ('South',   'West',  'near')
on conflict (region_a, region_b) do nothing;
alter table region_zone_distance enable row level security;
grant select on region_zone_distance to anon, authenticated, service_role;
grant insert, update, delete on region_zone_distance to authenticated;
drop policy if exists region_zone_distance_read on region_zone_distance;
create policy region_zone_distance_read on region_zone_distance for select using (true);
drop policy if exists region_zone_distance_staff on region_zone_distance;
create policy region_zone_distance_staff on region_zone_distance for all using (is_staff()) with check (is_staff());

-- 6) region_distance_band(): 'same' when equal, else the seeded near/far for the unordered pair ('far' if
--    a pair is missing — fail safe to the higher fare). Mirrors regionDistanceBand() in pricing.ts.
create or replace function region_distance_band(p_a text, p_b text)
returns text
language sql
stable
as $$
  select case
    when p_a is null or p_b is null then 'far'
    when p_a = p_b then 'same'
    else coalesce((
      select band from region_zone_distance
      where region_a = least(p_a, p_b) and region_b = greatest(p_a, p_b)
    ), 'far')
  end;
$$;

-- 7) transport_fare_minor(): band lookup -> vehicle bracket by party size (Sedan ≤4, Family ≤6, Van ≤14,
--    Coaster ≤25, ×ceil(pax/25) coasters above 25). SUV is the ≤4 upgrade. Mirrors transportFare() in
--    pricing.ts cent-for-cent. Returns 0 when inputs are missing (no pickup -> no fee).
create or replace function transport_fare_minor(
  p_pickup_region text,
  p_activity_region text,
  p_pax int,
  p_suv boolean
)
returns bigint
language plpgsql
stable
as $$
declare
  v_band text;
  v_row transport_band_pricing;
begin
  if p_pickup_region is null or p_activity_region is null or p_pax is null or p_pax < 1 then
    return 0;
  end if;
  v_band := region_distance_band(p_pickup_region, p_activity_region);
  select * into v_row from transport_band_pricing where band = v_band;
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
grant execute on function region_from_coords(double precision, double precision) to anon, authenticated, service_role;
grant execute on function region_distance_band(text, text) to anon, authenticated, service_role;
grant execute on function transport_fare_minor(text, text, int, boolean) to anon, authenticated, service_role;

-- 8) api_book: re-applied from its WINNING body (20260719120000_audit_fixes) VERBATIM, with two additions:
--    (a) the activity's home region + pickup_available are read alongside pricing_mode;
--    (b) a transport surcharge block after the child-seats block (same after-create pattern).
--    Carrying the full body (not a partial create-or-replace) keeps the F23 guard + every other branch —
--    avoids the migration-revert-drift class. create_booking / api_create_hold are unchanged (their
--    winning bodies in 20260617210000 still apply), so they are intentionally NOT redefined here.
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
         coalesce(a.pickup_available, false)
    into v_mode, v_activity_region, v_pickup_available
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

-- 9) booking_json: expose the transport add-on (transportMinor + pickupRegion) alongside childSeats, so the
--    order summary / confirmation / receipt can itemise it. Re-applied from the winning child_seats body.
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
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'pickupRegion', b.pickup_region,
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

-- 10) api_get_activity: expose the activity's home region + coords and (for per_person / per_group tours
--     that offer pickup) the global transport fare tables, so the booking widget can show a live, exact
--     transport quote. Re-applied from the winning flat_vehicle_pricing body with those keys added.
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
