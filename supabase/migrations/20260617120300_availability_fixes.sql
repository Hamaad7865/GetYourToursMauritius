-- Availability consistency & lifecycle fixes (Phase-3 review).

-- ---------------------------------------------------------------------------
-- F19: align the hold lifetime with the abandonment grace + the checkout countdown.
--
-- Holds expired after 15 min, but run_booking_maintenance only expires the abandoned booking after
-- 30 min and the checkout UI promises a 30-min hold. In the 15→30 gap the seat was genuinely free
-- while the customer was still on the payment page, so another customer could take it and the
-- first-payer would be bumped to refund_pending. Hold the seat for the full 30-minute window.
-- ---------------------------------------------------------------------------
alter table booking_holds alter column expires_at set default (now() + interval '30 minutes');

-- ---------------------------------------------------------------------------
-- F5: re-enabling availability must restore days that were closed while booked.
--
-- stopAvailability() closes (and keeps) any day with a booking/active hold. On re-enable,
-- materialize_availability could not replace it: the unique (activity_option_id, starts_at)
-- constraint blocks inserting a fresh 'open' slot at the same noon-UTC time, and nothing ever
-- flipped the 'closed' row back, so the date was lost for resale forever. Reopen closed FUTURE
-- slots for activities that are bookable again (published + daily_capacity > 0) before filling.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- F16: the availability read must not advertise a slot that booking will reject.
--
-- Open-ended day-slots are materialized at noon UTC. The read returned today's slot for the whole
-- UTC calendar day, but create_hold rejects any occurrence with starts_at <= now()
-- (occurrence_in_past). After noon UTC the API therefore showed today as bookable (seatsLeft > 0)
-- while every hold/book attempt hard-failed. Filter the read on starts_at > now() to mirror
-- create_hold exactly.
-- ---------------------------------------------------------------------------
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
    and so.starts_at > now() -- mirror create_hold: never advertise a slot booking would reject
    and so.starts_at >= v_from::timestamptz
    and so.starts_at < (v_to + 1)::timestamptz;

  return v_result;
end;
$$;
