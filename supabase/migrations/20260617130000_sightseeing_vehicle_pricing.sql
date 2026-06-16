-- Sightseeing vehicle pricing — ONE global rule for every sightseeing tour.
--
-- Price = €70 per block of 4 people (per_block_minor * ceil(P / 4)), with a flat €85 SUV upgrade for
-- parties of 1-4. Party is capped at 25. The vehicle name is a function of P (Sedan/Family car/
-- Minibus/Coaster; SUV when upgraded). The two prices live in a single-row config table so the owner
-- changes them once for all tours. Each booking still reserves ONE vehicle slot of the day's capacity
-- (quantity = 1) and records people in booking_items.pax. Replaces the old flat-bracket vehicle mode.

-- 1) Global config: one row, two tunable prices. The prices are public (shown on the site), and the
--    SECURITY INVOKER catalogue RPCs read it as the caller's role, so RLS allows public SELECT but no
--    write policy → only the owner / service_role (SQL editor) can change the prices.
create table if not exists sightseeing_pricing (
  id              boolean primary key default true check (id),
  per_block_minor int not null default 7000,  -- €70 per block of 4
  suv_flat_minor  int not null default 8500,  -- €85 SUV, flat, parties of 1-4
  updated_at      timestamptz not null default now()
);
insert into sightseeing_pricing (id) values (true) on conflict (id) do nothing;
alter table sightseeing_pricing enable row level security;
drop policy if exists sightseeing_pricing_read on sightseeing_pricing;
create policy sightseeing_pricing_read on sightseeing_pricing for select using (true);
grant select on sightseeing_pricing to anon, authenticated, service_role;

-- 2) create_booking gains p_suv (8th arg). Drop the old 7-arg first so this REPLACES it rather than
--    creating an overload (7-arg positional callers then bind here via the default).
drop function if exists create_booking(text, uuid, text, text, text, booking_source, jsonb);

create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb,
  p_suv boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_vehicle text;
  v_per_block bigint;
  v_suv_flat bigint;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  select a.pricing_mode into v_mode
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  -- Aggregate quantity (people) per price_label, collapsing duplicate lines.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_mode = 'vehicle' then
    -- Global sightseeing rule. P = v_qty_total (people on board).
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select per_block_minor, suv_flat_minor into v_per_block, v_suv_flat from sightseeing_pricing limit 1;
    if v_per_block is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 and p_suv then
      v_total := v_suv_flat;
      v_vehicle := 'SUV';
    else
      v_total := v_per_block * ceil(v_qty_total::numeric / 4)::int;
      v_vehicle := case
        when v_qty_total <= 4 then 'Sedan'
        when v_qty_total <= 6 then 'Family car'
        when v_qty_total <= 14 then 'Minibus'
        else 'Coaster'
      end;
    end if;
    -- The hold reserves ONE vehicle, not P seats.
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: price each aggregated tier from the DB.
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch'
        using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_mode = 'vehicle' then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (
      v_booking.id, v_hold.session_occurrence_id, v_option_id, v_vehicle,
      1, v_total, v_total, v_qty_total
    );
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case
          when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
          else v_unit * v_qty
        end
      );
    end loop;
  end if;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to anon, authenticated, service_role;

-- 3) api_book: keep F23 (replay-disclosure guard) + F25 (party bound), restore the vehicle branch
--    (hold ONE vehicle), and thread the suv flag to create_booking.
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
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1
    from session_occurrences so
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

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');

  -- Vehicle bookings take ONE slot of the day's capacity regardless of party size.
  if v_mode = 'vehicle' then
    v_hold := create_hold(v_occ, 1, v_key || ':hold');
  else
    v_hold := create_hold(v_occ, v_total_qty::int, v_key || ':hold');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23: a replay with someone else's key must not echo back their booking.
  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;

  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 4) Catalogue: for vehicle mode, fromPriceEur = the €70 base and expose the config block so the
--    booking widget mirrors the exact numbers. Non-vehicle modes unchanged.
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
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select per_block_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'perBlockEur', per_block_minor::float / 100,
        'suvFlatEur', suv_flat_minor::float / 100,
        'blockSize', 4,
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

create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*
    from activities a
    where a.status = 'published'
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
  ),
  paged as (
    select * from filtered
    order by rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'fromPriceEur', case
          when x.pricing_mode = 'vehicle'
            then (select per_block_minor from sightseeing_pricing limit 1)::float / 100
          else (
            select min(pr.amount_minor)::float / 100
            from activity_option_prices pr
            join activity_options o on o.id = pr.activity_option_id
            where o.activity_id = x.id
          )
        end,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from filtered),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;
