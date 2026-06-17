-- Scheduled booking maintenance (called by the /internal/maintenance worker on a cron).
--
-- Two jobs, neither of which had a caller before:
--   1) expire_holds() — flip stale active holds to 'expired' (status hygiene; the availability
--      formula already ignores expired holds, but un-swept rows accumulate forever).
--   2) Expire abandoned bookings — a booking left in payment_pending past a grace window with no
--      successful payment is dead weight. Mark it 'expired' and release its holds so the seats are
--      cleanly freed. SAFE against a delayed real payment: if money lands later, append_payment_event
--      routes an expired/cancelled booking to refund_pending rather than confirming it.
--
-- NOTE: this does NOT cover the missed-webhook case (payment succeeded but the webhook was lost) —
-- that needs polling the provider and lands with the real Peach integration.
create or replace function run_booking_maintenance(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_grace interval := make_interval(
    mins => least(greatest(coalesce((p ->> 'graceMinutes')::int, 30), 1), 1440)
  );
  v_holds int;
  v_bookings int;
begin
  v_holds := expire_holds();

  with stale as (
    update bookings b
       set status = 'expired', updated_at = now()
     where b.status in ('draft', 'held', 'payment_pending')
       and b.payment_state = 'pending'
       and b.created_at < now() - v_grace
       and not exists (
         select 1 from payments pay
         where pay.booking_id = b.id
           and pay.status in ('paid', 'partially_refunded', 'refunded')
       )
    returning b.id
  )
  select count(*) into v_bookings from stale;

  -- Release any active holds still attached to the just-expired bookings.
  update booking_holds h
     set status = 'released'
    from bookings b
   where h.booking_id = b.id and b.status = 'expired' and h.status = 'active';

  return jsonb_build_object('holdsExpired', v_holds, 'bookingsExpired', v_bookings);
end;
$$;

revoke execute on function run_booking_maintenance(jsonb) from public;
grant execute on function run_booking_maintenance(jsonb) to service_role;
