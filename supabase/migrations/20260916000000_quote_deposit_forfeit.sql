-- The quote DEPOSIT is NON-REFUNDABLE (Task 7 of the quote-deposit plan,
-- docs/superpowers/plans/2026-08-06-quote-deposit-balance.md — the refund half, deferred out of the
-- invoice-split ship 20260915000000 because the naive version is unsafe; see [[gytm-deposit-invoice-split]]).
--
-- A genuine PARTIAL deposit (0 < deposit_minor < total_minor) is the first `booking` payments row sized
-- to the deposit (20260912000000). The guest agreed it is forfeit on cancellation, so api_mark_refunded
-- must KEEP it — but keeping it breaks two things the naive "just skip the deposit row" fix left broken,
-- and this migration fixes BOTH (an adversarial review proved each is a HIGH bug on its own):
--
--   1. STUCK QUEUE. The kept deposit row stays 'paid', so the booking-level payment_state roll-up stays
--      'paid' and append_payment_event can never move the booking off refund_pending. It would sit in
--      refund_pending forever: the guest is never told, and the admin "Mark refunded" queue item never
--      clears. FIX: after reversing everything EXCEPT the deposit, drive the booking to the honest
--      terminal state HERE ('cancelled' — the trip is off, the deposit forfeited, any balance returned).
--      NOT 'refunded': that would (a) fire enqueue_booking_notification's booking_refunded ("fully
--      refunded") email and (b) claim money went back that did not.
--
--   2. RE-ARMED BALANCE LINK → SECOND CHARGE. On a both-paid booking, refunding the balance row rebounds
--      balance_due_minor 0 → balance (append_payment_event's projection recomputes total − deposit), and
--      the roll-up ranks the still-'paid' deposit above the refunded balance so the booking would stay
--      'confirmed' under the naive fix — which RE-ARMS resolveBalanceForToken (status='confirmed' AND
--      balance_due_minor > 0) and lets the guest pay the balance a SECOND time. FIX: the 'cancelled'
--      status above already fails resolveBalanceForToken's status gate; on top of that, clear the durable
--      balance link's credential (quotes.balance_token_hash) so the link is dead at the token too.
--
-- The guest gets a FORFEIT notice ('deposit_forfeited'), enqueued directly here: the 'cancelled'
-- transition mails no guest (enqueue_booking_notification's cancelled branch is an in-app note for a
-- signed-in owner, which an accountless quote guest has none of), so this is the ONE email they receive.
--
-- A pay-in-full quote (deposit_minor = total_minor) and every ordinary booking (deposit_minor = 0) are
-- NOT partial deposits — v_partial_deposit is false for them and EVERY branch below is byte-for-byte the
-- pre-forfeit behaviour: fully reversed, terminal 'refunded', ordinary booking_refunded email.
--
-- DRIFT RULE (see 20260910000000 / 20260915000000, [[gytm-migration-revert-drift]]): api_mark_refunded
-- carries its WINNING body (20260910000000) VERBATIM apart from the surgical forfeit change, and
-- resolved-function-bodies.test.ts pins the change against pg_proc so a later re-definition can't drop it.

begin;

-- ---------------------------------------------------------------------------
-- api_mark_refunded — the 20260910000000 body (loop every money-holding row, oldest first, reversing
-- each through append_payment_event), re-applied VERBATIM apart from:
--   * v_partial_deposit — true only for a genuine partial deposit (0 < deposit_minor < total_minor);
--   * the idempotency guard forks on it (the forfeit deposit row holds money forever, so "no row holds
--     money" is never true for it — its handled signal is the terminal 'cancelled' instead);
--   * the reversal loop EXCLUDES the deposit ('booking') row of a partial-deposit booking;
--   * the forfeit finalisation block (terminal status + clear balance link + guest forfeit email).
-- ---------------------------------------------------------------------------
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
  v_reversed int := 0;
  v_reversed_minor bigint := 0;
  v_partial_deposit boolean;
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

  if not exists (select 1 from payments where booking_id = v_booking_id) then
    raise exception 'payment_not_found';
  end if;

  -- THE QUOTE DEPOSIT IS NON-REFUNDABLE. A genuine PARTIAL deposit (0 < deposit_minor < total_minor) is
  -- the first `booking` payments row sized to the deposit — money the guest agreed is forfeit. A
  -- pay-in-full quote (deposit_minor = total_minor) and every ordinary booking (deposit_minor = 0) are
  -- NOT partial, so this is false and every branch below stays byte-for-byte the pre-forfeit behaviour.
  v_partial_deposit := v_booking.deposit_minor > 0 and v_booking.deposit_minor < v_booking.total_minor;

  -- Already handled -> no-op (idempotent: a repeat click must not error, re-reverse or re-email). For an
  -- ordinary booking that is "no row still holds money" (every row reversed, status rolled to
  -- 'refunded'). For a PARTIAL-DEPOSIT booking the forfeit deposit row holds money FOREVER by design, so
  -- that test is never true and the function would re-run on every click; its handled signal is instead
  -- the terminal 'cancelled' this function drives it to below.
  if v_partial_deposit then
    if v_booking.status = 'cancelled' then
      return jsonb_build_object('ok', true, 'alreadyRefunded', true);
    end if;
  elsif not exists (
    select 1 from payments
     where booking_id = v_booking_id
       and (status in ('paid', 'partially_refunded') or paid_minor > refunded_minor)
  ) then
    return jsonb_build_object('ok', true, 'alreadyRefunded', true);
  end if;

  -- Only a booking whose money is actually held may be refunded: the cancel path lands it in
  -- refund_pending (payment_state stays paid), or staff refund a confirmed/completed paid booking
  -- directly. Anything else (unpaid, draft, already cancelled with no money) is rejected. The payment
  -- half of the gate is the `not exists` above - a pending sibling row must not veto the refund.
  if v_booking.status not in ('refund_pending', 'confirmed', 'completed') then
    raise exception 'not_refundable'
      using detail = format('booking %s', v_booking.status);
  end if;

  -- Reverse the full outstanding (paid - already-refunded) amount of EVERY row that still holds money,
  -- oldest first, so the booking-level roll-up inside append_payment_event only reaches 'refunded' on
  -- the last one. append_payment_event derives the refunded state from the SUM of refund events.
  --
  -- EXCEPT the non-refundable deposit. A partial-deposit booking's deposit is its single `booking` row
  -- (the balance is a distinct 'balance' purpose, a pickup supplement a distinct 'pickup_addon'), so
  -- `not (v_partial_deposit and purpose = 'booking')` keeps the deposit while still reversing the
  -- balance and any supplement. For a non-partial booking the flag is false and the WHERE is unchanged.
  for v_payment in
    select * from payments
     where booking_id = v_booking_id
       and (status in ('paid', 'partially_refunded') or paid_minor > refunded_minor)
       and not (v_partial_deposit and purpose = 'booking')
     order by created_at
  loop
    v_amount := greatest(v_payment.paid_minor - v_payment.refunded_minor, 0);
    if v_amount > 0 then
      -- Record through the SAME path the webhook uses. The synthesised provider_event_id makes it
      -- idempotent at the ledger: a second call with the same id hits the
      -- (payment_id, provider_event_id, type) conflict and is a no-op, so the booking_refunded enqueue
      -- (which also guards old.status is distinct from 'refunded') never double-fires.
      perform append_payment_event(
        v_payment.id,
        'refunded',
        'manual:refund:' || v_payment.id::text,
        v_amount,
        now(),
        jsonb_build_object('source', 'admin_mark_refunded', 'bookingId', v_booking_id)
      );
      v_reversed := v_reversed + 1;
      v_reversed_minor := v_reversed_minor + v_amount;
    end if;
  end loop;

  -- FORFEIT FINALISATION (partial deposit only). append_payment_event cannot drive this booking terminal
  -- — the kept deposit row keeps the roll-up at 'paid', so status would sit in refund_pending forever.
  -- Drive it to the honest terminal state, kill the durable balance link, and send the forfeit notice.
  if v_partial_deposit then
    -- 'cancelled', NOT 'refunded': the trip is off and the deposit is KEPT, so "refunded" would be a
    -- false claim and would fire booking_refunded. 'cancelled' also fails resolveBalanceForToken's
    -- status='confirmed' gate, so the durable balance link is dead even though refunding the balance
    -- rebounds balance_due_minor 0 -> balance. (Guarded on status so a re-run is a clean no-op; the
    -- alreadyRefunded return above already short-circuits before here, this is belt-and-braces.)
    update bookings set status = 'cancelled', updated_at = now()
     where id = v_booking_id and status <> 'cancelled';

    -- Clear the balance link's CREDENTIAL too, so it is dead at the token, not only via the status gate.
    -- ONLY balance_token_hash — never token_hash, which is the guest's original quote/deposit link and
    -- their route to their own booking record.
    update quotes set balance_token_hash = null, updated_at = now()
     where booking_id = v_booking_id and balance_token_hash is not null;

    -- The guest's FORFEIT notice — the ONE email they get (the 'cancelled' transition mails no guest).
    -- refundedMinor tells the copy whether any balance was returned (both-paid) or not (deposit-only).
    -- Keyed on the booking id + the alreadyRefunded guard above, so a repeat click cannot double-send.
    if v_booking.customer_email is not null then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', v_booking.customer_email, 'deposit_forfeited',
        jsonb_build_object(
          'ref', v_booking.ref, 'customerName', v_booking.customer_name,
          'depositMinor', v_booking.deposit_minor, 'refundedMinor', v_reversed_minor,
          'currency', v_booking.currency
        ),
        v_booking_id, 'deposit_forfeited:' || v_booking_id
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'paymentsReversed', v_reversed);
end;
$$;

revoke execute on function api_mark_refunded(jsonb) from public;
grant execute on function api_mark_refunded(jsonb) to authenticated, service_role;

commit;
