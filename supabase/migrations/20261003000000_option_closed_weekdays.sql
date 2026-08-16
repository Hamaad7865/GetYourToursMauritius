-- 20261003000000_option_closed_weekdays
-- Per-option day-of-week availability. Some providers don't run every day — e.g. the sunset
-- catamaran does not operate on Sundays and Mondays. `activity_options.closed_weekdays` lists the
-- ISO weekdays (Mon=1 … Sun=7) an option is NOT available; empty = runs every day (the default, so
-- every existing option is unchanged).
--
-- Enforced at the SINGLE generation point: materialize_availability never creates (or reopens) a slot
-- on a closed weekday, so the customer calendar, the reschedule banner (api_list_availability), the
-- admin calendar, and the booking path (create_hold rejects a missing/closed slot) are all correct
-- with no change to them. set_option_weekdays_atomic writes the setting and reconciles the slots
-- already materialised for the next ~6 months — mirroring stop_availability_atomic: close the ones a
-- booking/hold/quote references (never strand a paid guest), delete the empty ones, then
-- re-materialise to refill any weekday switched back on.
--
-- Keep this file's SQL identical (idempotent form) to the copy appended in supabase/catch-up.sql, and
-- re-run `npm run setup:sql` after applying.

alter table activity_options
  add column if not exists closed_weekdays smallint[] not null default '{}';

-- Every element must be a valid ISO weekday (1..7). `<@` = "contained by".
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'activity_options_closed_weekdays_valid'
  ) then
    alter table activity_options
      add constraint activity_options_closed_weekdays_valid
      check (closed_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);
  end if;
end $$;

-- materialize_availability: the 13029 body VERBATIM, plus the closed-weekday guard on BOTH branches
-- (reopen + insert). `extract(isodow …) <> all(closed_weekdays)` is true for an empty array, so an
-- unrestricted option behaves exactly as before.
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

-- set_option_weekdays_atomic: persist an option's closed weekdays and reconcile its already-materialised
-- future slots. Mirrors stop_availability_atomic (close referenced / delete empty), scoped to this
-- option and the now-closed weekdays, then re-materialises to refill any weekday switched back on.
create or replace function set_option_weekdays_atomic(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option_id uuid := nullif(p ->> 'optionId', '')::uuid;
  v_days smallint[];
  v_activity_id uuid;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_option_id is null then
    raise exception 'invalid_request';
  end if;

  -- Parse the closed-weekday set (ISO dow, Mon=1..Sun=7). Missing/empty = runs every day.
  v_days := coalesce(
    (select array_agg((e)::int::smallint order by (e)::int)
       from jsonb_array_elements_text(coalesce(p -> 'closedWeekdays', '[]'::jsonb)) as e),
    '{}'::smallint[]
  );
  if exists (select 1 from unnest(v_days) as d where d < 1 or d > 7) then
    raise exception 'invalid_request' using detail = 'weekday must be 1..7';
  end if;

  select activity_id into v_activity_id from activity_options where id = v_option_id;
  if not found then
    raise exception 'invalid_request';
  end if;

  update activity_options set closed_weekdays = v_days where id = v_option_id;

  -- Close future closed-weekday slots that a booking item, active hold, or quote line references —
  -- never strand a paid guest, a live hold, or an offer already in a guest's inbox.
  update session_occurrences so
     set status = 'closed'
   where so.activity_option_id = v_option_id
     and so.starts_at >= now()
     and extract(isodow from (so.starts_at at time zone 'Indian/Mauritius'))::int = any(v_days)
     and (
       exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
       or exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active')
       or exists (select 1 from quote_items qi where qi.session_occurrence_id = so.id)
     );

  -- Delete empty future closed-weekday slots (no booking, no active hold, no quote line).
  delete from session_occurrences so
   where so.activity_option_id = v_option_id
     and so.starts_at >= now()
     and extract(isodow from (so.starts_at at time zone 'Indian/Mauritius'))::int = any(v_days)
     and not exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
     and not exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active')
     and not exists (select 1 from quote_items qi where qi.session_occurrence_id = so.id);

  -- Refill any weekday just switched back on.
  perform materialize_availability(jsonb_build_object('activityId', v_activity_id::text));
end;
$$;
-- `from public, anon`, not just `from public`: Supabase's stock ALTER DEFAULT PRIVILEGES grants EXECUTE
-- to anon explicitly (not via PUBLIC), and CREATE OR REPLACE never resets an existing ACL — a revoke
-- naming only PUBLIC leaves anon holding the grant. is_staff() is the first statement here, but the ACL
-- is stated correctly at the point of definition all the same.
revoke execute on function set_option_weekdays_atomic(jsonb) from public, anon;
grant execute on function set_option_weekdays_atomic(jsonb) to authenticated, service_role;
