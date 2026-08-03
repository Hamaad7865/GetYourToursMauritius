-- 20260905000000_activity_supplement
--
-- A per-activity optional SUPPLEMENT the owner can name and price himself -- the first one being the
-- lobster lunch upgrade on the Ile aux Cerfs day trips.
--
-- WHY a real pair of columns rather than an `activities.extra` key: `extra` is presentational only
-- (20260901000700 says so on the column comment) and, worse, it is MERGED with the French overlay
-- (`a.extra || coalesce(t.extra, '{}')`) -- so a translated `extra` could shadow a PRICE. Money never
-- comes out of a free-form bag that content editing can reach.
--
-- Shape, mirroring the child-seat add-on (20260617180000) exactly:
--   * activities.supplement_name  -- blank/NULL = this activity has no supplement (the feature is off)
--   * activities.supplement_minor -- the PER-PERSON price in minor units; the only price that exists
--   * activity_translations.supplement_name -- the FR label, per-field coalesce like title/summary
--   * bookings.supplement_qty / supplement_minor / supplement_name -- what was actually bought
--
-- The booking columns SNAPSHOT the name and the charged total. The owner will re-price the lobster
-- next season, and an invoice reprinted after that must still show what the guest actually paid for.
-- (Child seats got this wrong -- their €6 is a literal in the function body and in pricing.ts, so an
-- old receipt silently re-prices itself. Not repeating that.)
--
-- The client sends only the QUANTITY. The unit price is read here, from the activity behind the
-- occurrence -- never from the payload ([[the five rules]] #1).
--
-- Re-run supabase/catch-up.sql after applying (idempotent).

alter table activities add column if not exists supplement_name text;
alter table activities add column if not exists supplement_minor int;
alter table activity_translations add column if not exists supplement_name text;

alter table bookings add column if not exists supplement_qty int not null default 0;
alter table bookings add column if not exists supplement_minor int not null default 0;
alter table bookings add column if not exists supplement_name text;

-- `add constraint if not exists` does not exist in Postgres, and catch-up.sql is re-run after every
-- deploy, so each check is guarded by name.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_supplement_minor_nonneg') then
    alter table activities add constraint activities_supplement_minor_nonneg
      check (supplement_minor is null or supplement_minor >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_supplement_qty_nonneg') then
    alter table bookings add constraint bookings_supplement_qty_nonneg
      check (supplement_qty >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_supplement_minor_nonneg') then
    alter table bookings add constraint bookings_supplement_minor_nonneg
      check (supplement_minor >= 0);
  end if;
end $$;

comment on column activities.supplement_name is
  'Optional per-activity supplement the guest can add per person (e.g. "Lobster lunch"). Blank or '
  'NULL switches the whole feature off for this activity. Owner-editable in /admin.';
comment on column activities.supplement_minor is
  'Per-PERSON price of activities.supplement_name, in minor units. Server-authoritative: api_book '
  'reads it here and the client only ever sends a quantity.';
comment on column bookings.supplement_name is
  'Snapshot of the supplement label at booking time, so a reprinted invoice keeps showing what the '
  'guest bought after the owner renames or re-prices it.';
comment on column bookings.supplement_minor is
  'TOTAL charged for the supplement on this booking (unit x qty), already inside total_minor.';

-- ---------------------------------------------------------------------------
-- api_get_activity -- the 20260901000700 body VERBATIM, plus supplementName / supplementEur.
-- The NAME falls back per-field to the French overlay exactly like title/summary/meetingPoint; the
-- PRICE and the on/off gate come only from the English (operational) columns.
-- STAYS `security invoker` -- definer-grants-lockdown.test.ts depends on it.
-- ---------------------------------------------------------------------------
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', coalesce(t.title, a.title),
    'summary', coalesce(t.summary, a.summary),
    'description', coalesce(t.description, a.description), 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', coalesce(t.meeting_point, a.meeting_point),
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
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
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(coalesce(nullif(t.inclusions, '{}'), a.inclusions)),
    'exclusions', to_jsonb(coalesce(nullif(t.exclusions, '{}'), a.exclusions)),
    'highlights', to_jsonb(coalesce(nullif(t.highlights, '{}'), a.highlights)), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', coalesce(t.seo_title, a.seo_title), 'seoDescription', coalesce(t.seo_description, a.seo_description),
    'extra', a.extra || coalesce(t.extra, '{}'::jsonb),
    'supplementName', case
      when nullif(btrim(coalesce(a.supplement_name, '')), '') is null then null
      else coalesce(
        nullif(btrim(coalesce(t.supplement_name, '')), ''),
        btrim(a.supplement_name)
      ) end,
    'supplementEur', case
      when nullif(btrim(coalesce(a.supplement_name, '')), '') is null then null
      else coalesce(a.supplement_minor, 0)::float / 100 end,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        -- Per-OPTION front price, then min across options (mirrors api_search_activities).
        select min(case when opt.banded then opt.max_amt else coalesce(opt.min_paid, opt.min_amt) end)::float / 100
        from (
          select bool_or(pr.min_age is not null or pr.max_age is not null) as banded,
                 max(pr.amount_minor) as max_amt,
                 min(pr.amount_minor) filter (where pr.amount_minor > 0) as min_paid,
                 min(pr.amount_minor) as min_amt
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
          group by pr.activity_option_id
        ) opt
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
        'id', o.id, 'name', o.name, 'description', o.description, 'durationMinutes', o.duration_minutes, 'startWindow', o.start_window,
        'privateBaseEur', o.private_base_minor::float / 100,
        'privateIncluded', o.private_included,
        'privateExtraEur', o.private_extra_minor::float / 100,
        'privateMaxGuests', o.private_max_guests,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
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
  left join activity_translations t
    on t.activity_id = a.id
   and t.locale = coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale
  where a.slug = p ->> 'slug';
$$;
grant execute on function api_get_activity(jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- booking_json -- the 20260819000000 body VERBATIM, plus the three supplement fields.
-- They are scalars on the booking, NOT booking_items rows: an extra item row would inflate
-- partySize (sum of pax) and unitsNeeded (sum of quantity), and unitsNeeded is what the reschedule
-- date-picker checks capacity against. Same reason child seats and transport are scalars.
-- STAYS `security invoker`.
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
    'supplementName', b.supplement_name,
    'supplementQty', b.supplement_qty,
    'supplementEur', b.supplement_minor::float / 100,
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
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- ---------------------------------------------------------------------------
-- api_book -- the 20260903000000 body VERBATIM, plus the supplement charge.
--
-- Placed immediately after the child-seat block, which means AFTER the airport / hotel transfer
-- blocks. Those two OVERWRITE total_minor with the fare, so anything added before them is silently
-- erased. Additive add-ons belong at the end, and this is the end.
--
-- Server-authoritative: the unit price comes from activities.supplement_minor, read in the same
-- SELECT that already resolves the activity behind the occurrence. The payload contributes only
-- `supplementQty`, clamped to the head count.
--
-- Replay guard `and supplement_qty = 0`, matching child_seats / transport_minor: create_booking
-- returns the EXISTING row on an idempotency-key replay, so an unguarded update would charge the
-- supplement a second time onto a booking that may already have a Peach session minted for the old
-- amount ([[gytm-drift-gate-double-charge]]).
--
-- A configured-but-free supplement (price 0) still records the guest's request and adds nothing --
-- the kitchen needs the head count either way.
-- ---------------------------------------------------------------------------
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
  v_supp_qty int;
  v_supp_extra bigint;
  v_supp_name text;
  v_supp_unit int;
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
         nullif(btrim(coalesce(a.supplement_name, '')), ''),
         coalesce(a.supplement_minor, 0)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel, v_is_private,
         v_supp_name, v_supp_unit
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

  -- Per-activity supplement (e.g. the lobster lunch upgrade). Priced PER PERSON from
  -- activities.supplement_minor, read above; the payload supplies only the count, clamped to the head
  -- count. A blank supplement_name means the activity has none, so nothing is charged whatever the
  -- client sends. See the header for why this sits after the transfer overrides.
  v_supp_qty := least(greatest(coalesce(nullif(p ->> 'supplementQty', '')::int, 0), 0), v_total_qty::int);
  if v_supp_qty > 0 and v_supp_name is not null then
    v_supp_extra := coalesce(v_supp_unit, 0)::bigint * v_supp_qty;
    update bookings
    set supplement_qty = v_supp_qty,
        supplement_name = v_supp_name,
        supplement_minor = v_supp_extra,
        total_minor = total_minor + v_supp_extra,
        operator_payout_minor = operator_payout_minor + v_supp_extra
    where id = v_booking.id and supplement_qty = 0;
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
