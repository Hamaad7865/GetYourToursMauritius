-- 20261004000000_discontinue_option
-- Soft-retire ("discontinue") a booking option. A booked option can never be hard-deleted — its
-- booking_items row is a permanent sales record (ON DELETE RESTRICT) — so instead we set
-- activity_options.status = 'archived': the option is hidden from customers, takes no new bookings,
-- and its dates stop being generated, while the row (and every booking that references it) stays
-- intact. Reuses the existing activity_options.status column (text, default 'active', previously
-- unused). Reinstating sets it back to 'active'.
--
-- Enforced where options surface:
--   * api_get_activity excludes archived options from the customer option list AND the from-price;
--   * materialize_availability never generates/reopens dates for an archived option (carries the
--     weekday guard from 20261003000000);
--   * set_option_status_atomic reconciles the ~6 months already materialised (close referenced /
--     delete empty), mirroring stop_availability_atomic; the booking path needs no change
--     (create_hold already rejects a missing/closed slot).
--
-- Keep this file's SQL identical (idempotent form) to the copy appended in supabase/catch-up.sql, and
-- re-run `npm run setup:sql` after applying.

-- set_option_status_atomic: persist an option's status and reconcile its materialised future slots.
create or replace function set_option_status_atomic(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option_id uuid := nullif(p ->> 'optionId', '')::uuid;
  v_status text := nullif(p ->> 'status', '');
  v_activity_id uuid;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_option_id is null or v_status is null or v_status not in ('active', 'archived') then
    raise exception 'invalid_request';
  end if;

  select activity_id into v_activity_id from activity_options where id = v_option_id;
  if not found then
    raise exception 'invalid_request';
  end if;

  update activity_options set status = v_status where id = v_option_id;

  if v_status = 'archived' then
    -- Close future slots a booking item, active hold, or quote line references (never strand a paid
    -- guest, a live hold, or an offer in a guest's inbox).
    update session_occurrences so
       set status = 'closed'
     where so.activity_option_id = v_option_id
       and so.starts_at >= now()
       and (
         exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
         or exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active')
         or exists (select 1 from quote_items qi where qi.session_occurrence_id = so.id)
       );

    -- Delete empty future slots (no booking, no active hold, no quote line).
    delete from session_occurrences so
     where so.activity_option_id = v_option_id
       and so.starts_at >= now()
       and not exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
       and not exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active')
       and not exists (select 1 from quote_items qi where qi.session_occurrence_id = so.id);
  else
    -- Reinstate: refill the availability window (respects capacity + closed_weekdays + status).
    perform materialize_availability(jsonb_build_object('activityId', v_activity_id::text));
  end if;
end;
$$;
-- `from public, anon` (not just public): Supabase grants EXECUTE to anon explicitly, and CREATE OR
-- REPLACE never resets an existing ACL — see the note on stop_availability_atomic.
revoke execute on function set_option_status_atomic(jsonb) from public, anon;
grant execute on function set_option_status_atomic(jsonb) to authenticated, service_role;

-- materialize_availability: the 20261003000000 (weekday) body VERBATIM, plus skip archived options on
-- BOTH branches (`o.status <> 'archived'`). An archived option never (re)generates dates.
create or replace function materialize_availability(p jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_activity_id uuid := nullif(p ->> 'activityId', '')::uuid;
  v_days int := least(greatest(coalesce((p ->> 'days')::int, 185), 1), 400);
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
  v_count int;
begin
  if not (is_staff() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

  update session_occurrences so
     set status = 'open'
    from activity_options o
    join activities a on a.id = o.activity_id
   where so.activity_option_id = o.id
     and so.status = 'closed'
     and so.starts_at > now()
     and a.status = 'published'
     and o.status <> 'archived'
     and coalesce(a.daily_capacity, 0) > 0
     and coalesce(o.daily_capacity, a.daily_capacity, 0) > 0
     and (v_activity_id is null or a.id = v_activity_id)
     and extract(isodow from (so.starts_at at time zone 'Indian/Mauritius'))::int
           <> all(o.closed_weekdays);

  insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
  select o.id,
         a.operator_id,
         (d::date + time '12:00') at time zone 'Indian/Mauritius',
         ((d::date + time '12:00') at time zone 'Indian/Mauritius') + make_interval(mins => coalesce(a.duration_minutes, 240)),
         coalesce(o.daily_capacity, a.daily_capacity),
         'open'
  from activities a
  join activity_options o on o.activity_id = a.id
  cross join generate_series(v_today, v_today + v_days, interval '1 day') d
  where a.status = 'published'
    and o.status <> 'archived'
    and coalesce(a.daily_capacity, 0) > 0
    and coalesce(o.daily_capacity, a.daily_capacity, 0) > 0
    and (v_activity_id is null or a.id = v_activity_id)
    and (
      exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
      or o.private_base_minor is not null
    )
    and extract(isodow from d::date)::int <> all(o.closed_weekdays)
    and not exists (
      select 1 from session_occurrences x
      where x.activity_option_id = o.id
        and (x.starts_at at time zone 'Indian/Mauritius')::date = d::date
    )
  on conflict (activity_option_id, starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- api_get_activity: the 27276 body VERBATIM, plus `and o.status <> 'archived'` on the customer option
-- list and the from-price (an archived option disappears from the site entirely). All other behaviour
-- unchanged.
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
    'supplements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', case
          when coalesce(nullif(p ->> 'locale', ''), 'en') = 'fr'
            then coalesce(nullif(btrim(coalesce(s.name_fr, '')), ''), s.name)
          else s.name end,
        'priceEur', s.price_minor::float / 100
      ) order by s.position, s.id)
      from activity_supplements s where s.activity_id = a.id
    ), '[]'::jsonb),
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
          where o.activity_id = a.id and o.status <> 'archived'
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
        'guestsPerTrip', coalesce(o.guests_per_trip, a.guests_per_trip),
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id and o.status <> 'archived'
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
