-- Pending bookings in the cart + safe auto-cancel on hold expiry.
--
-- Three changes:
--   (1) api_my_pending_bookings — owner-scoped list of the caller's payment_pending bookings joined
--       to their live hold's expires_at. booking_holds is staff-read-only under RLS, so this SECURITY
--       DEFINER function is the RLS-safe seam that lets the cart show the countdown without a new holds
--       policy. Returns title/date/total so the cart can render a full row.
--   (2) run_booking_maintenance — UNCHANGED expire guard + hold-release; now also writes one audit_logs
--       row per auto-expired booking (system actor), so an automated cancellation is traceable.
--   (3) enqueue_booking_notification — adds a `booking_expired` branch (payment_pending -> expired) so
--       the customer is emailed when their reservation lapses. Path-agnostic (fires from the cron sweep
--       or any other expiry path), idempotent on booking_expired:<id>. confirmed/refunded branches kept.

-- (1) ------------------------------------------------------------------------------------------------
create or replace function api_my_pending_bookings(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(t.row order by t.created_at desc), '[]'::jsonb) into v_rows
  from (
    select
      jsonb_build_object(
        'ref', b.ref,
        'status', b.status,
        'paymentState', b.payment_state,
        'totalMinor', b.total_minor,
        'currency', b.currency,
        'createdAt', b.created_at,
        'holdExpiresAt', h.expires_at,
        'title', coalesce(a.title, 'Your booking'),
        'startsAt', occ.starts_at
      ) as row,
      b.created_at
    from bookings b
    left join lateral (
      select bh.expires_at from booking_holds bh
      where bh.booking_id = b.id and bh.status = 'active'
      order by bh.expires_at desc
      limit 1
    ) h on true
    left join lateral (
      select bi.session_occurrence_id, bi.activity_option_id from booking_items bi
      where bi.booking_id = b.id
      order by bi.created_at
      limit 1
    ) item on true
    left join session_occurrences occ on occ.id = item.session_occurrence_id
    left join activity_options ao on ao.id = item.activity_option_id
    left join activities a on a.id = ao.activity_id
    where b.user_id = v_uid
      and b.status = 'payment_pending'
      and b.payment_state = 'pending'
  ) t;
  return v_rows;
end;
$$;

revoke execute on function api_my_pending_bookings(jsonb) from public;
grant execute on function api_my_pending_bookings(jsonb) to authenticated;

-- (2) ------------------------------------------------------------------------------------------------
create or replace function run_booking_maintenance(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_grace interval := make_interval(
    mins => least(greatest(coalesce((p ->> 'graceMinutes')::int, 30), 1), 1440)
  );
  v_holds int;
  v_bookings int;
begin
  v_holds := expire_holds();

  with stale as (
    update bookings b
       set status = 'expired', updated_at = now()
     where b.status in ('draft', 'held', 'payment_pending')
       and b.payment_state = 'pending'
       and b.created_at < now() - v_grace
       and not exists (
         select 1 from payments pay
         where pay.booking_id = b.id
           and pay.status in ('paid', 'partially_refunded', 'refunded')
       )
    returning b.id
  ), audited as (
    insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
    select null, 'system', 'auto_expire_booking', 'booking', s.id,
           'payment_pending past grace, no settled payment'
    from stale s
    returning 1
  )
  select count(*) into v_bookings from stale;

  -- Release any active holds still attached to the just-expired bookings.
  update booking_holds h
     set status = 'released'
    from bookings b
   where h.booking_id = b.id and b.status = 'expired' and h.status = 'active';

  return jsonb_build_object('holdsExpired', v_holds, 'bookingsExpired', v_bookings);
end;
$$;

revoke execute on function run_booking_maintenance(jsonb) from public;
grant execute on function run_booking_maintenance(jsonb) to service_role;

-- (3) ------------------------------------------------------------------------------------------------
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
