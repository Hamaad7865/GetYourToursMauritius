-- 20261109120000_zilai_maintenance
--
-- The owner's switch for ZilAi's maintenance notice: a slim strip under the assistant's header that
-- tells visitors it may not reply, with a "Contact us" link. Flipped from the admin Dashboard
-- (ZilAiMaintenanceCard), read by the assistant panel each time it is opened — no redeploy either way.
--
-- NULL = off (the default). Set to now() to show the notice; the timestamp lets the card say since when.
-- It only shows a notice: the chat itself stays usable, so a model that comes back mid-notice still
-- answers.
--
-- Lives on the business_settings singleton (20260922000000), which already has the boundary wanted:
-- world-readable (every visitor's panel reads it), staff-writable under RLS. Not a money column, so the
-- business_settings_money_guard trigger (20261025140000) leaves it alone.
--
-- Re-runnable on its own, like every statement catch-up.sql replays.

alter table business_settings
  add column if not exists zilai_maintenance_since timestamptz;

comment on column business_settings.zilai_maintenance_since is
  'NULL = ZilAi maintenance notice OFF. Set to now() to show it in the assistant panel. Flipped from '
  'the admin Dashboard; read by src/components/planner/assistant/MaintenanceNotice.tsx.';
