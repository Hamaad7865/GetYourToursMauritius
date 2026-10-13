-- Search titles that were costing clicks (Search Console + live crawl, 2026-10-13).
--
-- Data only, and every statement is guarded on the value it replaces: it changes a row that is still
-- in the state the audit found, once, and does nothing on a re-run or after someone edits the row in
-- /admin. (The airport-fare reset bug was a catch-up statement that re-applied itself every run —
-- an unguarded data fix overwrites the owner's later work.)

-- 1. /rent — the page was built for "belle mare car rental" (one of the owner's four target searches)
--    and its code default is "Car & Scooter Rental in Belle Mare, Mauritius". On 2026-09-14 an
--    /admin/seo override replaced that with an island-wide title and a description carrying stray
--    dots and double spaces. The page's average position went from ~9.6 to 12–15 in the weeks after,
--    while the exact Belle Mare searches stayed at 7–8. Removing the override hands the page back to
--    its default; a title the owner writes afterwards is a different row state and is left alone.
delete from seo_meta
 where path = '/rent'
   and title = 'Best Affordable Car Rental in Mauritius | Belle Mare Tours';

-- 2. The La Vallée des Couleurs day trip is titled "Vallée Adventure Park" and had no search title,
--    so its <title> never said the name people search. The French page drew 660 impressions at
--    position 7.7 in a fortnight and not one click; "la vallée des couleurs" alone was 117 of them.
--    Only seo_title is set — `title` is the tour's name on cards, bookings and invoices.
update activities
   set seo_title = 'La Vallée des Couleurs Nature Park: Day Trip | Belle Mare Tours'
 where slug = 'la-vallee-des-couleurs-nature-park-2'
   and seo_title is null;

-- 3. The French rows. api_get_activity resolves the French title as
--    coalesce(translation.seo_title, activity.seo_title), so a tour with an English search title and
--    no French one shows the ENGLISH title on its /fr page — which is what statement 2 would do to
--    the Vallée page, and what the northern-islands speedboat page already did. Machine rows only:
--    a translation the owner has reviewed (source = 'human') is never touched by a migration.
update activity_translations t
   set seo_title = 'La Vallée des Couleurs, île Maurice : excursion | Belle Mare Tours'
  from activities a
 where a.id = t.activity_id
   and a.slug = 'la-vallee-des-couleurs-nature-park-2'
   and t.locale = 'fr'
   and t.source = 'machine'
   and t.seo_title is null;

update activity_translations t
   set seo_title = 'Excursion en speedboat aux 3 îles du Nord | Belle Mare Tours'
  from activities a
 where a.id = t.activity_id
   and a.slug = 'flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only'
   and t.locale = 'fr'
   and t.source = 'machine'
   and t.seo_title is null;
