-- Fleet photo for the Nissan Note (public asset public/rental/nissan-note.webp). Idempotent and only
-- fills an EMPTY slot, so a later change to the Image URL in the admin Rental screen is never clobbered
-- by re-running catch-up.sql.
update rental_vehicles
set image_url = '/rental/nissan-note.webp'
where slug = 'nissan-note' and (image_url is null or image_url = '');
