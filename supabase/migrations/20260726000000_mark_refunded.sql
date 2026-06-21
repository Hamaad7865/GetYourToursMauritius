-- P1: an admin cancel of a PAID booking flips it to refund_pending, but NOTHING ever moves it on to
-- refunded. The only code that records a refund is append_payment_event on a `refunded` provider event,
-- which arrives solely via the Peach webhook / status re-query. A manual admin cancel is a pure DB flip
-- (Peach is never told), so a real refund done by hand in the Peach dashboard never produces an event:
-- the booking sits in refund_pending forever and the customer never gets the booking_refunded email.
--
-- api_mark_refunded lets staff record that the manual refund happened. It records the refund through the
-- SAME ledger path the webhook uses (append_payment_event with a synthesised, idempotent provider_event_id)
-- so the payment + booking transition to `refunded`, refunded_minor is set, and the booking_refunded
-- notification fires via the existing enqueue trigger — identical to a real refund webhook. SECURITY
-- DEFINER + is_staff() guard (append_payment_event is granted to service_role only; this is the staff door).
create or replace function api_mark_refunded(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid := nullif(p ->> 'bookingId', '')::uuid;
  v_booking bookings;
  v_payment payments;
  v_amount bigint;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_booking_id is null then
    raise exception 'invalid_request' using detail = 'mark_refunded: bookingId required';
  end if;

  select * into v_booking from bookings where id = v_booking_id;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Most recent payment for this booking (the one the customer was charged on).
  select * into v_payment from payments
   where booking_id = v_booking_id
   order by created_at desc
   limit 1;
  if not found then
    raise exception 'payment_not_found';
  end if;

  -- Already fully refunded → no-op (idempotent: a repeat click must not error or re-enqueue).
  if v_payment.status = 'refunded' then
    return jsonb_build_object('ok', true, 'alreadyRefunded', true);
  end if;

  -- Only a booking whose money is actually held may be refunded: the cancel path lands it in
  -- refund_pending (payment_state stays paid), or staff refund a confirmed/completed paid booking
  -- directly. Anything else (unpaid, draft, already cancelled with no money) is rejected.
  if not (
    v_booking.status in ('refund_pending', 'confirmed', 'completed')
    and v_payment.status in ('paid', 'partially_refunded')
  ) then
    raise exception 'not_refundable'
      using detail = format('booking %s / payment %s', v_booking.status, v_payment.status);
  end if;

  -- Reverse the full outstanding (paid − already-refunded) amount. append_payment_event derives the
  -- refunded state from the SUM of refund events, so this carries the booking to refunded in one step.
  v_amount := greatest(v_payment.paid_minor - v_payment.refunded_minor, 0);

  -- Record through the SAME path the webhook uses. The synthesised provider_event_id makes it idempotent
  -- at the ledger: a second call with the same id hits the (payment_id, provider_event_id) conflict and is
  -- a no-op, so the booking_refunded enqueue (which also guards old.status is distinct from 'refunded')
  -- never double-fires. This sets refunded_minor, transitions payment + booking to refunded, releases holds.
  perform append_payment_event(
    v_payment.id,
    'refunded',
    'manual:refund:' || v_booking_id::text,
    v_amount,
    now(),
    jsonb_build_object('source', 'admin_mark_refunded', 'bookingId', v_booking_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_mark_refunded(jsonb) from public;
grant execute on function api_mark_refunded(jsonb) to authenticated, service_role;
