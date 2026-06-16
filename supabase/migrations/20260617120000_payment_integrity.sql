-- F3: bind a settlement to a single, unambiguous payment row per booking.
--
-- The webhook resolves "the payment for this booking" as the most-recently-created payments row
-- (order by created_at desc limit 1). If a booking ever had more than one payment row, a provider
-- settlement (paid/refunded) could credit the WRONG one, mis-routing later refund/chargeback events
-- and corrupting per-transaction ledger binding. The previous api_create_payment inserted a brand
-- new row whenever the (client-supplied or service-generated) idempotency key differed, so a raw
-- re-POST to /api/v1/payments produced two rows for one booking.
--
-- Fix: reuse the existing LIVE payment for the booking (at most one open/settled payment per
-- booking) instead of inserting a duplicate. A previously FAILED attempt is left behind and a fresh
-- intent is created, so retries after a failure still work. With at most one non-failed row,
-- "most recent" is always the right row.
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
  -- Preserve the Phase-2 authz fix: a public booking ref is NOT a bearer credential, so only the
  -- booking's owner or staff may create a payment. (auth.uid() must be non-null, else `null = null`
  -- is NULL — not false — and an anonymous caller would slip through on a guest booking.)
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  -- Reuse the existing non-failed payment for this booking, so there is never more than one live
  -- payment row a settlement could bind to.
  select * into v_payment from payments
  where booking_id = v_booking.id and status <> 'failed'
  order by created_at desc
  limit 1;

  if not found then
    -- Idempotent retry on the same key returns the same row.
    select * into v_payment from payments where idempotency_key = p ->> 'idempotencyKey';
  end if;

  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    -- write-ahead intent event
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email
  );
end;
$$;
