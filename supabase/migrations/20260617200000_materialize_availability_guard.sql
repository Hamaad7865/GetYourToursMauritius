-- Sweep (medium, resource-abuse): materialize_availability is SECURITY DEFINER and was granted to
-- `authenticated` with NO internal authorization check. Any signed-in customer could call it in a
-- loop and trigger a full-catalogue, up-to-400-day write across every published activity (write
-- amplification / cost), and could undo a closed-availability decision. Its only legitimate callers
-- are the admin browser (a staff user) and the service-role maintenance cron, so gate the body to
-- is_staff() OR the service_role JWT. The materialization logic itself is unchanged.
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
  -- Staff (admin browser) or the service-role maintenance worker only.
  if not (is_staff() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

  -- Reopen previously-closed, still-future day-slots for activities that are bookable again.
  update session_occurrences so
     set status = 'open'
    from activity_options o
    join activities a on a.id = o.activity_id
   where so.activity_option_id = o.id
     and so.status = 'closed'
     and so.starts_at > now()
     and a.status = 'published'
     and coalesce(a.daily_capacity, 0) > 0
     and (v_activity_id is null or a.id = v_activity_id);

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
