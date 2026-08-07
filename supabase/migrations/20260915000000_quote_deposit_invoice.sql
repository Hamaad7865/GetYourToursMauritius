-- Quote deposit — the RECEIPT-vs-INVOICE split (Task 6 + 7 of the deposit plan,
-- docs/superpowers/plans/2026-08-06-quote-deposit-balance.md). The deposit money-path (sizing, the
-- balance row, balance_due_minor) shipped in 20260912000000; this migration is the DOCUMENT half:
--
--   1. A deposit-confirmed booking (balance_due_minor > 0 after the deposit settles) gets a DEPOSIT
--      RECEIPT, not the full VAT invoice. enqueue_booking_notification's confirmed branch now forks the
--      guest email on new.balance_due_minor: > 0 → 'deposit_receipt', else the unchanged
--      'booking_confirmation'. A pay-in-full quote and every ordinary booking reach confirm with
--      balance_due_minor = 0 and are byte-identical to before.
--
--   2. The full VAT invoice fires when the BALANCE clears — a booking-status NO-OP (the booking is
--      already 'confirmed'), so enqueue_booking_notification never sees it. A new payments-status trigger
--      notify_balance_paid (mirroring payments_apply_pickup_addon) enqueues the full 'booking_confirmation'
--      invoice + an EMAIL-ONLY owner alert when a 'balance' row transitions to 'paid'.
--
--   3. api_booking_receipt exposes balance_due_minor and sums the SETTLED amount across the deposit
--      ('booking') and balance ('balance') rows, so the deposit receipt shows the deposit charged and the
--      eventual full invoice shows both charges. buildInvoice derives amountPaidEur = totalGross −
--      balanceDue, which fixes the fxRate poisoning (charged / total was ~10× wrong on a 10% deposit).
--
-- NOT in this migration: making the deposit non-refundable. That is a refund-LIFECYCLE change (it must
-- also drive the booking to a terminal status, invalidate the durable balance link, and fire the guest
-- refund email) — excluding the deposit row from api_mark_refunded alone leaves a partial-deposit booking
-- stuck in refund_pending and re-arms its balance link for a second charge. It is deferred to a dedicated
-- follow-up; refunds behave exactly as before here.
--
-- DRIFT RULE (see 20260817000000 / 20260910000000): the two re-declared functions carry their WINNING
-- bodies VERBATIM apart from the surgical change, and resolved-function-bodies.test.ts pins each change
-- against pg_proc so a later re-definition cannot silently drop it.

begin;

