-- Let a customer REMOVE an "Awaiting payment" line from their cart.
--
-- The gap this closes: a `payment_pending` booking is a real row holding real seats, and nothing the
-- customer could reach would clear it. api_cancel_booking refuses anything that is not
-- `confirmed` + `paid` ('not_cancellable'), so the only exits were the 30-minute hold timer and
-- run_booking_maintenance's grace sweep. The cart rendered the line with a "Complete payment" button
-- and no way out, so a checkout that could not proceed — the widget refusing to open, an upstream
-- payment error, or simply a change of mind — left the customer staring at a dead row and their own
-- seats locked away from them for the rest of the window.
--
-- This is DELIBERATELY NOT a second cancel path. It is the manual trigger for the sweep that already
-- exists, carrying the same money guards, and it can only ever produce the state that sweep would
-- have produced a few minutes later:
--
--   * 'expired', not 'cancelled' — 'expired' is what run_booking_maintenance writes for exactly this
--     row, and enqueue_booking_notification already has a payment_pending -> expired branch. Reusing
--     it means no new notification shape, and the admin queues keep reading the same states.
--   * THE MONEY GUARD IS THE POINT. A booking whose payment settled after the customer opened the
--     cart — the Peach webhook is asynchronous, so `payment_pending` on screen can be `paid` in the
--     database — must never be expirable by a click, or a guest would release the seats they have
--     just been charged for. The `not exists (… paid / paid_minor > 0 / settlement_review_at …)`
--     predicate below is copied from run_booking_maintenance for that reason, and it is checked
--     under a row lock taken FIRST, so a webhook settling concurrently either lands before the lock
--     (and we refuse) or after the flip (and append_payment_event's own oversold/called-off handling
--     routes it to refund_pending, which is the pre-existing late-settlement path — see
--     [[gytm-payment-late-settlement]]).
--   * NO GRACE PERIOD. The sweep waits `graceMinutes` because it acts on the customer's behalf
--     without being asked; this one IS the asking, so a freshly-created booking is releasable at
--     once. That is the only substantive difference from the sweep.
--
-- Ownership is checked IN the function (definer bypasses RLS), matching api_cancel_booking: the
-- booking's own user, or staff. `authenticated` gets the grant because the caller identity is
-- auth.uid() — an anonymous quote booking has a null user_id and matches neither branch, which is
-- correct: those are paid through a link, never held in anybody's cart.

begin;

create or replace function api_release_pending_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(p ->> 'ref', '');
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_settled boolean;
begin
  if v_ref is null then
    raise exception 'invalid_request' using detail = 'release: ref required';
  end if;

  -- FOR UPDATE before anything is read off the row: a Peach webhook settling this same booking has to
  -- serialise against us, not interleave between the money check and the status flip.
  select * into v_booking from bookings where ref = v_ref for update;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Ownership: the booking's own customer, or staff. (A definer function bypasses RLS -- check here.)
  if not (is_staff() or (v_uid is not null and v_booking.user_id = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: already gone (the sweep beat us, or a double-click) -> report the current state
  -- rather than raising, so the cart's optimistic removal is never contradicted by an error toast.
  if v_booking.status in ('expired', 'cancelled', 'refunded', 'refund_pending') then
    return jsonb_build_object(
      'ok', true, 'ref', v_booking.ref, 'status', v_booking.status, 'alreadyReleased', true
    );
  end if;

  -- Only an unpaid, not-yet-confirmed booking. A confirmed one belongs to api_cancel_booking (which
  -- owes the guest a refund and the owner an alert); this path owes nobody anything.
  if not (v_booking.status in ('draft', 'held', 'payment_pending')
          and v_booking.payment_state in ('pending', 'failed')) then
    raise exception 'not_releasable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- The money guard, verbatim from run_booking_maintenance. `payment_state` alone is not enough: it
  -- is a projection that a lost webhook can leave stale, so the payments rows are the authority.
  select exists (
    select 1 from payments pay
     where pay.booking_id = v_booking.id
       and (pay.status in ('paid', 'partially_refunded', 'refunded')
            or pay.paid_minor > 0
            or pay.settlement_review_at is not null)
  ) into v_settled;
  if v_settled then
    raise exception 'payment_settled'
      using detail = 'a payment on this booking has money against it; it cannot be released';
  end if;

  update bookings
     set status = 'expired', updated_at = now()
   where id = v_booking.id;

  -- Free the seats immediately -- the whole point of the button is that the customer gets their
  -- capacity back now rather than in twenty-eight minutes.
  update booking_holds
     set status = 'released'
   where booking_id = v_booking.id and status = 'active';

  -- Distinguishable from the sweep's 'auto_expire_booking' in the audit trail: one is us acting on a
  -- silent customer, the other is the customer acting for themselves.
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (
    v_uid,
    case when is_staff() then 'staff' else 'customer' end,
    'release_pending_booking', 'booking', v_booking.id,
    'removed from cart before payment'
  );

  return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', 'expired');
end;
$$;

-- Caller identity IS auth.uid() inside the function, so the grant goes to `authenticated` (never
-- anon) and the in-function ownership check does the authorization -- same shape as
-- api_cancel_booking. Both member roles are named in the revoke: Supabase's default grants survive a
-- bare `revoke from public` ([[gytm-definer-grant-leak]]).
revoke execute on function api_release_pending_booking(jsonb) from public, anon;
grant execute on function api_release_pending_booking(jsonb) to authenticated, service_role;

commit;
