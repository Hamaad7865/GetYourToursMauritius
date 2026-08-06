-- =============================================================================
-- Sandbox seed — publish + availability
--
-- Run by `npm run sandbox:setup` (scripts/sandbox/setup-sandbox.ts) AFTER
-- setup.sql, catch-up.sql, seed-catalogue.sql and seed-activity-regions.sql
-- have loaded the schema + the 32 draft activities + transfers/rentals.
--
-- It turns that draft catalogue into a *bookable* sandbox:
--   1. publishes every draft activity,
--   2. gives every non-planner activity a daily capacity pool and zero lead time,
--   3. materialises ~60 days of open, noon-Mauritius availability slots.
--
-- Fully idempotent — safe to re-run. Fake bookings live in sandbox-bookings.sql
-- (they run after the test users are created, so a booking can be owned).
-- =============================================================================

begin;

-- 1) Publish the seeded drafts so the storefront + availability RPCs see them.
--    (activity_status enum is only 'draft' | 'published'.)
update activities set status = 'published' where status = 'draft';

-- 2) Give everything bookable a capacity pool and make it same-day bookable.
--    coalesce() preserves the transfer pools catch-up.sql already tuned (40);
--    the catalogue's NULL pools become 20. The AI planner activity is excluded
--    (is_custom_planner) — it is never a normal bookable card.
update activities
   set daily_capacity  = coalesce(daily_capacity, 20),
       min_advance_days = 0
 where coalesce(is_custom_planner, false) = false
   and status = 'published';

-- 3) sightseeing_pricing is the singleton the vehicle_custom / vehicle pricing
--    branch reads; catch-up.sql already seeds it, but assert it so a vehicle
--    tour can never raise `sightseeing_pricing_unset` in the sandbox.
insert into sightseeing_pricing (id) values (true) on conflict (id) do nothing;

-- 4) Materialise availability: one open slot per option per day at noon Mauritius
--    time for the next 60 days, for every published, non-planner option that
--    carries at least one price row. This is exactly what catch-up.sql does for
--    the transfer activities; here it is generalised to the whole catalogue.
--    Runs as the DB owner (this script is applied over SUPABASE_DB_URL), so it
--    does NOT need the service-role-gated materialize_availability() definer.
insert into session_occurrences
       (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
select o.id,
       a.operator_id,
       ((d::date + time '12:00') at time zone 'Indian/Mauritius'),
       ((d::date + time '12:00') at time zone 'Indian/Mauritius')
         + make_interval(mins => coalesce(a.duration_minutes, 240)),
       coalesce(a.daily_capacity, 20),
       'open'
  from activities a
  join activity_options o on o.activity_id = a.id
 cross join generate_series(
         (now() at time zone 'Indian/Mauritius')::date,
         (now() at time zone 'Indian/Mauritius')::date + 60,
         interval '1 day') d
 where a.status = 'published'
   and coalesce(a.is_custom_planner, false) = false
   and exists (select 1 from activity_option_prices pr
                where pr.activity_option_id = o.id)
   and not exists (select 1 from session_occurrences x
                    where x.activity_option_id = o.id
                      and (x.starts_at at time zone 'Indian/Mauritius')::date = d::date)
on conflict (activity_option_id, starts_at) do nothing;

commit;
