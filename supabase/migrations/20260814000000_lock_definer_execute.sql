-- Lock down SECURITY DEFINER functions that leaked EXECUTE to anon + authenticated.
--
-- Root cause: these functions were created with only `revoke ... from public`. In this Supabase
-- project, default privileges ALSO grant EXECUTE to anon + authenticated at function-creation time,
-- and `revoke from public` does NOT remove those explicit role grants (the same trap the
-- 20260806000000 lockdown fixed for the api_* RPCs). Verified on the live DB: the ACL for
-- append_payment_event was {postgres=X, anon=X, authenticated=X, service_role=X}.
--
-- CRITICAL: append_payment_event has no in-function caller guard — it trusts the grant. An
-- authenticated user (or anyone with the anon key + a payment id) could call it via PostgREST with a
-- forged 'paid' event, flipping their booking to `confirmed` with no real payment. A pure payment
-- bypass. The others are internal (server/service_role or performed inside other SECURITY DEFINER
-- functions or fired by a trigger), never called by the browser client — so revoking anon/authenticated
-- is safe (nested SECURITY DEFINER calls check EXECUTE against the definer, not the original caller;
-- trigger execution never checks the caller's EXECUTE).
--
-- Deliberately NOT touched: used_capacity() (a read-only helper called inside SECURITY INVOKER
-- functions api_get_activity/booking_json — revoking it would break the activity page for everyone),
-- and the staff-facing definer RPCs (set_daily_capacity_atomic, api_mark_refunded, …) which are called
-- by authenticated staff and already guard with is_staff().

revoke execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) to service_role;

revoke execute on function release_hold(uuid) from public, anon, authenticated;
grant execute on function release_hold(uuid) to service_role;

revoke execute on function run_booking_maintenance(jsonb) from public, anon, authenticated;
grant execute on function run_booking_maintenance(jsonb) to service_role;

revoke execute on function expire_holds() from public, anon, authenticated;
grant execute on function expire_holds() to service_role;

revoke execute on function enqueue_booking_notification() from public, anon, authenticated;
grant execute on function enqueue_booking_notification() to service_role;

revoke execute on function claim_notifications(jsonb) from public, anon, authenticated;
grant execute on function claim_notifications(jsonb) to service_role;

revoke execute on function mark_notification(jsonb) from public, anon, authenticated;
grant execute on function mark_notification(jsonb) to service_role;
