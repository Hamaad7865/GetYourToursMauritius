-- Service-facing API functions. The TypeScript service layer ONLY calls these
-- (via db.rpc), so it is verified against real Postgres with no mock divergence.
-- Reads are SECURITY INVOKER (RLS applies: public sees published only); writes are
-- SECURITY DEFINER and reuse the hardened Phase 1 booking RPCs. All return jsonb.

-- Shared booking DTO builder (camelCase, EUR). SECURITY INVOKER so it inherits the
-- caller's RLS when used in api_get_booking, but returns the just-created booking
-- when called from the SECURITY DEFINER api_book (definer context = owner).
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
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- ---------------------------------------------------------------------------
-- Catalogue search (paginated). p = { q?, category?, type?, page?, pageSize? }
-- ---------------------------------------------------------------------------
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
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count,
        'fromPriceEur', (
          select min(pr.amount_minor)::float / 100
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
        ),
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        )
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from filtered),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- ---------------------------------------------------------------------------
-- Activity detail by slug (null if not found / not visible to the caller).
-- ---------------------------------------------------------------------------
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
    'pickupAvailable', a.pickup_available, 'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
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

-- ---------------------------------------------------------------------------
-- Availability for an activity over a date range, with live seats_left.
-- ---------------------------------------------------------------------------
create or replace function api_list_availability(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrenceId', so.id, 'activityOptionId', so.activity_option_id, 'optionName', o.name,
    'startsAt', so.starts_at, 'endsAt', so.ends_at, 'capacity', so.capacity,
    'seatsLeft', so.capacity - used_capacity(so.id), 'status', so.status
  ) order by so.starts_at), '[]'::jsonb)
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where a.slug = p ->> 'slug'
    and so.status = 'open'
    and so.starts_at >= coalesce((p ->> 'from')::date, current_date)::timestamptz
    and so.starts_at < (coalesce((p ->> 'to')::date, current_date + 30) + 1)::timestamptz;
$$;

-- ---------------------------------------------------------------------------
-- Book: atomically hold + create a payment_pending booking, link to the caller.
-- p = { occurrenceId, party:{label:qty}, customerName, customerEmail, customerPhone?, source?, idempotencyKey }
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
  v_total_qty int := 0;
  v_items jsonb := '[]'::jsonb;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  for r in select key, (value::text)::int as q from jsonb_each(p -> 'party') loop
    if r.q < 0 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 then raise exception 'invalid_party'; end if;

  v_hold := create_hold(v_occ, v_total_qty, v_key || ':hold');
  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items
  );

  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Create a payment for a booking. Amount comes from the DB (booking total), never
-- the client. Owner or staff only (guest bookings: anyone holding the ref).
-- p = { bookingRef, idempotencyKey }
-- ---------------------------------------------------------------------------
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
  if not (is_staff() or v_booking.user_id = auth.uid() or v_booking.user_id is null) then
    raise exception 'forbidden';
  end if;

  select * into v_payment from payments where idempotency_key = p ->> 'idempotencyKey';
  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    -- write-ahead intent event
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking status by ref (RLS-gated: owner or staff).
-- ---------------------------------------------------------------------------
create or replace function api_get_booking(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select booking_json(b.id)
  from bookings b
  where b.ref = p ->> 'ref';
$$;

-- ---------------------------------------------------------------------------
-- Capture a lead. p = { name, contact, interestActivityId?, source? }
-- ---------------------------------------------------------------------------
create or replace function api_capture_lead(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead leads;
begin
  insert into leads (name, contact, interest_activity_id, source)
  values (
    p ->> 'name', p ->> 'contact',
    nullif(p ->> 'interestActivityId', '')::uuid,
    coalesce(p ->> 'source', 'web')
  )
  returning * into v_lead;
  return jsonb_build_object(
    'id', v_lead.id, 'name', v_lead.name, 'contact', v_lead.contact,
    'interestActivityId', v_lead.interest_activity_id, 'status', v_lead.status,
    'source', v_lead.source, 'createdAt', v_lead.created_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function api_search_activities(jsonb) to anon, authenticated, service_role;
grant execute on function api_get_activity(jsonb) to anon, authenticated, service_role;
grant execute on function api_list_availability(jsonb) to anon, authenticated, service_role;
grant execute on function api_book(jsonb) to anon, authenticated, service_role;
grant execute on function api_create_payment(jsonb) to anon, authenticated, service_role;
grant execute on function api_get_booking(jsonb) to anon, authenticated, service_role;
grant execute on function api_capture_lead(jsonb) to anon, authenticated, service_role;