-- ---------------------------------------------------------------------------------------------------
-- 1) enqueue_booking_notification — WINNING body 20260817000000_whatsapp_owner_alerts.sql, re-applied
--    verbatim. The ONLY change is the confirmed branch's guest email: forked on new.balance_due_minor.
--    The owner alerts read the live balance off api_booking_receipt at drain time, so their payload is
--    unchanged. balance_due_minor is already projected down to (total − deposit) by append_payment_event
--    before the status→confirmed UPDATE that fires this trigger, so `new.balance_due_minor` is correct here.
-- ---------------------------------------------------------------------------------------------------
create or replace function enqueue_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    -- THE DEPOSIT SPLIT. A part-paid booking (a deposit settled, a balance still owed) gets a deposit
    -- RECEIPT; the full 'booking_confirmation' VAT invoice is fired later by notify_balance_paid when the
    -- balance clears. Everything with balance_due_minor = 0 at confirm — a pay-in-full quote, every
    -- ordinary catalogue booking — takes the else and is bit-for-bit the pre-deposit behaviour.
    if new.balance_due_minor > 0 then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', new.customer_email, 'deposit_receipt',
        jsonb_build_object(
          'ref', new.ref, 'customerName', new.customer_name,
          'totalMinor', new.total_minor, 'depositMinor', new.deposit_minor,
          'balanceDueMinor', new.balance_due_minor, 'currency', new.currency
        ),
        new.id, 'deposit_receipt:' || new.id
      )
      on conflict (idempotency_key) do nothing;
    else
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', new.customer_email, 'booking_confirmation',
        jsonb_build_object(
          'ref', new.ref, 'customerName', new.customer_name,
          'totalMinor', new.total_minor, 'currency', new.currency
        ),
        new.id, 'booking_confirmation:' || new.id
      )
      on conflict (idempotency_key) do nothing;
    end if;
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', 'owner', 'owner_new_booking',
      jsonb_build_object(
        'ref', new.ref, 'customerName', new.customer_name,
        'totalMinor', new.total_minor, 'currency', new.currency
      ),
      new.id, 'owner_new_booking:' || new.id
    )
    on conflict (idempotency_key) do nothing;
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'telegram', 'owner', 'owner_new_booking',
      jsonb_build_object(
        'ref', new.ref, 'customerName', new.customer_name,
        'totalMinor', new.total_minor, 'currency', new.currency
      ),
      new.id, 'owner_new_booking_tg:' || new.id
    )
    on conflict (idempotency_key) do nothing;
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'whatsapp', 'owner', 'owner_new_booking',
      jsonb_build_object(
        'ref', new.ref, 'customerName', new.customer_name,
        'totalMinor', new.total_minor, 'currency', new.currency
      ),
      new.id, 'owner_new_booking_wa:' || new.id
    )
    on conflict (idempotency_key) do nothing;
    insert into notifications (user_id, type, title, body, data)
    select p.id, 'admin_new_booking', 'New booking',
           coalesce(nullif(new.customer_name, ''), 'A guest') || ' booked ' || new.ref
             || ' — €' || to_char(new.total_minor / 100.0, 'FM999990.00'),
           jsonb_build_object('ref', new.ref, 'bookingId', new.id)
    from profiles p
    where p.role in ('staff', 'admin')
      and not exists (
        select 1 from notifications n
        where n.user_id = p.id and n.type = 'admin_new_booking'
          and n.data ->> 'bookingId' = new.id::text
      );
    if new.user_id is not null then
      insert into notifications (user_id, type, title, body, data)
      select new.user_id, 'booking_confirmed', 'Booking confirmed',
             'Your booking ' || new.ref || ' is confirmed.',
             jsonb_build_object('ref', new.ref, 'bookingId', new.id)
      where not exists (
        select 1 from notifications n
        where n.user_id = new.user_id and n.type = 'booking_confirmed'
          and n.data ->> 'bookingId' = new.id::text
      );
    end if;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if new.user_id is not null then
      insert into notifications (user_id, type, title, body, data)
      select new.user_id, 'booking_cancelled', 'Booking cancelled',
             'Your booking ' || new.ref || ' has been cancelled.',
             jsonb_build_object('ref', new.ref, 'bookingId', new.id)
      where not exists (
        select 1 from notifications n
        where n.user_id = new.user_id and n.type = 'booking_cancelled'
          and n.data ->> 'bookingId' = new.id::text
      );
    end if;
  elsif new.status = 'refunded' and old.status is distinct from 'refunded' then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', new.customer_email, 'booking_refunded',
      jsonb_build_object('ref', new.ref, 'customerName', new.customer_name),
      new.id, 'booking_refunded:' || new.id
    )
    on conflict (idempotency_key) do nothing;
    if new.user_id is not null then
      insert into notifications (user_id, type, title, body, data)
      select new.user_id, 'booking_refunded', 'Refund issued',
             'Your booking ' || new.ref || ' has been refunded.',
             jsonb_build_object('ref', new.ref, 'bookingId', new.id)
      where not exists (
        select 1 from notifications n
        where n.user_id = new.user_id and n.type = 'booking_refunded'
          and n.data ->> 'bookingId' = new.id::text
      );
    end if;
  elsif new.status = 'refund_pending' and old.status is distinct from 'refund_pending' then
    -- Money was captured but the booking can't stand (oversell race / paid-after-expiry): tell the
    -- customer their refund is coming and put the owner + staff bell on it -- this was the one
    -- money-critical transition that previously notified nobody. The customer-cancel flow
    -- (api_cancel_booking) queues its own tailored alert first, so skip when that row exists.
    if not exists (
      select 1 from notification_outbox
      where booking_id = new.id and template = 'booking_cancellation'
    ) then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', new.customer_email, 'booking_refund_pending',
        jsonb_build_object(
          'ref', new.ref, 'customerName', new.customer_name,
          'totalMinor', new.total_minor, 'currency', new.currency
        ),
        new.id, 'booking_refund_pending:' || new.id
      )
      on conflict (idempotency_key) do nothing;
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', 'owner', 'owner_refund_pending',
        jsonb_build_object(
          'ref', new.ref, 'customerName', new.customer_name,
          'totalMinor', new.total_minor, 'currency', new.currency
        ),
        new.id, 'owner_refund_pending:' || new.id
      )
      on conflict (idempotency_key) do nothing;
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'telegram', 'owner', 'owner_refund_pending',
        jsonb_build_object(
          'ref', new.ref, 'customerName', new.customer_name,
          'totalMinor', new.total_minor, 'currency', new.currency
        ),
        new.id, 'owner_refund_pending_tg:' || new.id
      )
      on conflict (idempotency_key) do nothing;
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'whatsapp', 'owner', 'owner_refund_pending',
        jsonb_build_object(
          'ref', new.ref, 'customerName', new.customer_name,
          'totalMinor', new.total_minor, 'currency', new.currency
        ),
        new.id, 'owner_refund_pending_wa:' || new.id
      )
      on conflict (idempotency_key) do nothing;
      insert into notifications (user_id, type, title, body, data)
      select p.id, 'admin_refund_pending', 'Refund needed',
             coalesce(nullif(new.customer_name, ''), 'A guest') || ' -- booking ' || new.ref
               || ' needs a refund in Peach.',
             jsonb_build_object('ref', new.ref, 'bookingId', new.id)
      from profiles p
      where p.role in ('staff', 'admin')
        and not exists (
          select 1 from notifications n
          where n.user_id = p.id and n.type = 'admin_refund_pending'
            and n.data ->> 'bookingId' = new.id::text
        );
    end if;
  elsif new.status = 'expired' and old.status = 'payment_pending' then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', new.customer_email, 'booking_expired',
      jsonb_build_object('ref', new.ref, 'customerName', new.customer_name),
      new.id, 'booking_expired:' || new.id
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function enqueue_booking_notification() from public, anon, authenticated;
grant execute on function enqueue_booking_notification() to service_role;


