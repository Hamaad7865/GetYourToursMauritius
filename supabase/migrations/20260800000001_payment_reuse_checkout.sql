-- Bug sweep (2026-07-06): close the payment double-charge window.
-- api_create_payment reused the existing payments ROW for a pending booking, but the service then minted
-- a FRESH Peach checkout each call (new nonce) and overwrote provider_checkout_id — so a customer who hit
-- back/reload and paid again before the webhook confirmed could be charged on TWO independently-payable
-- checkouts. This re-applies the winning api_create_payment body VERBATIM with ONE additive change: it
-- returns `existingCheckoutId` (a still-fresh, <25 min checkout already recorded for this payment) so the
-- service reuses that session instead of minting a second one. A completed Peach session can't be
-- re-charged, so reuse prevents the double charge; a stale/abandoned checkout falls through to a fresh one.
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
  if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
     or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'booking_not_payable' using detail = v_booking.status::text;
  end if;
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
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
    'existingCheckoutId', case
       when v_payment.provider_checkout_id is not null
            and v_payment.updated_at > now() - interval '25 minutes'
       then v_payment.provider_checkout_id else null end
  );
end;
$$;
