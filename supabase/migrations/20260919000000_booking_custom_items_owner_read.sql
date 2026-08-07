-- A guest can read their OWN booking's custom lines.
--
-- 20260917000000 put `customItems` on the booking DTO and the confirmation page renders them, but the
-- guest still saw a bare total. The DTO was never the problem: `booking_json` is `security invoker`,
-- so its subquery over `booking_custom_items` runs under the CALLER's RLS — and that table has
-- carried exactly one policy since 20260909000000 introduced it:
--
--     create policy booking_custom_items_staff ... using (is_staff())
--
-- `booking_items` got an owner-or-staff SELECT policy in the original RLS migration
-- (20260615120800); its sibling never did. So for the person who paid, the subquery matched zero
-- rows and `customItems` came back `[]`.
--
-- WHY NOTHING FAILED LOUDLY. The `grant select ... to authenticated` is present, so this is not a
-- permission error — RLS filters rows, it does not raise. An empty array is indistinguishable from
-- "this booking has no custom lines", which is the normal case for every ordinary booking. Staff saw
-- the lines (the admin drawer, 20260917000000's own tests, and any check run as the table owner all
-- pass), so the gap was only ever visible to the guest. Verified against production on
-- BMTFE8B468EC8961: `booking_json` as owner returns the line; the booking's owner is `customer`, and
-- the staff-only policy is the sole policy on the table.
--
-- Mirrors booking_items_select verbatim, deliberately: the two tables hold the same thing (the lines
-- of one booking) and differ only in whether the line names an occurrence, so they must be readable
-- by the same people. An OWNERLESS quote booking (`user_id is null` — the guest paid from the emailed
-- link with no account) matches neither branch and stays invisible to anon and authenticated alike;
-- that path is read server-side under the link token, and api_claim_quote_bookings is what later
-- fills `user_id` in and brings the booking under this policy.

begin;

drop policy if exists booking_custom_items_select on booking_custom_items;
create policy booking_custom_items_select on booking_custom_items for select using (
  exists (select 1 from bookings b where b.id = booking_id and (b.user_id = auth.uid() or is_staff()))
);

commit;
