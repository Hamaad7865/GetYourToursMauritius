-- ============================================================================
-- Belle Mare Tours — bug-fix catch-up (2026-06-17)
-- Applies the 6 migrations from the verified bug-hunt fixes to an ALREADY-LIVE DB.
-- Every statement is idempotent (create-or-replace / if-not-exists / drop-if-exists),
-- so it is safe to run even if part is already present.
-- Assumes the DB is current through the 2026-06-16 migrations (booking guards,
-- open/read-only availability, notifications, maintenance).
-- ============================================================================

begin;

-- ==================== 20260617120000_payment_integrity.sql ====================
-- F3: bind a settlement to a single, unambiguous payment row per booking.
--
-- The webhook resolves "the payment for this booking" as the most-recently-created payments row
-- (order by created_at desc limit 1). If a booking ever had more than one payment row, a provider
-- settlement (paid/refunded) could credit the WRONG one, mis-routing later refund/chargeback events
-- and corrupting per-transaction ledger binding. The previous api_create_payment inserted a brand
-- new row whenever the (client-supplied or service-generated) idempotency key differed, so a raw
-- re-POST to /api/v1/payments produced two rows for one booking.
--
-- Fix: reuse the existing LIVE payment for the booking (at most one open/settled payment per
-- booking) instead of inserting a duplicate. A previously FAILED attempt is left behind and a fresh
-- intent is created, so retries after a failure still work. With at most one non-failed row,
-- "most recent" is always the right row.
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
  -- Preserve the Phase-2 authz fix: a public booking ref is NOT a bearer credential, so only the
  -- booking's owner or staff may create a payment. (auth.uid() must be non-null, else `null = null`
  -- is NULL — not false — and an anonymous caller would slip through on a guest booking.)
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  -- Reuse the existing non-failed payment for this booking, so there is never more than one live
  -- payment row a settlement could bind to.
  select * into v_payment from payments
  where booking_id = v_booking.id and status <> 'failed'
  order by created_at desc
  limit 1;

  if not found then
    -- Idempotent retry on the same key returns the same row.
    select * into v_payment from payments where idempotency_key = p ->> 'idempotencyKey';
  end if;

  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    -- write-ahead intent event
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email
  );
end;
$$;

-- ==================== 20260617120100_booking_authz_integrity.sql ====================
-- Authorization & integrity hardening (Phase-3 adversarial review).

-- ---------------------------------------------------------------------------
-- F2: bookings may NOT be inserted directly from a browser session.
--
-- enforce_booking_admin_update guards UPDATEs, but there was no INSERT guard and forbid_public_write
-- was wired only to payments/booking_items. The bookings_staff (`for all ... with check(is_staff())`)
-- policy therefore let a signed-in staff/compromised-staff token hand-craft `POST /rest/v1/bookings`
-- with status='confirmed', payment_state='paid' and arbitrary money columns — a fabricated paid
-- booking with no backing payment ledger. All legitimate booking creation goes through the
-- SECURITY DEFINER create_booking/api_book RPCs (which run as the table owner), so blocking
-- anon/authenticated INSERTs closes the forgery without affecting the real flow. INSERT only — the
-- existing UPDATE guard and DELETE cascades are untouched.
-- ---------------------------------------------------------------------------
drop trigger if exists bookings_no_public_insert on bookings;
create trigger bookings_no_public_insert
  before insert on bookings
  for each row execute function forbid_public_write();

-- ---------------------------------------------------------------------------
-- F12: reviews must not be forgeable by any logged-in user.
--
-- reviews_insert was `with check (auth.uid() is not null)` and the table has no ownership column,
-- so any free signup could POST /rest/v1/reviews for any activity with an attacker-chosen author,
-- rating and text — review/ratings manipulation on the public activity page. There is no customer
-- review-submission feature yet, so drop the public insert path entirely; staff retain full manage
-- via reviews_staff. A genuine "verified purchaser" review path (a SECURITY DEFINER RPC that checks
-- a completed booking) can be added later when the feature ships.
-- ---------------------------------------------------------------------------
drop policy if exists reviews_insert on reviews;

