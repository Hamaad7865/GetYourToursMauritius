-- Per-line TRANSPORT ADD-ON: a round-trip transfer attached to a tour/custom line, not a separate line.
--
-- Today a transfer is quoted as its own `custom` line, unlinked to the tour it serves, with the pickup
-- only in the description text — so on the operations calendar the transfer is a standalone card and its
-- pickup/drop-off does not travel with the activity. This attaches the transfer to the line itself, as
-- three nullable columns on every table a priced line lives in, so the add-on survives quote -> booking
-- conversion and reaches the day sheet and the receipt.
--
-- The line's own `subtotal_minor` stays the tour/custom price; `transport_fare_minor` is a SEPARATE amount
-- on the same row and is added into the quote/booking total wherever the total is computed (Σ subtotals +
-- Σ transport fares). Null on every table for a line with no transfer, which is every line today — so this
-- migration is purely additive and changes no existing figure.
--
-- Rentals never carry a transport add-on (a car IS the transport); that is enforced in the editor and the
-- save path, not by the schema.
--
-- Mirror into supabase/catch-up.sql and regenerate supabase/setup.sql (`npm run setup:sql`); add
-- ('20260924000000','line_transport_addon') to supabase/backfill-migration-ledger.sql.

alter table quote_items
  add column if not exists transport_pickup_label text,
  add column if not exists transport_dropoff_label text,
  add column if not exists transport_fare_minor bigint
    check (transport_fare_minor is null or transport_fare_minor >= 0);

alter table booking_items
  add column if not exists transport_pickup_label text,
  add column if not exists transport_dropoff_label text,
  add column if not exists transport_fare_minor bigint
    check (transport_fare_minor is null or transport_fare_minor >= 0);

alter table booking_custom_items
  add column if not exists transport_pickup_label text,
  add column if not exists transport_dropoff_label text,
  add column if not exists transport_fare_minor bigint
    check (transport_fare_minor is null or transport_fare_minor >= 0);
