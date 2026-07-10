-- Owner booking alerts. A real customer paid and was confirmed (their confirmation email went out),
-- but the OWNER heard nothing — no owner-facing notification existed anywhere. This re-applies the
-- winning enqueue_booking_notification body VERBATIM (from 20260739000000_notifications_feed.sql)
-- with three additions inside the `confirmed` branch:
--   1. an owner EMAIL outbox row  (template owner_new_booking,   idempotency owner_new_booking:<id>)
--   2. an owner WHATSAPP outbox row (same template, channel whatsapp, idempotency owner_new_booking_wa:<id>)
--   3. an in-app `admin_new_booking` feed row for every staff/admin profile (drives the back-office bell)
-- Owner rows use the literal recipient sentinel 'owner' — the drain resolves the real address at send
-- time from OWNER_NOTIFY_EMAIL / OWNER_WHATSAPP_TO, so no personal contact detail is stored in the DB.
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
