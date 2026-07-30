-- Reclassify never-reviewed French stubs as machine drafts.
--
-- Migration 20260901000000 added activity_translations.source and defaulted every existing row to
-- 'human'. That was wrong for the rows already in the table: they were written by a seed script, and
-- the admin UI for reviewing French copy did not exist until 2026-07-31. Nobody could have reviewed
-- them.
--
-- The consequence is not cosmetic. seed-fr-catalogue.sql refuses to overwrite a 'human' row — that
-- guard exists so a redeploy cannot discard the owner's corrections — so a stub left marked 'human'
-- would be skipped forever. The live case: the north-tour activity carried a French title
-- translating an OLDER English title ("North Tour – Port-Louis…" against a tour since renamed to
-- "Private North Tour Mauritius"). A French visitor would have seen a stale title with English
-- everywhere else, which is exactly the half-translated state this project exists to remove.
--
-- Targets only genuine stubs: a row with no description AND no highlights was never a real review.
-- If the owner has since filled either in, the row is left alone.
update activity_translations
set source = 'machine'
where locale = 'fr'
  and source = 'human'
  and description is null
  and coalesce(array_length(highlights, 1), 0) = 0;
