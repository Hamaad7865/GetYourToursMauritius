-- Peach caps merchantTransactionId at 16 ALPHANUMERIC chars (a Visa/Mastercard 3-D Secure 2 mandate) and
-- strips dashes, so the old `BMT-` + 16-hex ref (20 chars, with a dash) was silently mangled in Peach to
-- `BMT` + 13 hex — breaking the admin↔Peach match AND the webhook reconcile-by-ref lookup. Make NEW refs
-- Peach-safe: 16-char alphanumeric, `BMT` + 13 hex, no dash. Existing rows keep their refs (a column
-- default only affects future inserts). The 13-hex tail is ~52 bits of entropy — collision-safe at this
-- booking volume (a UNIQUE ref would surface the astronomically-unlikely clash, not corrupt data).
alter table bookings alter column ref set default ('BMT' || upper(substr(md5(gen_random_uuid()::text), 1, 13)));
