-- Installment receipts + the paid-in-full-invoice misfire fix.
--
-- The receipt/invoice flow was built for DEPOSIT + one BALANCE payment: the single balance payment clears
-- the order, so notify_balance_paid (fired when a purpose='balance' row settles) enqueued the full VAT
-- invoice unconditionally, keyed once per booking. Per-date installments break that: a booking now has
-- MANY balance payments. The old body therefore:
--   * fired the full paid-in-full invoice on the FIRST installment (balance still owed), and
--   * deduped the real final one — so a customer who finished paying in installments never got a correct
--     paid-in-full invoice, and never got a receipt for the intermediate installments at all.
--
-- Fix: decide off the REMAINING balance. But this trigger fires from inside append_payment_event's
-- `update payments set status='paid'` — BEFORE that function recomputes bookings.balance_due_minor — so
-- v_booking.balance_due_minor is STALE (pre-this-payment). The just-settled payment's paid_minor IS
-- already set, so we recompute the balance FRESH here with booking_balance_due(), the SAME projection
-- append_payment_event maintains (a parity test pins the two together). Then:
--   * remaining > 0  -> an INTERMEDIATE installment: the customer gets a running receipt (this payment +
--     what is left), rendered by the same path as the deposit receipt with a balance SNAPSHOT and an
--     `installment` flag so the wording is "payment received", not "deposit". Keyed per PAYMENT so every
--     installment gets its own.
--   * remaining = 0  -> the order is settled: the full paid-in-full VAT invoice + the owner "balance paid"
--     alert, keyed per BOOKING -> exactly once, on the LAST payment.
--
-- The classic deposit + single-balance booking is unchanged: its one balance payment drives remaining to
-- 0, so it takes the invoice branch exactly as before.

-- ── booking_balance_due — the balance projection, callable ─────────────────────────────────────────
-- Byte-for-byte the expression append_payment_event writes into bookings.balance_due_minor (deposit +
-- balance count in full; an APPLIED late-pickup add-on nets its grown total back out; paid_minor −
-- refunded_minor so a later refund stops a row counting; greatest(0, …) so nothing drives it negative).
-- STABLE + service-role only. tests/integration/installment-receipts pins it equal to the column the
-- reducer maintains, so the two can never drift.
create or replace function booking_balance_due(p_booking_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
           0,
           b.total_minor - coalesce((
             select sum(pay.paid_minor - pay.refunded_minor)
               from payments pay
              where pay.booking_id = b.id
                and (
                  pay.purpose in ('booking', 'balance')
                  or exists (
                    select 1
                      from booking_pickup_requests r
                     where r.payment_id = pay.id
                       and r.applied_at is not null
                       and r.fee_minor > 0
                  )
                )
           ), 0)
         )
    from bookings b
   where b.id = p_booking_id;
$$;

revoke execute on function booking_balance_due(uuid) from public, anon, authenticated;
grant execute on function booking_balance_due(uuid) to service_role;

create or replace function notify_balance_paid(p_payment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_booking bookings;
  v_remaining bigint;
  v_charged bigint;
begin
  select * into v_payment from payments where id = p_payment_id;
  if not found then
    return;
  end if;
  select * into v_booking from bookings where id = v_payment.booking_id;
  if not found then
    return;
  end if;

  -- Only a LIVE booking gets a receipt/invoice. This trigger fires from INSIDE append_payment_event's
  -- `update payments set status='paid'` — BEFORE its status routing — so a balance completing on a
  -- booking that has left 'confirmed' (self-cancelled to refund_pending, then a still-live Peach balance
  -- session lands) must NOT mail a document for money about to be refunded. Mirrors its guard.
  if v_booking.status not in ('confirmed', 'completed') then
    return;
  end if;

  -- FRESH remaining balance — v_booking.balance_due_minor is STALE at this point (see header). The
  -- just-settled payment is already counted (its paid_minor is set), so this is the TRUE amount left.
  v_remaining := booking_balance_due(v_booking.id);

  if v_remaining > 0 then
    -- INTERMEDIATE installment: a running receipt for THIS payment. enrichBookingConfirmation renders a
    -- 'deposit_receipt' against the balance SNAPSHOT carried on the payload (never the live balance, which
    -- a later installment would have lowered), so amountPaid = total − snapshot = paid through this
    -- installment. `installment` flips the wording from "deposit" to "payment". Keyed per PAYMENT so every
    -- installment gets one; a DIFFERENT key namespace from the confirmation-time deposit_receipt:<booking>.
    -- Snapshot the cumulative CHARGE at this same instant, so a receipt that drains AFTER a later
    -- installment settled still shows a "charged" figure (and the MUR fx rate derived from it) consistent
    -- with its Amount paid / Balance due — api_booking_receipt otherwise sums charged LIVE at drain, which
    -- would then contradict the snapshotted balance. Same charge currency only (a legacy EUR row and an
    -- MUR row never add), mirroring api_booking_receipt.
    select coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor)), 0)
      into v_charged
      from payments pay
     where pay.booking_id = v_booking.id
       and pay.purpose in ('booking', 'balance')
       and pay.paid_minor > 0
       and coalesce(pay.charged_currency, pay.currency)
             is not distinct from coalesce(v_payment.charged_currency, v_payment.currency);

    if v_booking.customer_email is not null then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', v_booking.customer_email, 'deposit_receipt',
        jsonb_build_object(
          'ref', v_booking.ref, 'customerName', v_booking.customer_name,
          'totalMinor', v_booking.total_minor, 'currency', v_booking.currency,
          'balanceDueMinor', v_remaining, 'chargedAmountMinor', v_charged, 'installment', true
        ),
        v_booking.id, 'installment_receipt:' || v_payment.id
      )
      on conflict (idempotency_key) do nothing;
    end if;
    return;
  end if;

  -- SETTLED IN FULL: the full VAT invoice, keyed per booking so it fires exactly once — on the LAST
  -- payment now, not the first. enrichBookingConfirmation loads it fresh (balance_due_minor = 0 by now)
  -- and renders PAID for the full total.
  if v_booking.customer_email is not null then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_booking.customer_email, 'booking_confirmation',
      jsonb_build_object(
        'ref', v_booking.ref, 'customerName', v_booking.customer_name,
        'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
      ),
      v_booking.id, 'booking_confirmation:' || v_booking.id
    )
    on conflict (idempotency_key) do nothing;
  end if;

  -- Owner: EMAIL ONLY on purpose (see header). One glance: the balance on this booking has now been paid.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'owner_balance_paid',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'owner_balance_paid:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke execute on function notify_balance_paid(uuid) from public, anon, authenticated;
grant execute on function notify_balance_paid(uuid) to service_role;
