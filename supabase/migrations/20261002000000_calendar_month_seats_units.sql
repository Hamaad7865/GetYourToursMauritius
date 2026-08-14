-- 20261002000000_calendar_month_seats_units
-- api_admin_calendar_month.seats_left was denominated in the WRONG unit.
--
-- session_occurrences.capacity is a count of booking UNITS — guests for a seat tour, but TRIPS for a
-- private option and VEHICLES for vehicle mode (the same count used_capacity / api_reschedule_booking
-- gate on). The RPC computed `booked = Σ coalesce(bi.pax, bi.quantity)` (a guest HEADCOUNT) and then
-- `seats_left = capacity − booked`, subtracting PEOPLE from a UNIT pool: a 6-guest van on a
-- 10-vehicle/day option read seats_left = 4 instead of 9. This is the SQL twin of the day-sheet ratio
-- fix (commit 8b6cb93, DayDeparture.units) and mirrors loadMoveTargets, which already subtracts
-- Σ quantity (units) to size a move target.
--
-- The `pax` output STAYS a headcount — it is what the month grid renders as the day's guest count, and
-- it is already correct (a private day genuinely carries N guests). Only seats_left switches to the
-- new `booked_units` (Σ quantity), so it matches capacity's dimension. Counted statuses are unchanged:
-- confirmed/completed only, the set used_capacity counts.
--
-- Latent-correctness, not a live bug: seats_left is not rendered today (the month grid reads
-- pax/cancelled; the move-target picker derives its own units-based seatsLeft client-side), but it will
-- report wrong availability the moment anyone renders it — so it is fixed at the source.
--
-- Keep this file identical (function body) to the copy in supabase/catch-up.sql. Re-run catch-up.sql +
-- `npm run setup:sql` after applying (idempotent).

create or replace function api_admin_calendar_month(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := nullif(p ->> 'from', '')::date;
  v_to date := nullif(p ->> 'to', '')::date;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_from is null or v_to is null then
    raise exception 'invalid_request' using detail = 'calendar: from and to required';
  end if;
  if v_to < v_from or v_to > v_from + 62 then
    raise exception 'invalid_request' using detail = 'calendar: range must be 0-62 days';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'day', d.day,
        'departures', d.departures,
        'cancelled', d.cancelled,
        'pax', d.pax,
        'seatsLeft', d.seats_left
      ) order by d.day
    )
    from (
      select
        (o.starts_at at time zone 'Indian/Mauritius')::date          as day,
        count(*)                                                     as departures,
        count(*) filter (where o.status = 'cancelled')               as cancelled,
        coalesce(sum(o.booked), 0)                                   as pax,
        -- capacity is in UNITS, so seats_left subtracts UNITS (booked_units), never the headcount.
        coalesce(sum(greatest(o.capacity - o.booked_units, 0)), 0)   as seats_left
      from (
        select
          so.starts_at, so.status, so.capacity,
          -- HEADCOUNT (pax ?? quantity) -> the day's guest count. May exceed capacity; that is fine,
          -- it is people, not the seat pool.
          coalesce((
            select sum(coalesce(bi.pax, bi.quantity))
              from booking_items bi
              join bookings b on b.id = bi.booking_id
             where bi.session_occurrence_id = so.id
               and b.status in ('confirmed', 'completed')
          ), 0) as booked,
          -- BOOKING UNITS (sum of quantity) -> what capacity is denominated in (trips for a private
          -- option, vehicles for vehicle mode, guests for a seat tour). seats_left subtracts THIS.
          coalesce((
            select sum(bi.quantity)
              from booking_items bi
              join bookings b on b.id = bi.booking_id
             where bi.session_occurrence_id = so.id
               and b.status in ('confirmed', 'completed')
          ), 0) as booked_units
        from session_occurrences so
        -- Half-open Mauritius-local range: sargable against session_occurrences_starts_idx, unlike
        -- (starts_at at time zone ...)::date = d.
        where so.starts_at >= (v_from::timestamp at time zone 'Indian/Mauritius')
          and so.starts_at <  ((v_to + 1)::timestamp at time zone 'Indian/Mauritius')
      ) o
      group by 1
    ) d
  ), '[]'::jsonb);
end;
$$;

revoke execute on function api_admin_calendar_month(jsonb) from public, anon;
grant execute on function api_admin_calendar_month(jsonb) to authenticated, service_role;
