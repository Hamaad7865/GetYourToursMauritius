-- Money-correctness follow-up to the duplicate-booking fix (commit 9d5e54e).
--
-- The checkout fix persists the created bookingRef per occurrence and rehydrates it on a browser
-- Back / reload of /checkout, so a customer who already paid is routed straight back into
-- POST /api/v1/payments for that ref. api_create_payment had NO status guard: it would happily
-- mint a FRESH Peach checkout session against an already-CONFIRMED (paid) booking — a second charge
-- for the same booking. It would likewise open a session on an EXPIRED / CANCELLED / REFUNDED
-- booking.
--
-- Fix: refuse payment (re)creation for any booking that is already paid or in a terminal lifecycle
-- state. The NORMAL first-payment flow (status = 'payment_pending', and the pre-payment draft/held
-- states, all with payment_state = 'pending') is unaffected. The webhook → append_payment_event
-- ledger remains the only path that confirms a booking.
--
-- Body is the WINNING api_create_payment (20260615121300_payment_authz_fix, as carried in
-- catch-up.sql) copied verbatim; the only change is the guard block right after the booking loads.
create or replace function api_create_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_payment payments;
begin
  select * into v_booking from bookings where ref = p ->> 'bookingRef';
  if not found then
    raise exception 'booking_not_found';
  end if;
  -- Refuse to (re)create a payment for a booking that is already paid or in a terminal state — a
  -- returning customer (back/reload of checkout) must not be walked into a second charge for the same
  -- booking. The pre-payment states (draft/held/payment_pending) are allowed through unchanged.
  if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
     or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'booking_not_payable' using detail = v_booking.status::text;
  end if;
  -- NB: auth.uid() must be non-null, else `null = null` is NULL (not false) and the
  -- guard would let an anonymous caller through on a guest (user_id NULL) booking.
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  select * into v_payment from payments
  where booking_id = v_booking.id and status <> 'failed'
  order by created_at desc
  limit 1;

  if not found then
    select * into v_payment from payments where idempotency_key = p ->> 'idempotencyKey';
  end if;

  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email
  );
end;
$$;
