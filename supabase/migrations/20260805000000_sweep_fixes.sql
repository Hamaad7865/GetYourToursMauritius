-- Bug sweep 2026-07-11 -- SQL batch. Every function below re-applies its current WINNING body
-- verbatim (extracted programmatically from the live catch-up state) plus the one described delta,
-- so no prior feature can silently revert ([[gytm-migration-revert-drift]]).
--
-- Fixes:
--  1. from-price: per-OPTION front price, then min across options (was max across the whole activity
--     once ANY option had an age band -- Catamaran Sunset Cruise advertised From EUR 70 vs its EUR 50 entry).
--  2. create_booking rejects EUR 0 totals (all-free parties) -- a 0-amount payment otherwise flips 'paid'
--     on any event; append_payment_event also requires amount > 0 for the paid state (belt & braces).
--  3. api_create_payment idempotency-key lookup is scoped to the booking.
--  4. Re-pay checkout ids are preserved (prev_provider_checkout_id) and the reconcile sweep queries
--     BOTH, so a capture on a revived old checkout can no longer be stranded.
--  5. claim_notifications surfaces rows stranded pending at the attempts cap as 'failed'.
--  6. bookings -> refund_pending now alerts the customer + owner + staff bell (was silent), except when
--     the cancel flow already queued its own alert.
--  7. api_cancel_booking's owner alert uses the 'owner' recipient sentinel (single source of truth).
--  8. GDPR erase: booking-linked outbox rows keep their recipient (owner rows survive; payload still
--     scrubbed), and staff bell rows are rebuilt without the customer's name.

alter table payments add column if not exists prev_provider_checkout_id text;


