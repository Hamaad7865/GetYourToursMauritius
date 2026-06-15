-- Restore the North Tour gallery (placeholder photos — swap url for the operator's
-- real images). Idempotent: clears then re-inserts.
delete from activity_images
where activity_id = (select id from activities where slug = 'north-tour');

insert into activity_images (activity_id, url, alt, position)
select a.id, img.url, img.alt, img.position
from activities a
cross join (values
  ('https://picsum.photos/seed/north-tour-portlouis/1200/900', 'Port Louis waterfront', 0),
  ('https://picsum.photos/seed/north-tour-market/900/700', 'Port Louis central market', 1),
  ('https://picsum.photos/seed/north-tour-garden/900/700', 'Pamplemousses Botanical Garden', 2),
  ('https://picsum.photos/seed/north-tour-grandbaie/900/700', 'Grand Baie', 3),
  ('https://picsum.photos/seed/north-tour-capmalheureux/900/700', 'Cap Malheureux red-roof church', 4)
) as img(url, alt, position)
where a.slug = 'north-tour';
