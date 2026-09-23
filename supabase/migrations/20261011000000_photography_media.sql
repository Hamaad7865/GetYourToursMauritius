-- 20261011000000_photography_media
--
-- The photography gallery gets VIDEOS and its own page (/photography/gallery):
--   * media_type  'image' (default — every existing row) | 'video'. A video row's `url` is either an
--                 uploaded file (mp4/webm/mov in the public activity-images bucket) or a YouTube /
--                 Vimeo link; the page decides how to play it from the URL.
--   * poster_url  optional cover image for a video (shown before it plays, and in the film strip).
--   * slot        adds 'gallery-hero' — the banner at the top of the new gallery page.
-- The gallery CATEGORIES stay the four filter tabs (weddings, films, couples, family) in `tags`.
--
-- Additive and idempotent (this file is appended verbatim to supabase/catch-up.sql): the new columns
-- default so no existing row changes; the slot CHECK is dropped and re-added with one more value.

alter table photography_photos
  add column if not exists media_type text not null default 'image';
alter table photography_photos
  add column if not exists poster_url text;

alter table photography_photos drop constraint if exists photography_photos_media_type_check;
alter table photography_photos add constraint photography_photos_media_type_check
  check (media_type in ('image', 'video'));

alter table photography_photos drop constraint if exists photography_photos_slot_check;
alter table photography_photos add constraint photography_photos_slot_check
  check (slot in ('hero', 'service-weddings', 'service-films', 'service-couples',
                  'service-family', 'gallery', 'why', 'cta', 'pricing-hero', 'gallery-hero'));

-- Only the gallery plays videos; every other slot is a single photo.
alter table photography_photos drop constraint if exists photography_photos_video_gallery_only;
alter table photography_photos add constraint photography_photos_video_gallery_only
  check (media_type = 'image' or slot = 'gallery');