-- ---------------------------------------------------------------------------------------------------
-- 2) notify_balance_paid — the full VAT invoice + owner alert when the BALANCE clears.
--
-- The balance settling is a booking-status NO-OP (the booking has been 'confirmed' since the deposit),
-- so enqueue_booking_notification never fires for it — the full invoice MUST come from a payments-status
-- trigger. Mirrors notify_pickup_set (a plain worker, EMAIL ONLY: resolveOwnerRecipient throws for an
-- unset Telegram chat id / WhatsApp number, both unset in production) and the payments_apply_pickup_addon
-- trigger (fires once on the paid transition via `old.status is distinct from 'paid'`). It runs from
-- INSIDE append_payment_event's `update payments set status = 'paid'`, same as the add-on's apply trigger.
--
-- The guest invoice reuses 'booking_confirmation' keyed on the BOOKING id, so exactly one full invoice is
-- ever sent (a deposit booking's confirm branch enqueued 'deposit_receipt', never this key, so there is
-- no collision — and a re-paid balance dedupes to the same one invoice).
-- ---------------------------------------------------------------------------------------------------
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
begin
  select * into v_payment from payments where id = p_payment_id;
  if not found then
    return;
  end if;
  select * into v_booking from bookings where id = v_payment.booking_id;
  if not found then
    return;
  end if;

  -- Only a LIVE booking gets the settled-in-full invoice. This trigger fires from INSIDE
  -- append_payment_event's `update payments set status='paid'` — BEFORE its status routing — so a balance
  -- completing on a booking that has left 'confirmed' (self-cancelled to refund_pending, then a still-live
  -- Peach balance session lands) must NOT mail a paid-in-full tax document for money about to be refunded.
  -- append_payment_event's own routing then sends that capture to refund_pending. Mirrors its guard.
  if v_booking.status not in ('confirmed', 'completed') then
    return;
  end if;

  -- Guest: the full VAT invoice, now that the order is settled. enrichBookingConfirmation loads the
  -- receipt fresh (balance_due_minor = 0 by now) and renders it PAID for the full total. Keyed on the
  -- booking id so it can never double with a ret/re-paid balance.
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