-- ---------------------------------------------------------------------------
-- api_book: F23 (idempotency replay must not disclose another account's booking) + F25 (bound the
-- party quantity so an absurd value is a clean 400, not an int4-overflow 502). Preserves the
-- expectedSlug occurrence-binding guard.
-- ---------------------------------------------------------------------------
create or replace function api_book(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_total_qty bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  -- Bind the occurrence to the activity the caller claims to be booking.
  if v_expected_slug is not null and not exists (
    select 1
    from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  -- Cast each quantity as bigint and bound its magnitude, so a tampered/huge value raises a clean
  -- 'invalid_party' (400) instead of overflowing int4 inside create_booking and surfacing as a 502.
  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  v_hold := create_hold(v_occ, v_total_qty::int, v_key || ':hold');
  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items
  );

  -- F23: create_booking returns the existing row on an idempotency-key replay. Because api_book runs
  -- in a SECURITY DEFINER frame (RLS does not filter the returned DTO), a replay with someone else's
  -- key would otherwise echo back THEIR booking (name, email, ref, items). A fresh booking still has
  -- user_id NULL here (it is claimed just below), so this only fires on a replay of an already-owned
  -- booking by a different caller.
  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;

  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- ==================== 20260617120200_notification_lease.sql ====================
-- F4: stop the notification drain from double-sending.
--
-- claim_notifications only bumped `attempts` and left the row 'pending'; its FOR UPDATE SKIP LOCKED
-- lock was released at claim-commit — BEFORE the slow network send. A second overlapping drain
-- (manual run vs the */5 cron, or two crons) re-claimed the same still-'pending' row and re-sent it
-- (Resend carries no idempotency key), so a customer could receive duplicate confirmation emails.
--
-- Add a visibility-timeout lease: a claimed row gets `locked_until = now() + lease` and is invisible
-- to other claimers until it passes; a crashed worker's row becomes reclaimable automatically once
-- the lease expires. mark_notification clears the lease on completion (success or terminal failure).

alter table notification_outbox add column if not exists locked_until timestamptz;

create or replace function claim_notifications(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 100);
  v_lease interval := make_interval(
    secs => least(greatest(coalesce((p ->> 'leaseSeconds')::int, 300), 30), 3600)
  );
  v_rows jsonb;
begin
  with batch as (
    select id from notification_outbox
    where status = 'pending'
      and attempts < 5
      and (locked_until is null or locked_until <= now())
    order by created_at
    limit v_limit
    for update skip locked
  ), upd as (
    update notification_outbox o
       set attempts = attempts + 1,
           locked_until = now() + v_lease
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
    update notification_outbox
      set status = 'sent', sent_at = now(), last_error = null, locked_until = null
      where id = v_id;
  else
    -- Cast the CASE result explicitly: a CASE over text literals resolves to `text`, and text→enum
    -- is not an implicit assignment cast (the original failure branch would have errored in prod).
    update notification_outbox
      set status = (case when attempts >= 5 then 'failed' else 'pending' end)::notification_status,
          last_error = left(coalesce(p ->> 'error', 'send failed'), 500),
          locked_until = null
      where id = v_id;
  end if;
end;
$$;

revoke execute on function claim_notifications(jsonb) from public;
revoke execute on function mark_notification(jsonb) from public;
grant execute on function claim_notifications(jsonb) to service_role;
grant execute on function mark_notification(jsonb) to service_role;

-- ==================== 20260617120300_availability_fixes.sql ====================
-- Availability consistency & lifecycle fixes (Phase-3 review).

-- ---------------------------------------------------------------------------
-- F19: align the hold lifetime with the abandonment grace + the checkout countdown.
--
-- Holds expired after 15 min, but run_booking_maintenance only expires the abandoned booking after
-- 30 min and the checkout UI promises a 30-min hold. In the 15→30 gap the seat was genuinely free
-- while the customer was still on the payment page, so another customer could take it and the
-- first-payer would be bumped to refund_pending. Hold the seat for the full 30-minute window.
-- ---------------------------------------------------------------------------
alter table booking_holds alter column expires_at set default (now() + interval '30 minutes');

-- ---------------------------------------------------------------------------
-- F5: re-enabling availability must restore days that were closed while booked.
--
-- stopAvailability() closes (and keeps) any day with a booking/active hold. On re-enable,
-- materialize_availability could not replace it: the unique (activity_option_id, starts_at)
-- constraint blocks inserting a fresh 'open' slot at the same noon-UTC time, and nothing ever
-- flipped the 'closed' row back, so the date was lost for resale forever. Reopen closed FUTURE
-- slots for activities that are bookable again (published + daily_capacity > 0) before filling.
-- ---------------------------------------------------------------------------
create or replace function materialize_availability(p jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_activity_id uuid := nullif(p ->> 'activityId', '')::uuid;
  v_days int := least(greatest(coalesce((p ->> 'days')::int, 185), 1), 400);
  v_count int;
begin
  -- Reopen previously-closed, still-future day-slots for activities that are bookable again.
  update session_occurrences so
     set status = 'open'
    from activity_options o
    join activities a on a.id = o.activity_id
   where so.activity_option_id = o.id
     and so.status = 'closed'
     and so.starts_at > now()
     and a.status = 'published'
     and coalesce(a.daily_capacity, 0) > 0
     and (v_activity_id is null or a.id = v_activity_id);

  insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
  select o.id,
         a.operator_id,
         (d::date + time '12:00') at time zone 'UTC',
         ((d::date + time '12:00') at time zone 'UTC') + make_interval(mins => coalesce(a.duration_minutes, 240)),
         a.daily_capacity,
         'open'
  from activities a
  join activity_options o on o.activity_id = a.id
  cross join generate_series(current_date, current_date + v_days, interval '1 day') d
  where a.status = 'published'
    and coalesce(a.daily_capacity, 0) > 0
    and (v_activity_id is null or a.id = v_activity_id)
    and exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
    and not exists (
      select 1 from session_occurrences x
      where x.activity_option_id = o.id
        and (x.starts_at at time zone 'UTC')::date = d::date
    )
  on conflict (activity_option_id, starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- F16: the availability read must not advertise a slot that booking will reject.
--
-- Open-ended day-slots are materialized at noon UTC. The read returned today's slot for the whole
-- UTC calendar day, but create_hold rejects any occurrence with starts_at <= now()
-- (occurrence_in_past). After noon UTC the API therefore showed today as bookable (seatsLeft > 0)
-- while every hold/book attempt hard-failed. Filter the read on starts_at > now() to mirror
-- create_hold exactly.
-- ---------------------------------------------------------------------------
create or replace function api_list_availability(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_activity activities;
  v_from date := coalesce((p ->> 'from')::date, current_date);
  v_to date := coalesce((p ->> 'to')::date, current_date + 30);
  v_result jsonb;
begin
  select * into v_activity from activities where slug = p ->> 'slug';
  if not found or v_activity.status <> 'published' then
    return '[]'::jsonb;
  end if;

  v_from := greatest(v_from, current_date);
  v_to := least(v_to, current_date + 400);

  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrenceId', so.id, 'activityOptionId', so.activity_option_id, 'optionName', o.name,
    'startsAt', so.starts_at, 'endsAt', so.ends_at, 'capacity', so.capacity,
    'seatsLeft', greatest(so.capacity - used_capacity(so.id), 0), 'status', so.status
  ) order by so.starts_at), '[]'::jsonb)
  into v_result
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  where o.activity_id = v_activity.id
    and so.status = 'open'
    and so.starts_at > now() -- mirror create_hold: never advertise a slot booking would reject
    and so.starts_at >= v_from::timestamptz
    and so.starts_at < (v_to + 1)::timestamptz;

  return v_result;
end;
$$;

-- ==================== 20260617120400_booking_cancel_refund.sql ====================
-- F14: cancelling a PAID booking must record the refund obligation, not silently keep the money.
--
-- setBookingStatus(id,'cancelled') was permitted for a confirmed booking and only changed status;
-- the guard pins payment_state, so a paid booking became status='cancelled', payment_state='paid'
-- with no refund/refund_pending state and no notification — the seat is freed for resale but the
-- system records nothing owed back to the customer (chargeback / accounting-drift risk).
--
-- Route a browser-session cancel of a paid (or partially-refunded) booking to 'refund_pending'
-- instead, so the retained-funds obligation is explicit. The actual refund still flows through the
-- verified webhook → append_payment_event ledger, which sets payment_state='refunded'. An UNPAID
-- booking cancels exactly as before.
create or replace function enforce_booking_admin_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new; -- service_role / owner / SECURITY DEFINER RPCs (webhook, create_booking)
  end if;

  -- Immutable from a browser session — owned by the booking/ledger RPCs.
  new.payment_state           := old.payment_state;
  new.total_minor             := old.total_minor;
  new.agency_commission_minor := old.agency_commission_minor;
  new.operator_payout_minor   := old.operator_payout_minor;
  new.currency                := old.currency;
  new.ref                     := old.ref;
  new.idempotency_key         := old.idempotency_key;
  new.user_id                 := old.user_id;
  new.customer_name           := old.customer_name;
  new.customer_email          := old.customer_email;
  new.customer_phone          := old.customer_phone;
  new.source                  := old.source;
  new.created_at              := old.created_at;

  -- A cancel on a paid booking becomes a refund_pending (money is owed back).
  if new.status = 'cancelled' and old.payment_state in ('paid', 'partially_refunded') then
    new.status := 'refund_pending';
  end if;

  -- Status may only move through the operational transitions staff are allowed to make.
  if new.status is distinct from old.status then
    if not (
      (new.status = 'completed' and old.status = 'confirmed') or
      (new.status = 'cancelled' and old.status in ('draft', 'held', 'payment_pending', 'confirmed')) or
      (new.status = 'refund_pending' and old.status = 'confirmed')
    ) then
      raise exception 'forbidden_booking_status_transition'
        using detail = format('%s -> %s', old.status, new.status);
    end if;
  end if;

  return new;
end;
$$;

-- ==================== 20260617120500_leads_rate_limit.sql ====================
-- F7: throttle the public, unauthenticated lead-capture endpoint.
--
-- api_capture_lead is anon-granted and inserted a row on every call with no rate limit, so anyone
-- could script unlimited writes — flooding the admin inbox and the leads table. Add a per-IP hourly
-- cap as defence in depth (the primary control should be a Cloudflare Rate Limiting rule / Turnstile
-- at the edge; the route also drops obvious bots via a honeypot field before this runs).

alter table leads add column if not exists ip text;
create index if not exists leads_ip_created_idx on leads (ip, created_at);

create or replace function api_capture_lead(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead leads;
  v_ip text := nullif(p ->> 'ip', '');
  v_recent int;
  v_max_per_hour constant int := 8;
begin
  if v_ip is not null then
    select count(*) into v_recent
    from leads
    where ip = v_ip and created_at > now() - interval '1 hour';
    if v_recent >= v_max_per_hour then
      raise exception 'rate_limited' using detail = format('ip %s', v_ip);
    end if;
  end if;

  insert into leads (name, contact, interest_activity_id, source, ip)
  values (
    p ->> 'name', p ->> 'contact',
    nullif(p ->> 'interestActivityId', '')::uuid,
    coalesce(p ->> 'source', 'web'),
    v_ip
  )
  returning * into v_lead;
  return jsonb_build_object(
    'id', v_lead.id, 'name', v_lead.name, 'contact', v_lead.contact,
    'interestActivityId', v_lead.interest_activity_id, 'status', v_lead.status,
    'source', v_lead.source, 'createdAt', v_lead.created_at
  );
end;
$$;

commit;
