-- Move open-ended day-slot materialization OFF the read path.
--
-- Previously api_list_availability was VOLATILE + SECURITY DEFINER and ran an INSERT...SELECT on
-- EVERY read (even anonymous), so a crawler or traffic spike turned cacheable GETs into serialized
-- DB writes — the binding availability bottleneck. Now:
--   * api_list_availability is a pure STABLE read (no write amplification, cacheable);
--   * materialize_availability() does the fill, run by the maintenance cron (rolling the window
--     forward as today advances) and immediately by the admin when an activity is made bookable.
-- Capped horizon, idempotent, deduped on the UTC calendar day.

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
  v_count int;
begin
  insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
  select o.id,
         a.operator_id,
         (d::date + time '12:00') at time zone 'UTC',
         ((d::date + time '12:00') at time zone 'UTC') + make_interval(mins => coalesce(a.duration_minutes, 240)),
         a.daily_capacity,
         'open'
  from activities a
  join activity_options o on o.activity_id = a.id
  cross join generate_series(current_date, current_date + v_days, interval '1 day') d
  where a.status = 'published'
    and coalesce(a.daily_capacity, 0) > 0
    and (v_activity_id is null or a.id = v_activity_id)
    and exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
    and not exists (
      select 1 from session_occurrences x
      where x.activity_option_id = o.id
        and (x.starts_at at time zone 'UTC')::date = d::date
    )
  on conflict (activity_option_id, starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function materialize_availability(jsonb) from public;
grant execute on function materialize_availability(jsonb) to authenticated, service_role;

-- Pure read (was VOLATILE + lazy INSERT). create-or-replace preserves the existing anon grant.
create or replace function api_list_availability(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_activity activities;
  v_from date := coalesce((p ->> 'from')::date, current_date);
  v_to date := coalesce((p ->> 'to')::date, current_date + 30);
  v_result jsonb;
begin
  select * into v_activity from activities where slug = p ->> 'slug';
  if not found or v_activity.status <> 'published' then
    return '[]'::jsonb;
  end if;

  v_from := greatest(v_from, current_date);
  v_to := least(v_to, current_date + 400);

  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrenceId', so.id, 'activityOptionId', so.activity_option_id, 'optionName', o.name,
    'startsAt', so.starts_at, 'endsAt', so.ends_at, 'capacity', so.capacity,
    'seatsLeft', greatest(so.capacity - used_capacity(so.id), 0), 'status', so.status
  ) order by so.starts_at), '[]'::jsonb)
  into v_result
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  where o.activity_id = v_activity.id
    and so.status = 'open'
    and so.starts_at >= v_from::timestamptz
    and so.starts_at < (v_to + 1)::timestamptz;

  return v_result;
end;
$$;
