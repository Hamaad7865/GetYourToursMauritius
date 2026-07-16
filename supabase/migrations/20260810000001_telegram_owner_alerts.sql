-- Telegram owner alerts. Meta's WhatsApp Cloud API onboarding proved too painful, so the OWNER chat
-- alert on a new/paid-but-unstandable booking now goes over Telegram instead of WhatsApp (email owner
-- alert + the admin bell are unchanged). Adds the 'telegram' notification_channel and re-applies the
-- winning enqueue_booking_notification VERBATIM (from 20260804000000 / catch-up), swapping the two
-- owner WHATSAPP rows for TELEGRAM (new idempotency suffix _tg so it is a distinct row). The recipient
-- stays the 'owner' sentinel — the drain resolves TELEGRAM_OWNER_CHAT_ID at send time, so no chat id
-- is stored in the DB. ADD VALUE + this function creation are safe in one transaction (the value is
-- only referenced in a function body here, never used in DML), verified under PGlite.
alter type notification_channel add value if not exists 'telegram';

create or replace function enqueue_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
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
