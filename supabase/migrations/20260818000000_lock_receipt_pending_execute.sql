-- SECURITY: close two SECURITY DEFINER functions that were live-callable with the PUBLIC anon key.
--
-- Same class as 20260814000000 (the append_payment_event leak), missed then because these two live in
-- different migrations: 20260724000000_booking_receipt.sql and 20260729000000_payment_checkout_id.sql
-- both wrote `revoke execute ... from public` ONLY. Supabase's stock ALTER DEFAULT PRIVILEGES hands
-- every new function a DIRECT execute grant to anon + authenticated, and privileges are additive, so
-- revoking PUBLIC leaves the direct grants untouched. Verified against production on 2026-07-20:
-- has_function_privilege('anon', ...) returned TRUE for both.
--
-- Why it mattered:
--   * api_booking_receipt(jsonb) takes a bookingId and returns the full booking DTO — customer name,
--     email, phone, pickup/drop-off address, line items — plus charge amount, paidAt and the provider
--     reference. It is DEFINER, so the nested SECURITY INVOKER booking_json() runs with owner rights
--     and RLS never filters it. It has NO in-function caller guard.
--   * api_pending_payment_checkouts(jsonb) is `language sql` with no guard whatsoever, and it
--     ENUMERATES. One anon call with {"graceMinutes":10080,"limit":1000} returns booking refs, payment
--     ids and live Peach checkout ids for up to 1000 stuck payment_pending bookings from the past week,
--     without knowing any id up front. It is the discovery half: its output feeds api_booking_receipt
--     directly. Chained, an attacker holding only the public anon key could walk every in-flight
--     booking and read its customer's personal data.
--
-- Live proacl for both before this migration:
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- Neither is reachable from the browser by design: api_booking_receipt is called only by the
-- notification drain (src/lib/services/receipt.ts) and api_pending_payment_checkouts only by the
-- maintenance sweep (src/lib/services/maintenance.ts), both of which run service-role behind
-- INTERNAL_TASK_SECRET. Revoking the customer roles costs the app nothing.
--
-- Rule for every future non-public DEFINER function — name PUBLIC *and* the roles:
--   revoke execute on function f(jsonb) from public, anon, authenticated;
--   grant  execute on function f(jsonb) to service_role;
revoke execute on function api_booking_receipt(jsonb) from public, anon, authenticated;
grant execute on function api_booking_receipt(jsonb) to service_role;

revoke execute on function api_pending_payment_checkouts(jsonb) from public, anon, authenticated;
grant execute on function api_pending_payment_checkouts(jsonb) to service_role;
