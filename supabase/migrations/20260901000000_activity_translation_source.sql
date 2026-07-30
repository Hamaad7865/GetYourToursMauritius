-- Distinguishes machine-drafted French from owner-reviewed French, so the admin activity editor can
-- show an unreviewed worklist instead of a silent wall of text that may or may not have been checked.
-- Default 'human': the rows that already exist were hand-written in the seed.
alter table activity_translations
  add column if not exists source text not null default 'human'
  check (source in ('machine', 'human'));

comment on column activity_translations.source is
  'human = written or approved by staff; machine = drafted automatically, awaiting review in /admin.';
