-- Notification outbox: enqueue + drain plumbing.
--
-- Until now the notification_outbox table was dead infrastructure — nothing wrote to it and
-- nothing drained it, so a paid customer received no confirmation. This wires both ends:
--   * an AFTER-UPDATE trigger on bookings enqueues a row when a booking becomes confirmed (or
--     refunded), idempotently, from ANY path (webhook, admin, future reconciliation);
--   * claim/mark RPCs let an out-of-band worker (the /internal/notifications/drain route, called
--     by a scheduler) pull a batch, send via the NotificationProvider, and record the result.
-- The enqueue is the must-have; actual sending swaps from the stub to Resend once keys exist.

-- ---------------------------------------------------------------------------
-- Enqueue on the booking lifecycle. Idempotency key = template:booking_id, so a status that is
-- re-applied (or append_payment_event running twice) never double-sends.
-- ---------------------------------------------------------------------------
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
  elsif new.status = 'refunded' and old.status is distinct from 'refunded' then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', new.customer_email, 'booking_refunded',
      jsonb_build_object('ref', new.ref, 'customerName', new.customer_name),
      new.id, 'booking_refunded:' || new.id
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_enqueue_notification on bookings;
create trigger bookings_enqueue_notification
  after update of status on bookings
  for each row execute function enqueue_booking_notification();

-- ---------------------------------------------------------------------------
-- Claim a batch of pending notifications for sending. Atomically increments attempts and skips
-- rows another worker is already holding (FOR UPDATE SKIP LOCKED), so concurrent drains are safe.
-- Returns a jsonb array the worker sends one by one. service_role only.
-- ---------------------------------------------------------------------------
create or replace function claim_notifications(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 100);
  v_rows jsonb;
begin
  with batch as (
    select id from notification_outbox
    where status = 'pending' and attempts < 5
    order by created_at
    limit v_limit
    for update skip locked
  ), upd as (
    update notification_outbox o
       set attempts = attempts + 1
      from batch
     where o.id = batch.id
    returning o.id, o.channel, o.recipient, o.template, o.payload
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'channel', channel, 'recipient', recipient, 'template', template, 'payload', payload
  )), '[]'::jsonb)
  into v_rows
  from upd;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Record the outcome of a send. result='sent' marks it done; anything else leaves it pending for
-- retry until attempts run out, then 'failed'. service_role only.
-- ---------------------------------------------------------------------------
create or replace function mark_notification(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
begin
  if p ->> 'result' = 'sent' then
    update notification_outbox set status = 'sent', sent_at = now(), last_error = null where id = v_id;
  else
    update notification_outbox
      set status = case when attempts >= 5 then 'failed' else 'pending' end,
          last_error = left(coalesce(p ->> 'error', 'send failed'), 500)
      where id = v_id;
  end if;
end;
$$;

revoke execute on function claim_notifications(jsonb) from public;
revoke execute on function mark_notification(jsonb) from public;
grant execute on function claim_notifications(jsonb) to service_role;
grant execute on function mark_notification(jsonb) to service_role;
