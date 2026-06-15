-- Dynamic categories: a managed table that becomes the canonical category list, so staff can
-- add/edit/remove categories from the admin with no code change. `activities.category` is
-- freed from the fixed enum to plain text. Existing activities keep their category names, and
-- the table is seeded with the original seven, so nothing changes until staff edit it.

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  position int not null default 0,
  image_url text,
  status text not null default 'active' check (status in ('active', 'hidden')),
  created_at timestamptz not null default now()
);

create index if not exists categories_position_idx on categories (position);

insert into categories (name, slug, position) values
  ('Catamaran cruises', 'catamaran-cruises', 0),
  ('Île aux Cerfs', 'ile-aux-cerfs', 1),
  ('Dolphin swims', 'dolphin-swims', 2),
  ('Sea walks & diving', 'sea-walks-diving', 3),
  ('Parasailing', 'parasailing', 4),
  ('Island tours', 'island-tours', 5),
  ('Airport transfers', 'airport-transfers', 6)
on conflict (name) do nothing;

-- Free activities.category from the enum so newly-created categories are assignable. The only
-- SQL that reads it already casts `category::text`, and the index rebuilds automatically.
alter table activities alter column category type text using category::text;

-- RLS: anyone may read active categories (public nav/filters); staff manage them.
alter table categories enable row level security;
grant select on categories to anon, authenticated;
grant insert, update, delete on categories to authenticated;

drop policy if exists categories_public_read on categories;
create policy categories_public_read on categories
  for select using (status = 'active' or is_staff());
drop policy if exists categories_staff_all on categories;
create policy categories_staff_all on categories
  for all using (is_staff()) with check (is_staff());
