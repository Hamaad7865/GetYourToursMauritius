-- 20261030140000_home_picks
--
-- The homepage's first row (docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md). One
-- public read, identical for every visitor, so the route can cache it at the edge:
--   * mostBooked   — published tours ranked by the number of distinct bookings with status confirmed
--                    or completed made in the last 90 days. Bookings by staff/admin/seo accounts are
--                    test bookings and are left out. Ties break in catalogue order (sort, rating_count
--                    desc, title — api_search_activities' order). Only the order leaves this function,
--                    never the counts.
--   * freeTomorrow — published tours that can be booked online (not extra.inquiryOnly) with an OPEN slot
--                    TOMORROW, Mauritius date, that has not started and still has a seat. These are the
--                    rules of the winning api_list_availability body (20260728000000_activity_min_advance):
--                    status 'open', starts_at > now(), day >= today + min_advance_days, and
--                    capacity - used_capacity() > 0. Keep them in step if that body changes.
--   * date         — that tomorrow, so a cached answer read after midnight can be recognised as stale.
--
-- SECURITY DEFINER because anon cannot read bookings or profiles; it exposes slugs only.
-- The hidden transfer products (CATALOGUE_HIDDEN_SLUGS) are dropped by the page, not here: a slug the
-- catalogue does not list never reaches a tile.
-- Keep this file's SQL identical to the copy appended in supabase/catch-up.sql.

create or replace function api_home_picks(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
  v_tomorrow date := v_today + 1;
  v_most jsonb;
  v_free jsonb;
begin
  select coalesce(jsonb_agg(r.slug order by r.n desc, r.sort, r.rating_count desc, r.title), '[]'::jsonb)
  into v_most
  from (
    select a.slug, a.sort, a.rating_count, a.title, count(distinct b.id) as n
    from bookings b
    join booking_items bi on bi.booking_id = b.id
    join activity_options o on o.id = bi.activity_option_id
    join activities a on a.id = o.activity_id
    left join profiles pr on pr.id = b.user_id
    where b.status in ('confirmed', 'completed')
      and b.created_at > now() - interval '90 days'
      and a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and coalesce(pr.role::text, 'customer') not in ('staff', 'admin', 'seo')
    group by a.id
    order by n desc, a.sort, a.rating_count desc, a.title
    limit 24
  ) r;

  select coalesce(jsonb_agg(x.slug order by x.sort, x.rating_count desc, x.title), '[]'::jsonb)
  into v_free
  from (
    select a.slug, a.sort, a.rating_count, a.title
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and coalesce(a.extra -> 'inquiryOnly', 'false'::jsonb) <> 'true'::jsonb
      and v_tomorrow >= v_today + coalesce(a.min_advance_days, 1)
      and exists (
        select 1
        from session_occurrences so
        join activity_options o on o.id = so.activity_option_id
        where o.activity_id = a.id
          and so.status = 'open'
          and so.starts_at > now()
          and so.starts_at >= (v_tomorrow::timestamp at time zone 'Indian/Mauritius')
          and so.starts_at < ((v_tomorrow + 1)::timestamp at time zone 'Indian/Mauritius')
          and so.capacity - used_capacity(so.id) > 0
      )
  ) x;

  return jsonb_build_object(
    'date', to_char(v_tomorrow, 'YYYY-MM-DD'),
    'mostBooked', v_most,
    'freeTomorrow', v_free
  );
end;
$$;

revoke execute on function api_home_picks(jsonb) from public;
grant execute on function api_home_picks(jsonb) to anon, authenticated, service_role;
