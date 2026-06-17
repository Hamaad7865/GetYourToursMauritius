-- Planner seed data (apply AFTER the catalogue seed). The single bookable "Custom Road Trip" activity
-- the AI Road Trip Planner books against: pricing_mode='vehicle_custom' (priced from planner_pricing),
-- hidden from the public catalogue (is_custom_planner), bookable every day via daily_capacity.
-- This is DATA, not a migration (a migration would seed it into every test DB and break suites).
-- Idempotent. materialize_availability needs the option to carry a price row, so there's ONE
-- placeholder price ('Per vehicle') that the vehicle_custom pricing branch never reads.

insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')
  on conflict (slug) do nothing;

insert into activities (
  operator_id, slug, type, title, summary, category, duration_minutes, pickup_available,
  pricing_mode, is_custom_planner, status, daily_capacity
)
select o.id, 'custom-road-trip', 'activity', 'Custom Road Trip',
  'Design your own day across Mauritius with the AI planner — one flat price per vehicle.',
  'Sightseeing tours', 480, true, 'vehicle_custom', true, 'published', 10
from operators o
where o.slug = 'belle-mare-tours'
on conflict (slug) do nothing;

insert into activity_options (activity_id, name)
select a.id, 'Private vehicle'
from activities a
where a.slug = 'custom-road-trip'
  and not exists (select 1 from activity_options o where o.activity_id = a.id);

insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests, position)
select o.id, 'Per vehicle', 9500, 22, 0
from activity_options o
join activities a on a.id = o.activity_id
where a.slug = 'custom-road-trip'
  and not exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id);