create or replace function trg_notify_balance_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_balance_paid(new.id);
  return new;
end;
$$;

revoke execute on function trg_notify_balance_paid() from public, anon, authenticated;
grant execute on function trg_notify_balance_paid() to service_role;

drop trigger if exists payments_notify_balance_paid on payments;
create trigger payments_notify_balance_paid
after update of status on payments
for each row
when (new.purpose = 'balance' and new.status = 'paid' and old.status is distinct from 'paid')
execute function trg_notify_balance_paid();


-- ---------------------------------------------------------------------------------------------------
-- 3) api_booking_receipt — WINNING body 20260910000000_late_pickup_addon.sql, re-applied verbatim
--    (the booking_custom_items union AND the applied-pickup fold are contracts — kept intact) apart from:
--      * the settled-payment select is a SUM over purpose in ('booking','balance') instead of the single
--        newest 'booking' row, so a deposit receipt shows the deposit charged and the full invoice (after
--        the balance) shows BOTH charges. An ordinary booking has one 'booking' row, so it is unchanged.
--      * balance_due_minor is exposed, so buildInvoice can render "Amount paid / Balance due" and derive
--        amountPaidEur = totalGross − balanceDue (the fxRate fix).
-- ---------------------------------------------------------------------------------------------------
create or replace function api_booking_receipt(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_booking_id uuid := nullif(p ->> 'bookingId', '')::uuid;
  v_base jsonb;
  v_title text;
  v_when timestamptz;
  v_payment jsonb;
  v_phone text;
  v_locale text;
  v_bal bigint;
  v_addon_charged bigint := 0;
  v_custom jsonb;
begin
  if v_booking_id is null then
    raise exception 'invalid_request' using detail = 'booking_receipt: bookingId required';
  end if;

  v_base := booking_json(v_booking_id);
  if v_base is null then
    return null;
  end if;

  -- Primary activity title + the earliest trip date, joined off the booking's items.
  select a.title, o.starts_at
    into v_title, v_when
    from booking_items bi
    join session_occurrences o on o.id = bi.session_occurrence_id
    join activity_options ao on ao.id = bi.activity_option_id
    join activities a on a.id = ao.activity_id
   where bi.booking_id = v_booking_id
   order by o.starts_at asc, bi.created_at asc
   limit 1;

  -- SETTLED SO FAR, summed across the deposit ('booking') and the balance ('balance') rows -- NOT the
  -- single newest row the pre-deposit body picked. A deposit receipt shows the deposit charged; once the
  -- balance clears the full invoice shows BOTH charges. An ordinary booking has only the one 'booking'
  -- row, so this is byte-identical to the old `order by created_at desc limit 1`. Only rows that actually
  -- settled (paid_minor > 0) contribute a charge, so a minted-but-uncharged balance row adds nothing;
  -- paidAt/providerRef are the LATEST settled event across the counted rows.
  select case
           when count(*) filter (where pay.paid_minor > 0) = 0 then null
           else jsonb_build_object(
             'chargedAmountMinor',
               coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor))
                        filter (where pay.paid_minor > 0), 0),
             'chargedCurrency',
               coalesce(max(coalesce(pay.charged_currency, pay.currency))
                        filter (where pay.paid_minor > 0), max(pay.currency)),
             'paidAt', max(paid.occurred_at) filter (where pay.paid_minor > 0),
             'providerRef', (array_agg(paid.provider_event_id order by paid.occurred_at desc nulls last)
                             filter (where pay.paid_minor > 0 and paid.provider_event_id is not null))[1]
           )
         end
    into v_payment
    from payments pay
    left join lateral (
      select pe.occurred_at, pe.provider_event_id
        from payment_events pe
       where pe.payment_id = pay.id and pe.type in ('paid', 'captured')
       order by pe.occurred_at asc
       limit 1
    ) paid on true
   where pay.booking_id = v_booking_id
     and pay.purpose in ('booking', 'balance');

  -- A settled late-pickup supplement is a SECOND charge on the same card, and its fare is already
  -- inside the booking's total_minor - so the receipt's charged figure has to include it, or the
  -- invoice states that a EUR 150 order settled with the EUR 120 charge and buildPaymentBlock's
  -- derived fx rate (charged / total) becomes fiction. Summed only across rows in the SAME charge
  -- currency: a legacy EUR booking row and an MUR add-on cannot be added together, and omitting the
  -- add-on understates by less than a cross-currency sum would misstate.
  if v_payment is not null then
    select coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor)), 0)
      into v_addon_charged
      from payments pay
     where pay.booking_id = v_booking_id
       and pay.purpose = 'pickup_addon'
       and pay.paid_minor > 0
       -- APPLIED, not merely settled. apply_pickup_request adds the fare to total_minor only for a
       -- live booking on a running departure; a capture it refused leaves the total untouched, so
       -- folding its charge in here would print a charged figure the invoice's own lines do not add
       -- up to — and buildPaymentBlock derives its fx rate from charged/total.
       and exists (
         select 1 from booking_pickup_requests r
          where r.payment_id = pay.id and r.applied_at is not null
       )
       and coalesce(pay.charged_currency, pay.currency)
             is not distinct from (v_payment ->> 'chargedCurrency');
    if v_addon_charged > 0 then
      v_payment := v_payment || jsonb_build_object(
        'chargedAmountMinor', (v_payment ->> 'chargedAmountMinor')::bigint + v_addon_charged
      );
    end if;
  end if;

  -- The guest's stored booking locale (Task 15) + the amount still owed (Task 6/7: the deposit split).
  -- The notification drain runs off-request (cron), so this is the only correct source for language.
  select b.customer_phone, b.locale::text, b.balance_due_minor
    into v_phone, v_locale, v_bal
    from bookings b where b.id = v_booking_id;

  -- FROM 20260909000000 SECTION 7b - the priced lines that have no session_occurrence: a converted
  -- quote's lines today, rentals in Part 2. Empty (and therefore free) for every booking that has
  -- none, which is every ordinary catalogue booking.
  --   * `priceLabel` <- `description`. A custom line has no price label (it is not a catalogue price
  --     band) and `booking_custom_items.description` is NOT NULL precisely so the line stays readable
  --     on its own; receiptSchema types priceLabel as a required string, so this is the field it maps
  --     to. buildInvoice then renders "<activityTitle> - <priceLabel>", or just the label when the
  --     booking has no activity behind it, which a quote booking does not.
  --   * `quantity` verbatim, and `pax` explicitly null - a custom line is priced per LINE, not per
  --     person, and buildInvoice reads `pax ?? quantity`, so null is what makes it use the quantity.
  --   * `subtotalEur` <- `subtotal_minor / 100.0`, the same minor->major conversion booking_json does
  --     for booking_items. `unitAmountEur` rides along so the two item shapes stay identical.
  select coalesce(jsonb_agg(jsonb_build_object(
           'priceLabel', ci.description,
           'quantity', ci.quantity,
           'pax', null::int,
           'unitAmountEur', ci.unit_amount_minor::float / 100,
           'subtotalEur', ci.subtotal_minor::float / 100
         ) order by ci.position), '[]'::jsonb)
    into v_custom
    from booking_custom_items ci
   where ci.booking_id = v_booking_id;

  -- Ordered by `position`, and APPENDED AFTER booking_json's own items - never merged into them.
  -- buildInvoice's own header notes that voucher-pdf.ts reads `lines[0].quantity` positionally for
  -- its pax count, so the catalogue lines must stay first for the day a booking carries both kinds.
  return v_base
    || jsonb_build_object('items', coalesce(v_base -> 'items', '[]'::jsonb) || v_custom)
    || jsonb_build_object('activityTitle', v_title, 'when', v_when)
    || jsonb_build_object('payment', coalesce(v_payment, 'null'::jsonb))
    || jsonb_build_object('customerPhone', v_phone)
    || jsonb_build_object('balanceDueMinor', coalesce(v_bal, 0))
    || jsonb_build_object('locale', v_locale);
end;
$$;

revoke execute on function api_booking_receipt(jsonb) from public, anon, authenticated;
grant execute on function api_booking_receipt(jsonb) to service_role;

commit;
