-- Open-ended availability. An activity with activities.daily_capacity set is bookable on ANY
-- future day — no pre-generated year, no annual re-enable. The calendar materializes the day
-- slots it needs on demand (capped horizon, so the window simply rolls forward), and a day is
-- full once its bookings + holds reach the capacity. Activities with daily_capacity = null keep
-- the legacy explicit-occurrence model untouched.

alter table activities add column if not exists daily_capacity int;

-- Needed so day-materialization can de-dupe via ON CONFLICT (and a good integrity guard against
-- duplicate slots). Idempotent — also repairs databases that drifted without it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'session_occurrences_option_start_key') then
    alter table session_occurrences
      add constraint session_occurrences_option_start_key unique (activity_option_id, starts_at);
  end if;
end $$;

-- Availability for an activity over a date range, with live seats_left. For open-ended
-- activities it first fills in any missing daily slots within the (capped) window — so the
-- customer calendar always shows future dates without anyone topping it up. SECURITY DEFINER so
-- the lazy fill can write; gated to published activities, so it never leaks draft availability.
create or replace function api_list_availability(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_activity activities;
  v_from date := coalesce((p ->> 'from')::date, current_date);
  v_to date := coalesce((p ->> 'to')::date, current_date + 30);
  v_fill_to date;
  v_result jsonb;
begin
  select * into v_activity from activities where slug = p ->> 'slug';
  if not found or v_activity.status <> 'published' then
    return '[]'::jsonb;
  end if;

  v_from := greatest(v_from, current_date);
  v_to := least(v_to, current_date + 400);
  -- Bound the per-call write to ~6 months regardless of the read window, so an anonymous read
  -- can never trigger a huge fill; the window still rolls forward as current_date advances.
  v_fill_to := least(v_to, current_date + 185);

  -- Open-ended activity: fill any day in [today, fill horizon] that has NO occurrence yet for
  -- the option — compared on the UTC calendar day, so a legacy/seed slot at a different time of
  -- day blocks a duplicate and each day ends up with exactly one bookable slot. Includes today,
  -- so same-day booking works. One slot per option per day at noon UTC; capacity = daily_capacity.
  if coalesce(v_activity.daily_capacity, 0) > 0 then
    insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
    select o.id,
           v_activity.operator_id,
           (d::date + time '12:00') at time zone 'UTC',
           ((d::date + time '12:00') at time zone 'UTC')
             + make_interval(mins => coalesce(v_activity.duration_minutes, 240)),
           v_activity.daily_capacity,
           'open'
    from activity_options o
    cross join generate_series(greatest(v_from, current_date), v_fill_to, interval '1 day') d
    where o.activity_id = v_activity.id
      and exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
      and not exists (
        select 1 from session_occurrences x
        where x.activity_option_id = o.id
          and (x.starts_at at time zone 'UTC')::date = d::date
      )
    on conflict (activity_option_id, starts_at) do nothing;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrenceId', so.id, 'activityOptionId', so.activity_option_id, 'optionName', o.name,
    'startsAt', so.starts_at, 'endsAt', so.ends_at, 'capacity', so.capacity,
    -- Never report negative seats (e.g. if capacity was lowered below already-booked seats).
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
