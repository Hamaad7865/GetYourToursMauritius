-- Refuse an activity coordinate that cannot be in Mauritius.
--
-- On 2026-08-03 the activities map looked comprehensively broken — pins piled into the sea, nothing
-- near where the tours actually run. The cause was ONE row: private-luxury-speedboat-5-island had
-- lng = 57779735 instead of 57.779735. A single missing decimal point.
--
-- One value seven million degrees off the map is enough to wreck the auto-fit that decides the map's
-- centre and zoom, so all 43 correctly-placed activities got squashed into a corner. One keystroke,
-- every pin wrong, and NOTHING complained: not the admin form, not the database, not a test. The map
-- just looked broken and no error was ever raised.
--
-- A bounds check is the cheapest possible guard: the save fails loudly instead of silently poisoning
-- every other pin. Latitude was fine in that incident, but it is constrained too — the same slip on
-- the other field is equally possible.
--
-- NULL is allowed on purpose: custom-road-trip has no fixed location and must not be forced to invent
-- one. The map should skip an activity without coordinates, not pin it at a made-up point.
--
-- Bounds cover the main island with margin (it spans roughly -20.52..-19.98 lat, 57.31..57.80 lng).
-- Rodrigues (~-19.7, 63.4) is deliberately OUTSIDE: no activity runs there, so a hit that far east is
-- a typo, not a location. If Rodrigues tours are ever added, widen maxLat to -19.6 and maxLng to 63.5
-- HERE and in scripts/geocode-activities.mjs, which enforces the same window before it writes.

alter table activities drop constraint if exists activities_lat_in_mauritius;
alter table activities add constraint activities_lat_in_mauritius
  check (lat is null or (lat >= -20.6 and lat <= -19.9));

alter table activities drop constraint if exists activities_lng_in_mauritius;
alter table activities add constraint activities_lng_in_mauritius
  check (lng is null or (lng >= 57.2 and lng <= 57.9));

comment on column activities.lat is
  'Latitude of where the activity actually happens; NULL means no fixed location (the map skips it, '
  'it is never pinned at a fallback point). Bounds-checked to Mauritius — a mistyped coordinate used '
  'to break the auto-fit for EVERY other pin on the map without raising anything.';
comment on column activities.lng is
  'Longitude; see activities.lat. The 2026-08-03 incident was lng 57779735 instead of 57.779735.';
