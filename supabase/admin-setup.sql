-- ============================================================================
-- One-time admin setup for Belle Mare Tours.
-- Run this ONCE against the LIVE database, e.g. in the Supabase SQL editor
-- (or: npx tsx scripts/db-exec.ts supabase/admin-setup.sql).
--
-- It is NOT part of the normal migration set and is NOT bundled into setup.sql,
-- so re-running `npm run db:setup` will not undo it (but db:setup re-seeds the
-- demo catalogue — don't run it after step 1 unless you want the others back).
-- ============================================================================

-- 1) CATALOGUE RESET — keep only "North Tour", delete everything else.
--    The cascade also removes their images, options, prices, occurrences and
--    translations. This is permanent.
delete from activities where slug <> 'north-tour';

-- 2) MAKE YOURSELF AN ADMIN.
--    You must have signed up in the app first (so your profile row exists).
--    Change the email below to the account you signed up with.
update profiles
set role = 'admin'
where id = (select id from auth.users where email = 'boodoo.sheik786@gmail.com');

-- 3) IMAGE UPLOADS — a public Storage bucket + policies so content editors (staff/admin + the
--    'seo' content role) can upload photos from the admin and the public can view them.
--    The role check is INLINED (not is_staff()/is_content_editor()) so this script has no
--    ordering dependency on catch-up.sql.
insert into storage.buckets (id, name, public)
values ('activity-images', 'activity-images', true)
on conflict (id) do nothing;

drop policy if exists "activity_images_public_read" on storage.objects;
create policy "activity_images_public_read" on storage.objects
  for select using (bucket_id = 'activity-images');

drop policy if exists "activity_images_staff_insert" on storage.objects;
create policy "activity_images_staff_insert" on storage.objects
  for insert with check (bucket_id = 'activity-images' and exists (
    select 1 from public.profiles where id = auth.uid() and role::text in ('staff', 'admin', 'seo')
  ));

drop policy if exists "activity_images_staff_update" on storage.objects;
create policy "activity_images_staff_update" on storage.objects
  for update using (bucket_id = 'activity-images' and exists (
    select 1 from public.profiles where id = auth.uid() and role::text in ('staff', 'admin', 'seo')
  ));

drop policy if exists "activity_images_staff_delete" on storage.objects;
create policy "activity_images_staff_delete" on storage.objects
  for delete using (bucket_id = 'activity-images' and exists (
    select 1 from public.profiles where id = auth.uid() and role::text in ('staff', 'admin', 'seo')
  ));
