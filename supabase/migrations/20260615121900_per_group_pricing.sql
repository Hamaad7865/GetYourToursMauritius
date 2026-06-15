-- Per-group pricing — opt-in per activity (e.g. island tours), OFF by default.
--
-- When activities.group_pricing is TRUE, a price tier's `max_guests` is read as the GROUP
-- SIZE and the tier is billed per group: total = ceil(people / size) * amount. So a €70 tier
-- for a group of 4 charges 1-4 people = €70, 5-8 = €140, 9-12 = €210, and so on — with no
-- hard cap (the occurrence capacity already bounds the party).
--
-- When FALSE (the default for every existing activity), pricing is unchanged: per head, with
-- `max_guests` acting as an optional per-tier cap (exceeds_max_guests). The party size is sent
-- as `quantity` (people) and the price is computed here from the DB, so a client can't underpay.

alter table activities add column if not exists group_pricing boolean not null default false;

create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb
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
  v_group_pricing boolean := false;
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
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

  select a.group_pricing into v_group_pricing
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_group_pricing := coalesce(v_group_pricing, false);

  -- Aggregate quantity (people) per price_label, collapsing duplicate lines.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;

  -- Price each aggregated tier from the DB.
  for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
    select amount_minor, max_guests into v_unit, v_max
    from activity_option_prices
    where activity_option_id = v_option_id and label = v_label;
    if not found then
      raise exception 'unknown_price_tier' using detail = v_label;
    end if;
    v_qty_total := v_qty_total + v_qty;
    if v_group_pricing and v_max is not null then
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

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

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
        when v_group_pricing and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
        else v_unit * v_qty
      end
    );
  end loop;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

-- Expose group_pricing on the activity-detail DTO so the booking widget prices + labels match.
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
    'pickupAvailable', a.pickup_available, 'groupPricing', a.group_pricing,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', (
      select min(pr.amount_minor)::float / 100
      from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
      where o.activity_id = a.id
    ),
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

-- Expose group_pricing on the search summary so catalogue cards label the price correctly
-- ("per group up to N" only for group-priced activities, otherwise per person / per vehicle).
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
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'groupPricing', x.group_pricing,
        'fromPriceEur', (
          select min(pr.amount_minor)::float / 100
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
        ),
        'fromPriceMaxGuests', (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ),
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
