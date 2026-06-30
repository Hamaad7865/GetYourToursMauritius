-- Car & scooter rental fleet — admin-managed, WhatsApp-only (NO booking/payment engine).
-- A single content table the owner edits in /admin → Rental fleet; the public /rent page reads the
-- active rows through api_list_rental_vehicles() and hands off to WhatsApp with a computed price.
-- Purely additive: this does NOT touch api_book, holds, availability or any booking/payment path.

-- 1) rental_vehicles: one row per vehicle on offer. Money in integer EUR cents. `category` is free text
--    (used only for grouping/labels on /rent — scooters vs cars), so the owner can add any class without a
--    schema change. Public read, staff edit (RLS copied verbatim from hotel_transfer_fare).
create table if not exists rental_vehicles (
  slug             text primary key,
  name             text not null,
  category         text not null default 'car',
  seats            int not null default 2,
  transmission     text,
  air_con          boolean not null default true,
  image_url        text,
  daily_rate_minor int not null,
  deposit_minor    int not null default 0,
  sort             int not null default 0,
  active           boolean not null default true,
  updated_at       timestamptz not null default now()
);
insert into rental_vehicles (slug, name, category, seats, transmission, daily_rate_minor, deposit_minor, sort) values
  ('nissan-march',   'Nissan March',   'economy', 5, 'automatic', 3600, 0, 10),
  ('nissan-note',    'Nissan Note',    'economy', 5, 'automatic', 3600, 0, 20),
  ('suzuki-ertiga',  'Suzuki Ertiga',  'family',  7, 'automatic', 3600, 0, 30),
  ('haojue-vx',      'Haojue VX',      'scooter', 2, 'automatic', 2000, 0, 40),
  ('sym-crox',       'SYM Crox',       'scooter', 2, 'automatic', 2000, 0, 50),
  ('suzuki-address', 'Suzuki Address', 'scooter', 2, 'automatic', 2000, 0, 60)
on conflict (slug) do nothing;
alter table rental_vehicles enable row level security;
grant select on rental_vehicles to anon, authenticated, service_role;
grant insert, update, delete on rental_vehicles to authenticated;
drop policy if exists rental_vehicles_read on rental_vehicles;
create policy rental_vehicles_read on rental_vehicles for select using (true);
drop policy if exists rental_vehicles_staff on rental_vehicles;
create policy rental_vehicles_staff on rental_vehicles for all using (is_staff()) with check (is_staff());

-- 2) api_list_rental_vehicles(): the public /rent read — active vehicles only, ordered for display.
--    Mirrors listRentalVehicles() in src/lib/services/rental.ts.
create or replace function api_list_rental_vehicles(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', v.slug,
    'name', v.name,
    'category', v.category,
    'seats', v.seats,
    'transmission', v.transmission,
    'airCon', v.air_con,
    'imageUrl', v.image_url,
    'dailyRateEur', v.daily_rate_minor::float / 100,
    'depositEur', v.deposit_minor::float / 100,
    'sort', v.sort
  ) order by v.sort, v.name), '[]'::jsonb)
  from rental_vehicles v
  where v.active;
$$;
grant execute on function api_list_rental_vehicles(jsonb) to anon, authenticated, service_role;
