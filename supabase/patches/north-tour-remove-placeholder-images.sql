-- Remove the placeholder gallery photos from North Tour (the operator will supply real
-- images later). With no images the detail page hides the gallery entirely. Idempotent.
delete from activity_images
where activity_id = (select id from activities where slug = 'north-tour');
