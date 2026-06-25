-- Per-user notification FEED (the in-app "bell" list), distinct from the existing notification_outbox
-- (email/WhatsApp delivery queue). Backs GET /api/v1/notifications + the two read endpoints.
--
-- The event SOURCE already exists: the AFTER-UPDATE trigger on bookings.status (enqueue_booking_
-- notification) fires on the exact lifecycle transitions a feed cares about. This migration (1) adds the
-- owner-scoped feed table, and (2) extends that SAME trigger to also write a per-user feed row for
-- confirmed / cancelled / refunded — guarded by `new.user_id is not null` (guest bookings have no owner)
-- and an idempotent NOT EXISTS (a re-applied status never double-posts). The email outbox inserts are
-- preserved verbatim, so existing behaviour is unchanged.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);

-- New table → explicit grants (the blanket grant ran before it existed). RLS gates every row to its owner.
grant select, update on notifications to authenticated;
alter table notifications enable row level security;
create policy notifications_select on notifications for select using (user_id = auth.uid());
create policy notifications_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_staff on notifications for all using (is_staff()) with check (is_staff());

-- Extend the existing lifecycle hook: keep every email-outbox insert, ADD an owner-scoped feed row on
-- confirmed / cancelled / refunded. Feed inserts are idempotent (NOT EXISTS on user+type+bookingId).
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

-- GET /notifications — owner-scoped, newest-first, paginated, optional unreadOnly. SECURITY DEFINER seam.
create or replace function api_my_notifications(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_unread_only boolean := coalesce((p ->> 'unreadOnly')::boolean, false);
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_page_size int := least(greatest(coalesce((p ->> 'pageSize')::int, 20), 1), 100);
  v_total int;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  with mine as (
    select * from notifications
    where user_id = v_uid and (not v_unread_only or read_at is null)
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'type', n.type, 'title', n.title, 'body', n.body,
        'data', n.data, 'createdAt', n.created_at, 'readAt', n.read_at
      ) order by n.created_at desc)
      from (
        select * from mine order by created_at desc limit v_page_size offset (v_page - 1) * v_page_size
      ) n
    ), '[]'::jsonb),
    (select count(*)::int from mine)
  into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

-- POST /notifications/{id}/read — owner-scoped mark-read. 403 if not the owner, 404 if missing.
-- Idempotent: a second read returns the same readAt (coalesce keeps the first timestamp).
create or replace function api_mark_notification_read(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_owner uuid;
  v_read_at timestamptz;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'invalid_request: id is required';
  end if;
  select user_id into v_owner from notifications where id = v_id;
  if v_owner is null then
    raise exception 'notification_not_found';
  end if;
  if v_owner <> v_uid then
    raise exception 'forbidden';
  end if;
  update notifications set read_at = coalesce(read_at, now())
   where id = v_id
   returning read_at into v_read_at;
  return jsonb_build_object('id', v_id, 'readAt', v_read_at);
end;
$$;

-- POST /notifications/read-all — mark all of the caller's unread as read; returns how many changed.
create or replace function api_mark_all_notifications_read(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  with upd as (
    update notifications set read_at = now()
     where user_id = v_uid and read_at is null
    returning 1
  )
  select count(*)::int from upd into v_updated;
  return jsonb_build_object('updated', v_updated);
end;
$$;

revoke execute on function api_my_notifications(jsonb) from public;
revoke execute on function api_mark_notification_read(jsonb) from public;
revoke execute on function api_mark_all_notifications_read(jsonb) from public;
grant execute on function api_my_notifications(jsonb) to authenticated;
grant execute on function api_mark_notification_read(jsonb) to authenticated;
grant execute on function api_mark_all_notifications_read(jsonb) to authenticated;
