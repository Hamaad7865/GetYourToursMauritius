-- Curated places for the AI Road Trip Planner — a free-form, hand-picked set of real Mauritius POIs
-- the co-pilot plans a day around (distinct from per-tour itinerary stops). Public read (shown in the
-- planner), staff write (admin editor). `api_planner_places` returns the camelCase DTO.

create table if not exists planner_places (
  id text primary key,               -- kebab-case slug
  name text not null,
  category text not null,            -- Beach | Waterfall | Viewpoint | Nature | Culture | Garden | Island | Market | Landmark | Food
  region text not null,              -- North | South | East | West | Central
  lat numeric(9, 6) not null,
  lng numeric(9, 6) not null,
  duration_min int not null check (duration_min > 0),
  closes_at time,                    -- null = open-access
  blurb text,
  image_url text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists planner_places_region_idx on planner_places (region);
create index if not exists planner_places_position_idx on planner_places (position);

alter table planner_places enable row level security;
grant select on planner_places to anon, authenticated, service_role;
grant insert, update, delete on planner_places to authenticated;
drop policy if exists planner_places_read on planner_places;
create policy planner_places_read on planner_places for select using (true);
drop policy if exists planner_places_staff on planner_places;
create policy planner_places_staff on planner_places for all using (is_staff()) with check (is_staff());

-- Seed the curated starter set (only when empty, so re-running never duplicates).
insert into planner_places (id, name, category, region, lat, lng, duration_min, closes_at, blurb, position)
select * from (values
  ('le-morne-beach',        'Le Morne Beach',        'Beach',     'South',   -20.456, 57.312, 90, null::time,      'Powder sand under a UNESCO mountain.',        0),
  ('chamarel-waterfall',    'Chamarel Waterfall',    'Waterfall', 'South',   -20.442, 57.385, 45, '17:00'::time,   'Mauritius'' tallest single-drop fall.',       1),
  ('seven-coloured-earths', 'Seven Coloured Earths', 'Nature',    'South',   -20.445, 57.374, 40, '17:00'::time,   'Dunes of seven mineral hues.',                2),
  ('gris-gris',             'Gris Gris',             'Viewpoint', 'South',   -20.511, 57.525, 30, null::time,      'Wild cliffs where the lagoon ends.',          3),
  ('grand-bassin',          'Grand Bassin',          'Culture',   'Central', -20.418, 57.492, 50, null::time,      'Sacred crater lake & temples.',               4),
  ('trou-aux-cerfs',        'Trou aux Cerfs',        'Viewpoint', 'Central', -20.319, 57.521, 30, null::time,      'Dormant crater over Curepipe.',               5),
  ('black-river-gorges',    'Black River Gorges',    'Nature',    'South',   -20.428, 57.413, 60, null::time,      'Rainforest viewpoints & trails.',             6),
  ('ile-aux-cerfs',         'Île aux Cerfs',         'Island',    'East',    -20.266, 57.792, 180, null::time,     'Castaway beaches & turquoise flats.',         7),
  ('belle-mare-beach',      'Belle Mare Beach',      'Beach',     'East',    -20.194, 57.769, 90, null::time,      'Endless east-coast white sand.',              8),
  ('cap-malheureux',        'Cap Malheureux',        'Culture',   'North',   -19.984, 57.615, 30, null::time,      'The red-roofed island chapel.',               9),
  ('grand-baie',            'Grand Baie',            'Beach',     'North',   -20.006, 57.580, 75, null::time,      'Buzzy bay, swimming & boats.',               10),
  ('pamplemousses-garden',  'Pamplemousses Garden',  'Garden',    'North',   -20.104, 57.579, 70, '17:30'::time,  'Giant lilies & spice trees.',                11)
) as v(id, name, category, region, lat, lng, duration_min, closes_at, blurb, position)
where not exists (select 1 from planner_places);

create or replace function api_planner_places(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'category', category, 'region', region,
    'lat', lat, 'lng', lng, 'durationMin', duration_min,
    'closesAt', to_char(closes_at, 'HH24:MI'), 'blurb', blurb, 'imageUrl', image_url
  ) order by position, name), '[]'::jsonb)
  from planner_places;
$$;
grant execute on function api_planner_places(jsonb) to anon, authenticated, service_role;
