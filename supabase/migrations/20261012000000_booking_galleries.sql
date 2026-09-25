-- 20261012000000_booking_galleries
--
-- The customer's private online gallery: photos the studio uploads for one booking, viewed by
-- that booking's owner on /bookings/:ref#gallery and linked from the "gallery ready" email.
--
-- One row per photo (`booking_photos`): the file itself lives in the public activity-images
-- bucket (under galleries/<booking_id>/), uploaded from /admin/photography. Position orders the
-- grid; an empty table is simply no gallery section.
--
-- Owner-or-staff read, exactly like booking_supplements; staff write through the browser client
-- (the admin gallery card), the customer never writes. Content only: nothing priced or booked.
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

create table if not exists booking_photos (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  url text not null check (length(btrim(url)) > 0),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists booking_photos_booking_idx
  on booking_photos (booking_id, position, created_at);

alter table booking_photos enable row level security;

drop policy if exists booking_photos_select on booking_photos;
create policy booking_photos_select on booking_photos for select using (
  exists (select 1 from bookings b where b.id = booking_id and (b.user_id = auth.uid() or is_staff()))
);

drop policy if exists booking_photos_staff on booking_photos;
create policy booking_photos_staff on booking_photos for all
  using (is_staff()) with check (is_staff());

grant select on booking_photos to authenticated, service_role;
grant insert, update, delete on booking_photos to authenticated, service_role;
