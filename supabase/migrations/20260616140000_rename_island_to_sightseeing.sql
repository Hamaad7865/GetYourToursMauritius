-- Owner request: rename the "Island tours" category to "Sightseeing tours".
-- Categories are modelled three ways after the dynamic-categories work: a managed `categories`
-- table (the canonical list), a free-text `activities.category` column, and a now-vestigial
-- `activity_category` enum (left from before the column was relaxed to text). Update all three so
-- a fresh DB and the live DB agree. Every statement is idempotent / guarded, so re-running (and
-- a DB that already has the new name) is a no-op.

-- 1) Vestigial enum value — unused by the text column, kept consistent. Guarded: only rename if
--    the old label still exists.
do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'activity_category' and e.enumlabel = 'Island tours'
  ) then
    alter type activity_category rename value 'Island tours' to 'Sightseeing tours';
  end if;
end $$;

-- 2) The managed category row (name + slug). The slug feeds /activities?category= nav links.
update categories
   set name = 'Sightseeing tours', slug = 'sightseeing-tours'
 where name = 'Island tours' or slug = 'island-tours';

-- 3) Any activities already filed under the old name.
update activities set category = 'Sightseeing tours' where category = 'Island tours';
