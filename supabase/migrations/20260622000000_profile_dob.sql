-- Optional date of birth on customer profiles, shown/edited on the account
-- "Personal details" page. RLS profiles_update already lets a user edit their own
-- row (column-agnostic), so no policy change is needed. The GDPR erase
-- (api_erase_user) deletes the whole profiles row, so this PII column is wiped on
-- erasure too — no change needed there either.
alter table profiles add column if not exists date_of_birth date;
