-- Booking history — the signed-in customer's full "My Trips" (Upcoming/Past) list.
--
-- GET /api/v1/bookings (owner-scoped, paginated) needs a thin list the detail endpoint
-- (GET /bookings/{ref}) doesn't provide. Mirrors api_my_pending_bookings' lateral-join shape
-- (booking -> first item -> occurrence/activity/hero image) but returns ALL of the caller's
-- bookings (any status), newest first, as BookingSummary rows. Money is `totalEur` (EUR major
-- units, consistent with GET /bookings/{ref}) — NOT the *_minor the cart's pending list uses.
-- Optional `status` and trip-date (`from`,`to`) filters; offset pagination like api_search_activities.
-- SECURITY DEFINER + an explicit auth.uid() filter is the same RLS-safe seam as
-- api_my_pending_bookings (reads booking_items/session_occurrences without widening their RLS).
create or replace function api_my_bookings(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := nullif(p ->> 'status', '');
  v_from date := nullif(p ->> 'from', '')::date;
  v_to date := nullif(p ->> 'to', '')::date;
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_page_size int := least(greatest(coalesce((p ->> 'pageSize')::int, 20), 1), 100);
  v_total int;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- One representative occurrence per booking (its first item), exactly like api_my_pending_bookings,
  -- so title / startsAt / heroImage and the trip-date filter all key off the same slot.
  with mine as (
    select
      b.id, b.ref, b.status, b.payment_state, b.total_minor, b.currency, b.created_at,
      a.id as activity_id, coalesce(a.title, 'Your booking') as title, occ.starts_at
    from bookings b
    left join lateral (
      select bi.session_occurrence_id, bi.activity_option_id from booking_items bi
      where bi.booking_id = b.id
      order by bi.created_at
      limit 1
    ) item on true
    left join session_occurrences occ on occ.id = item.session_occurrence_id
    left join activity_options ao on ao.id = item.activity_option_id
    left join activities a on a.id = ao.activity_id
    where b.user_id = v_uid
      and (v_status is null or b.status::text = v_status)
      and (v_from is null or occ.starts_at >= v_from)
      and (v_to is null or occ.starts_at < (v_to + 1))
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', m.ref,
        'title', m.title,
        'status', m.status,
        'paymentState', m.payment_state,
        'totalEur', m.total_minor::float / 100,
        'currency', m.currency,
        'startsAt', m.starts_at,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = m.activity_id order by img.position limit 1
        ),
        'createdAt', m.created_at
      ) order by m.created_at desc)
      from (
        select * from mine
        order by created_at desc
        limit v_page_size
        offset (v_page - 1) * v_page_size
      ) m
    ), '[]'::jsonb),
    (select count(*)::int from mine)
  into v_items, v_total;

  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

revoke execute on function api_my_bookings(jsonb) from public;
grant execute on function api_my_bookings(jsonb) to authenticated;
