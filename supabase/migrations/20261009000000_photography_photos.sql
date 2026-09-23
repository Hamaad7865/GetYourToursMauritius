-- 20261009000000_photography_photos
--
-- The photos on /photography and /photography/packages, managed from /admin/photography instead of
-- being hardcoded stock. (The PACKAGES' own photos are not here — a package is a catalogue activity
-- and keeps its photos in activity_images, edited in the tour editor.)
--
-- One row per photo, placed in a `slot`:
--   hero                      the /photography opening photo
--   service-weddings / -films / -couples / -family
--                             the four "What we shoot" cards
--   gallery                   "The look" masonry — many rows, ordered by position, filtered by `tags`
--   why                       the "Why book with us" photo
--   cta                       the closing call-to-action background
--   pricing-hero              the /photography/packages banner
-- A single-photo slot shows its lowest-position row; a slot with no row falls back to the built-in
-- stand-in (src/components/photography/packages-data.ts), so an empty table is a working page.
--
-- Public read (every visitor sees these), staff write — the business_settings (20260922000000) and
-- guest_reviews pattern. Content only: nothing here is priced or booked.
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

create table if not exists photography_photos (
  id uuid primary key default gen_random_uuid(),
  slot text not null
    check (slot in ('hero', 'service-weddings', 'service-films', 'service-couples',
                    'service-family', 'gallery', 'why', 'cta', 'pricing-hero')),
  url text not null check (length(btrim(url)) > 0),
  alt text,
  -- Gallery filter tabs the photo appears under. Ignored outside the gallery slot.
  tags text[] not null default '{}'
    check (tags <@ array['weddings', 'films', 'couples', 'family']::text[]),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists photography_photos_slot_idx on photography_photos (slot, position, created_at);

alter table photography_photos enable row level security;

drop policy if exists photography_photos_public_read on photography_photos;
create policy photography_photos_public_read on photography_photos for select using (true);

drop policy if exists photography_photos_staff on photography_photos;
create policy photography_photos_staff on photography_photos for all
  using (is_staff()) with check (is_staff());

grant select on photography_photos to anon, authenticated, service_role;
grant insert, update, delete on photography_photos to authenticated, service_role;