create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else coalesce(
          (
            -- Per-OPTION front price, then the cheapest across options: a banded option fronts its
            -- adult (max) tier; a plain option its cheapest non-free tier. Aggregating across the whole
            -- ACTIVITY made any age band inflate the headline to the priciest option's adult rate.
            select min(case when opt.banded then opt.max_amt else coalesce(opt.min_paid, opt.min_amt) end)
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
          ),
          (
            select min(o.private_base_minor)
            from activity_options o
            where o.activity_id = a.id and o.private_base_minor is not null
          )
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
      and (p ->> 'durationMin' is null or coalesce(a.duration_minutes, 0) >= (p ->> 'durationMin')::int)
      and (p ->> 'durationMax' is null or coalesce(a.duration_minutes, 0) <= (p ->> 'durationMax')::int)
      and (p ->> 'minRating' is null or coalesce(a.rating_avg, 0) >= (p ->> 'minRating')::numeric)
  ),
  priced as (
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
    order by sort, rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', x.from_price_minor::float / 100,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'fromPriceIncluded', case
          when x.pricing_mode = 'vehicle'
            or exists (
              select 1 from activity_option_prices pr
              join activity_options o on o.id = pr.activity_option_id
              where o.activity_id = x.id
            ) then null
          else (
            select o.private_included
            from activity_options o
            where o.activity_id = x.id and o.private_base_minor is not null
            order by o.private_base_minor asc
            limit 1
          )
        end,
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
    'total', (select count(*)::int from priced),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

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
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
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
  where a.slug = p ->> 'slug';
$$;

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
  v_sedan bigint;
  v_suv_price bigint;
  v_family bigint;
  v_van bigint;
  v_coaster bigint;
  v_pl_standard bigint;
  v_pl_suv bigint;
  v_pl_six bigint;
  v_pl_van bigint;
  v_pl_coach bigint;
  v_pl_max int;
  v_pb bigint;
  v_pi int;
  v_pe bigint;
  v_pm int;
  v_opt_name text;
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

  select private_base_minor, private_included, private_extra_minor, private_max_guests, name
    into v_pb, v_pi, v_pe, v_pm, v_opt_name
  from activity_options
  where id = v_option_id;

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

  if v_pb is not null then
    -- Private option (option-level flag): a flat base covers the first v_pi guests, v_pe per extra
    -- head. Counted like a vehicle: ONE capacity unit per booking (the pool is trips/day), with the
    -- real headcount recorded in pax on the single line item below.
    if v_qty_total < 1 or v_qty_total > v_pm then
      raise exception 'exceeds_max_guests' using detail = format('private: %s > %s', v_qty_total, v_pm);
    end if;
    v_total := v_pb + v_pe * greatest(0, v_qty_total - v_pi);
    v_vehicle := coalesce(nullif(v_opt_name, ''), 'Private');
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('private hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle' then
    -- One flat price for the bracket that fits P = v_qty_total (people on board). (Unchanged.)
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select sedan_minor, suv_minor, family_minor, van_minor, coaster_minor
      into v_sedan, v_suv_price, v_family, v_van, v_coaster
      from sightseeing_pricing limit 1;
    if v_sedan is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_suv_price;
        v_vehicle := 'SUV';
      else
        v_total := v_sedan;
        v_vehicle := 'Sedan';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_family;
      v_vehicle := 'Family car';
    elsif v_qty_total <= 14 then
      v_total := v_van;
      v_vehicle := 'Van';
    else
      v_total := v_coaster;
      v_vehicle := 'Coaster';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle_custom' then
    -- Parallel planner path: same bracket shape, the planner's own prices/names + cap.
    select standard_minor, suv_minor, six_minor, van_minor, coach_minor, max_party
      into v_pl_standard, v_pl_suv, v_pl_six, v_pl_van, v_pl_coach, v_pl_max
      from planner_pricing limit 1;
    if v_pl_standard is null then
      raise exception 'planner_pricing_unset';
    end if;
    if v_qty_total < 1 or v_qty_total > v_pl_max then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_pl_suv;
        v_vehicle := 'SUV';
      else
        v_total := v_pl_standard;
        v_vehicle := 'Standard car';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_pl_six;
      v_vehicle := '6-seater';
    elsif v_qty_total <= 14 then
      v_total := v_pl_van;
      v_vehicle := 'Van';
    else
      v_total := v_pl_coach;
      v_vehicle := 'Coach';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: price each aggregated tier from the DB. (Unchanged.)
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

  -- A EUR 0 booking must never exist: an all-free party (infants only) would otherwise mint a
  -- zero-amount payment that flips 'paid' on any event. The client blocks free-only parties;
  -- enforce it zero-trust here too.
  if v_total <= 0 then
    raise exception 'zero_total';
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

  if v_pb is not null or v_mode in ('vehicle', 'vehicle_custom') then
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

create or replace function api_create_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_payment payments;
begin
  select * into v_booking from bookings where ref = p ->> 'bookingRef';
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
     or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'booking_not_payable' using detail = v_booking.status::text;
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  select * into v_payment from payments
  where booking_id = v_booking.id and status <> 'failed'
  order by created_at desc
  limit 1;

  if not found then
    -- Scoped to THIS booking: an unscoped key lookup let a caller echo another payment's key and
    -- receive that payment's id/amount back.
    select * into v_payment from payments
    where idempotency_key = p ->> 'idempotencyKey' and booking_id = v_booking.id;
  end if;

  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
    'existingCheckoutId', case
       when v_payment.provider_checkout_id is not null
            and v_payment.updated_at > now() - interval '25 minutes'
       then v_payment.provider_checkout_id else null end
  );
end;
$$;

create or replace function append_payment_event(
  p_payment_id uuid,
  p_type text,
  p_provider_event_id text,
  p_amount_minor bigint,
  p_occurred_at timestamptz,
  p_payload jsonb
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_paid bigint;
  v_refunded bigint;
  v_failed boolean;
  v_state payment_state;
  v_booking_status booking_status;
  v_occ_id uuid;
  v_needed bigint;
  v_cap bigint;
  v_used_conf bigint;
  v_used_hold bigint;
  v_oversold boolean := false;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  insert into payment_events (payment_id, type, provider_event_id, amount_minor, occurred_at, payload)
  values (
    p_payment_id, p_type, p_provider_event_id, coalesce(p_amount_minor, 0),
    coalesce(p_occurred_at, now()), coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (payment_id, provider_event_id) do nothing;

  select
    coalesce(sum(amount_minor) filter (where type in ('paid', 'captured')), 0),
    coalesce(sum(amount_minor) filter (where type = 'refunded'), 0),
    bool_or(type = 'failed')
  into v_paid, v_refunded, v_failed
  from payment_events
  where payment_id = p_payment_id;

  if v_paid > 0 and v_refunded >= v_paid then
    v_state := 'refunded';
  elsif v_paid > 0 and v_refunded > 0 then
    v_state := 'partially_refunded';
  -- amount_minor > 0: a zero-amount payment must never read as fully paid (0 >= 0) -- the 'failed'
  -- branch below has to win for it.
  elsif v_payment.amount_minor > 0 and v_paid >= v_payment.amount_minor then
    v_state := 'paid';
  elsif v_paid > 0 then
    v_state := 'pending'; -- underpaid: do not confirm
  elsif coalesce(v_failed, false) then
    v_state := 'failed';
  else
    v_state := 'pending';
  end if;

  update payments
  set status = v_state, paid_minor = v_paid, refunded_minor = v_refunded, updated_at = now()
  where id = p_payment_id
  returning * into v_payment;

  update bookings set payment_state = v_state, updated_at = now() where id = v_payment.booking_id;

  if v_state = 'paid' then
    select status into v_booking_status from bookings where id = v_payment.booking_id;

    if v_booking_status in ('draft', 'held', 'payment_pending') then
      -- Re-validate capacity per occurrence, excluding this booking's own items/holds.
      for v_occ_id in
        select distinct session_occurrence_id from booking_items where booking_id = v_payment.booking_id
      loop
        perform 1 from session_occurrences where id = v_occ_id for update;
        select coalesce(sum(quantity), 0) into v_needed
        from booking_items where booking_id = v_payment.booking_id and session_occurrence_id = v_occ_id;
        select capacity into v_cap from session_occurrences where id = v_occ_id;
        select coalesce(sum(bi.quantity), 0) into v_used_conf
        from booking_items bi join bookings b on b.id = bi.booking_id
        where bi.session_occurrence_id = v_occ_id
          and b.status in ('confirmed', 'completed')
          and b.id <> v_payment.booking_id;
        select coalesce(sum(h.quantity), 0) into v_used_hold
        from booking_holds h
        where h.session_occurrence_id = v_occ_id
          and h.status = 'active' and h.expires_at > now()
          and (h.booking_id is null or h.booking_id <> v_payment.booking_id);
        if v_needed > v_cap - v_used_conf - v_used_hold then
          v_oversold := true;
        end if;
      end loop;

      if v_oversold then
        update bookings set status = 'refund_pending', updated_at = now() where id = v_payment.booking_id;
      else
        update bookings set status = 'confirmed', updated_at = now() where id = v_payment.booking_id;
        update booking_holds set status = 'consumed'
        where booking_id = v_payment.booking_id and status = 'active';
      end if;
    elsif v_booking_status not in ('confirmed', 'completed') then
      -- Money captured on an expired/cancelled booking: must be refunded, not confirmed.
      update bookings set status = 'refund_pending', updated_at = now() where id = v_payment.booking_id;
    end if;
  elsif v_state = 'refunded' then
    update bookings set status = 'refunded', updated_at = now()
    where id = v_payment.booking_id and status <> 'cancelled';
    update booking_holds set status = 'released'
    where booking_id = v_payment.booking_id and status = 'active';
  end if;

  return v_payment;
end;
$$;

create or replace function api_record_payment_checkout(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_checkout: paymentId required';
  end if;

  -- IDOR guard: SECURITY DEFINER bypasses payments RLS, so authorize here. Only staff or the booking's
  -- owner may record a charge. auth.uid() must be non-null, else `null = null` is NULL (not false).
  if not (is_staff() or exists (
    select 1 from payments pay
    join bookings b on b.id = pay.booking_id
    where pay.id = v_payment_id and auth.uid() is not null and b.user_id = auth.uid()
  )) then
    raise exception 'forbidden';
  end if;

  -- OVERWRITE (latest checkout wins): a re-pay opens a new checkout the sweep must query, so the most
  -- recent checkout id replaces any prior one — no record-once guard here.
  update payments
  set prev_provider_checkout_id = case
        when provider_checkout_id is not null
             and provider_checkout_id is distinct from left(btrim(p ->> 'checkoutId'), 128)
        then provider_checkout_id
        else prev_provider_checkout_id
      end,
      provider_checkout_id = left(btrim(p ->> 'checkoutId'), 128)
  where id = v_payment_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function api_pending_payment_checkouts(p jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('ref', t.ref, 'paymentId', t.payment_id, 'checkoutId', t.provider_checkout_id)
      order by t.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    -- latest payment per booking (a re-pay opens a fresh checkout the sweep must query), then the
    -- most-recent stuck bookings up to the batch cap. The two orderings need separate query levels:
    -- distinct-on requires its leading sort be (b.id, pay.created_at), so recency + limit wrap it.
    -- LATERAL over (current, previous) checkout ids: a customer can complete a checkout minted
    -- before a re-pay overwrote the pointer (Peach sessions stay completable ~30 min) -- sweeping
    -- both ids means that capture is ingested instead of stranded.
    select c.ref, c.payment_id, v.checkout_id as provider_checkout_id, c.created_at
    from (
      select distinct on (b.id)
             b.id, b.ref, b.created_at, pay.id as payment_id, pay.provider_checkout_id, pay.prev_provider_checkout_id
        from bookings b
        join payments pay on pay.booking_id = b.id
       where b.status = 'payment_pending'
         and b.payment_state = 'pending'
         and b.created_at > now() - make_interval(
               mins => least(greatest(coalesce((p ->> 'graceMinutes')::int, 240), 1), 10080)
             )
         and pay.provider_checkout_id is not null
         and not exists (
               select 1 from payment_events pe
                where pe.payment_id = pay.id and pe.type in ('paid', 'refunded')
             )
       order by b.id, pay.created_at desc
    ) c
    cross join lateral (values (c.provider_checkout_id), (c.prev_provider_checkout_id)) as v(checkout_id)
    where v.checkout_id is not null
    -- recency-ordered batch, capped (default 100, hard ceiling 1000) to bound Peach API calls per run
    order by c.created_at desc
    limit least(greatest(coalesce((p ->> 'limit')::int, 100), 1), 1000)
  ) t;
$$;

create or replace function claim_notifications(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 100);
  v_lease interval := make_interval(
    secs => least(greatest(coalesce((p ->> 'leaseSeconds')::int, 300), 30), 3600)
  );
  v_rows jsonb;
begin
  -- Surface rows stranded by claim-then-crash cycles: attempts reached the cap while status stayed
  -- 'pending' -- invisible to both the claim filter (attempts < 5) and failed-row queries. Flip them
  -- to a queryable terminal 'failed'.
  update notification_outbox
     set status = 'failed', last_error = coalesce(last_error, 'attempts_exhausted')
   where status = 'pending' and attempts >= 5 and (locked_until is null or locked_until < now());

  with batch as (
    select id from notification_outbox
    where status = 'pending'
      and attempts < 5
      and (locked_until is null or locked_until <= now())
    order by created_at
    limit v_limit
    for update skip locked
  ), upd as (
    update notification_outbox o
       set attempts = attempts + 1,
           locked_until = now() + v_lease
      from batch
     where o.id = batch.id
    returning o.id, o.channel, o.recipient, o.template, o.payload, o.booking_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'channel', channel, 'recipient', recipient, 'template', template,
    'payload', payload, 'bookingId', booking_id
  )), '[]'::jsonb)
  into v_rows
  from upd;
  return v_rows;
end;
$$;

create or replace function enqueue_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', new.customer_email, 'booking_confirmation',
      jsonb_build_object(
        'ref', new.ref, 'customerName', new.customer_name,
        'totalMinor', new.total_minor, 'currency', new.currency
      ),
      new.id, 'booking_confirmation:' || new.id
    )
    on conflict (idempotency_key) do nothing;
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', 'owner', 'owner_new_booking',
      jsonb_build_object(
        'ref', new.ref, 'customerName', new.customer_name,
        'totalMinor', new.total_minor, 'currency', new.currency
      ),
      new.id, 'owner_new_booking:' || new.id
    )
    on conflict (idempotency_key) do nothing;
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'whatsapp', 'owner', 'owner_new_booking',
      jsonb_build_object(
        'ref', new.ref, 'customerName', new.customer_name,
        'totalMinor', new.total_minor, 'currency', new.currency
      ),
      new.id, 'owner_new_booking_wa:' || new.id
    )
    on conflict (idempotency_key) do nothing;
    insert into notifications (user_id, type, title, body, data)
    select p.id, 'admin_new_booking', 'New booking',
           coalesce(nullif(new.customer_name, ''), 'A guest') || ' booked ' || new.ref
             || ' — €' || to_char(new.total_minor / 100.0, 'FM999990.00'),
           jsonb_build_object('ref', new.ref, 'bookingId', new.id)
    from profiles p
    where p.role in ('staff', 'admin')
      and not exists (
        select 1 from notifications n
        where n.user_id = p.id and n.type = 'admin_new_booking'
          and n.data ->> 'bookingId' = new.id::text
      );
    if new.user_id is not null then
      insert into notifications (user_id, type, title, body, data)
      select new.user_id, 'booking_confirmed', 'Booking confirmed',
             'Your booking ' || new.ref || ' is confirmed.',
             jsonb_build_object('ref', new.ref, 'bookingId', new.id)
      where not exists (
        select 1 from notifications n
        where n.user_id = new.user_id and n.type = 'booking_confirmed'
          and n.data ->> 'bookingId' = new.id::text
      );
    end if;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if new.user_id is not null then
      insert into notifications (user_id, type, title, body, data)
      select new.user_id, 'booking_cancelled', 'Booking cancelled',
             'Your booking ' || new.ref || ' has been cancelled.',
             jsonb_build_object('ref', new.ref, 'bookingId', new.id)
      where not exists (
        select 1 from notifications n
        where n.user_id = new.user_id and n.type = 'booking_cancelled'
          and n.data ->> 'bookingId' = new.id::text
      );
    end if;
  elsif new.status = 'refunded' and old.status is distinct from 'refunded' then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', new.customer_email, 'booking_refunded',
      jsonb_build_object('ref', new.ref, 'customerName', new.customer_name),
      new.id, 'booking_refunded:' || new.id
    )
    on conflict (idempotency_key) do nothing;
    if new.user_id is not null then
      insert into notifications (user_id, type, title, body, data)
      select new.user_id, 'booking_refunded', 'Refund issued',
             'Your booking ' || new.ref || ' has been refunded.',
             jsonb_build_object('ref', new.ref, 'bookingId', new.id)
      where not exists (
        select 1 from notifications n
        where n.user_id = new.user_id and n.type = 'booking_refunded'
          and n.data ->> 'bookingId' = new.id::text
      );
    end if;
  elsif new.status = 'refund_pending' and old.status is distinct from 'refund_pending' then
    -- Money was captured but the booking can't stand (oversell race / paid-after-expiry): tell the
    -- customer their refund is coming and put the owner + staff bell on it -- this was the one
    -- money-critical transition that previously notified nobody. The customer-cancel flow
    -- (api_cancel_booking) queues its own tailored alert first, so skip when that row exists.
    if not exists (
      select 1 from notification_outbox
      where booking_id = new.id and template = 'booking_cancellation'
    ) then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', new.customer_email, 'booking_refund_pending',
        jsonb_build_object(
          'ref', new.ref, 'customerName', new.customer_name,
          'totalMinor', new.total_minor, 'currency', new.currency
        ),
        new.id, 'booking_refund_pending:' || new.id
      )
      on conflict (idempotency_key) do nothing;
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', 'owner', 'owner_refund_pending',
        jsonb_build_object(
          'ref', new.ref, 'customerName', new.customer_name,
          'totalMinor', new.total_minor, 'currency', new.currency
        ),
        new.id, 'owner_refund_pending:' || new.id
      )
      on conflict (idempotency_key) do nothing;
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'whatsapp', 'owner', 'owner_refund_pending',
        jsonb_build_object(
          'ref', new.ref, 'customerName', new.customer_name,
          'totalMinor', new.total_minor, 'currency', new.currency
        ),
        new.id, 'owner_refund_pending_wa:' || new.id
      )
      on conflict (idempotency_key) do nothing;
      insert into notifications (user_id, type, title, body, data)
      select p.id, 'admin_refund_pending', 'Refund needed',
             coalesce(nullif(new.customer_name, ''), 'A guest') || ' -- booking ' || new.ref
               || ' needs a refund in Peach.',
             jsonb_build_object('ref', new.ref, 'bookingId', new.id)
      from profiles p
      where p.role in ('staff', 'admin')
        and not exists (
          select 1 from notifications n
          where n.user_id = p.id and n.type = 'admin_refund_pending'
            and n.data ->> 'bookingId' = new.id::text
        );
    end if;
  elsif new.status = 'expired' and old.status = 'payment_pending' then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', new.customer_email, 'booking_expired',
      jsonb_build_object('ref', new.ref, 'customerName', new.customer_name),
      new.id, 'booking_expired:' || new.id
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create or replace function api_cancel_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(p ->> 'ref', '');
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_starts_at timestamptz;
begin
  if v_ref is null then
    raise exception 'invalid_request' using detail = 'cancel: ref required';
  end if;

  select * into v_booking from bookings where ref = v_ref;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Ownership: the booking's own customer, or staff. (A definer function bypasses RLS — check here.)
  if not (is_staff() or (v_uid is not null and v_booking.user_id = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: already cancelled / refund in flight / refunded → return current state, no re-enqueue.
  if v_booking.status in ('refund_pending', 'cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', v_booking.status, 'alreadyCancelled', true);
  end if;

  -- Only a confirmed, paid booking can be self-cancelled for a refund.
  if not (v_booking.status = 'confirmed' and v_booking.payment_state = 'paid') then
    raise exception 'not_cancellable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- The 24-hour window: the EARLIEST occurrence on this booking must start more than 24h from now.
  select min(so.starts_at) into v_starts_at
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_booking.id;
  if v_starts_at is null or v_starts_at <= now() + interval '24 hours' then
    raise exception 'cancellation_window_passed'
      using detail = 'self-service cancellation closes 24 hours before the activity';
  end if;

  -- Cancel → refund_pending (refund_pending frees used_capacity, so the seat is resellable at once). The
  -- actual money movement is recorded later through api_mark_refunded → append_payment_event.
  update bookings set status = 'refund_pending', updated_at = now() where id = v_booking.id;

  -- Heads-up to the owner to process the refund (best-effort; the admin refund_pending queue is the
  -- authoritative work-list). The idempotency key stops a double-cancel enqueuing twice.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'booking_cancellation',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'booking_cancellation:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', 'refund_pending');
end;
$$;

create or replace function api_erase_user(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := nullif(p ->> 'userId', '')::uuid;
  v_email text := lower(nullif(btrim(p ->> 'email'), ''));
  -- Non-paid booking statuses that are safe to hard-delete (only ever combined with payment_state pending).
  v_del_states text[] := array['draft', 'held', 'payment_pending', 'expired', 'cancelled', 'failed'];
  -- Paid / terminal statuses that must be retained (financial records) and only anonymized.
  v_anon_states text[] := array['confirmed', 'completed', 'refund_pending', 'refunded'];
  v_del_ids uuid[];
  v_del_bookings int := 0;
  v_anon_bookings int := 0;
  v_del_leads int := 0;
begin
  -- Guard: staff, or the signed-in user erasing their own account.
  if not (is_staff() or (auth.uid() is not null and v_uid is not null and auth.uid() = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Bind the email scope to the CALLER'S identity for a non-staff self-erase. The caller-supplied email
  -- is untrusted: a signed-in user could pass a stranger's address and, because the row scope matches on
  -- lower(customer_email) = v_email, sweep that stranger's GUEST bookings/leads (user_id null) — broken
  -- access control. So for non-staff we IGNORE the supplied email and force v_email to the caller's own
  -- JWT identity, read from auth.users (the SECURITY DEFINER owner can see it; auth.email() is not
  -- relied on here). This still catches the user's own pre-account guest bookings (made under their own
  -- email before they had an account), while making a stranger's email unreachable. Staff keep the
  -- supplied email — they legitimately erase a pure-guest record by its address.
  if not is_staff() then
    select lower(email) into v_email from auth.users where id = auth.uid();
  end if;

  if v_uid is null and v_email is null then
    raise exception 'invalid_request' using detail = 'erase_user: userId or email required';
  end if;

  -- ---- Hard-delete the non-retained (unpaid/abandoned) bookings + their children -------------------
  -- Identify them first; a booking matches by ownership OR guest email, must be in a deletable status
  -- AND have never carried money (payment_state pending). Anything paid is excluded here on purpose.
  select array_agg(id) into v_del_ids
    from bookings
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_del_states::booking_status[])
     and payment_state = 'pending';

  if v_del_ids is not null then
    -- FK order: holds (FK on delete set null, so delete explicitly) + items (cascades, but be explicit),
    -- then the parent bookings. payments cannot exist on a pending booking, so none to clear here.
    delete from booking_holds where booking_id = any(v_del_ids);
    delete from booking_items where booking_id = any(v_del_ids);
    delete from bookings where id = any(v_del_ids);
    get diagnostics v_del_bookings = row_count;
  end if;

  -- ---- Anonymize the retained (paid/terminal) bookings --------------------------------------------
  -- Keep the row + every financial column (total_minor, payouts, payment_state, status); strip the PII.
  -- customer_name + customer_email are NOT NULL in the schema, so they are redacted to placeholders
  -- (a routed-nowhere .invalid sentinel) rather than nulled. customer_phone + notes are nullable → null.
  -- This is an UPDATE that does NOT touch status, so the status-only enqueue trigger never re-fires.
  update bookings
     set customer_name = '(Deleted user)',
         customer_email = 'deleted@privacy.invalid',
         customer_phone = null,
         notes = null,
         traveller_gender = null,
         traveller_company = null,
         traveller_country = null,
         special_notes = null,
         room_or_cabin = null,
         luggage_details = null,
         child_seat_age = null,
         flight_number = null,
         arrival_time = null,
         return_date = null,
         return_time = null,
         departure_flight_number = null
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_anon_states::booking_status[])
     -- idempotent: skip rows already anonymized (so a second call updates 0 rows, never re-counts).
     and customer_name is distinct from '(Deleted user)';
  get diagnostics v_anon_bookings = row_count;

  -- ---- Redact the notification outbox -------------------------------------------------------------
  -- Strip recipient (the email) + the customerName key from any queued/sent message for this person,
  -- matched by the recipient address OR by linkage to one of their (still-existing, anonymized) bookings.
  -- recipient is NOT NULL in the schema, so it is redacted to the sentinel rather than nulled. Removing
  -- customerName from the payload (jsonb - key) is a no-op when the key is already absent → idempotent.
  update notification_outbox
     set recipient = 'deleted@privacy.invalid',
         payload = payload - 'customerName'
   where v_email is not null and lower(recipient) = v_email;
  -- Booking-linked rows keep their RECIPIENT -- they may address the OWNER (the 'owner' sentinel or
  -- the ops inbox), and severing that address would silently kill a pending owner alert for a real
  -- paid booking. Only the person's name leaves the payload.
  update notification_outbox
     set payload = payload - 'customerName'
   where booking_id in (
        select id from bookings
         where (v_uid is not null and user_id = v_uid)
            or (v_email is not null and lower(customer_email) = v_email)
      );
  -- Staff bell rows (admin_new_booking / admin_refund_pending) embed the customer's name in `body` --
  -- rebuild them anonymously so no feed retains PII after erasure.
  update notifications n
     set body = '(Deleted user) -- booking ' || coalesce(n.data ->> 'ref', '') || '.'
   where n.type in ('admin_new_booking', 'admin_refund_pending')
     and n.data ->> 'bookingId' in (
        select id::text from bookings
         where (v_uid is not null and user_id = v_uid)
            or (v_email is not null and lower(customer_email) = v_email)
      );

  -- ---- Redact audit_logs diffs that captured this person's PII ------------------------------------
  -- Older admin actions may have snapshotted customer fields into diff. Null the diff on rows whose
  -- entity is one of their bookings (the anonymized financial rows). Counts only; we keep the action row.
  update audit_logs
     set diff = null
   where diff is not null
     and entity_type = 'booking'
     and entity_id in (
       select id from bookings
        where (v_uid is not null and user_id = v_uid)
           or (v_email is not null and lower(customer_email) = v_email)
     );

  -- ---- Hard-delete the remaining personal data ----------------------------------------------------
  -- leads: PII lives in (name, contact); contact holds the email/phone. Delete by email match.
  if v_email is not null then
    delete from leads where lower(contact) = v_email;
    get diagnostics v_del_leads = row_count;
  end if;

  -- chat: messages cascade from sessions, but delete explicitly for clarity. By user only (no email link).
  if v_uid is not null then
    delete from chat_messages where session_id in (select id from chat_sessions where user_id = v_uid);
    delete from chat_sessions where user_id = v_uid;
    -- profile last (auth.users row itself is removed by the caller's service-role admin.deleteUser).
    delete from profiles where id = v_uid;
  end if;

  -- ---- One audit row, counts only (NO PII) -------------------------------------------------------
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    case when is_staff() then 'staff' else 'user' end,
    'erase_user',
    'user',
    v_uid,
    'gdpr erasure: deleted ' || v_del_bookings || ' booking(s), ' || v_del_leads
      || ' lead(s); anonymized ' || v_anon_bookings || ' retained booking(s)'
  );

  return jsonb_build_object(
    'ok', true,
    'deletedBookings', v_del_bookings,
    'anonymizedBookings', v_anon_bookings,
    'deletedLeads', v_del_leads
  );
end;
$$;
