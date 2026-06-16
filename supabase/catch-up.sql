-- ============================================================================
-- Belle Mare Tours — catch-up to latest (run once in the Supabase SQL editor)
-- Your live DB has 121000/121200/121300?/121400/121700/121900 but is missing
-- 121600 (booking guards) + 20260616120000 (open availability) + 20260616130000
-- (wider booking ref) + 20260616140000 (rename Island tours -> Sightseeing tours).
-- All statements below are idempotent (create-or-replace / drop-if-exists /
-- if-not-exists / alter ... set default / guarded rename), so it is safe even if
-- a part is already present.
-- ============================================================================

begin;

-- ---- 20260615121300_payment_authz_fix --------------------------------------
-- Security fix (Phase 2 review): api_create_payment must NOT treat a public booking
-- ref as a bearer credential. Drop the `user_id is null` (guest) branch so only the
-- booking's owner or staff can create a payment / read the customer email. Proper
-- guest self-service checkout (a high-entropy emailed token) lands in Phase 4.
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
  -- NB: auth.uid() must be non-null, else `null = null` is NULL (not false) and the
  -- guard would let an anonymous caller through on a guest (user_id NULL) booking.
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  select * into v_payment from payments where idempotency_key = p ->> 'idempotencyKey';
  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email
  );
end;
$$;

-- ---- 20260615121600_booking_admin_guards -----------------------------------
-- Admin-booking write guards (from the admin Bookings adversarial review).
--
-- The admin panel lets staff manage bookings DIRECTLY via PostgREST (the browser
-- client), gated only by the `*_staff` RLS policies. Those policies are column-agnostic
-- `for all`, so without these guards a signed-in staff/admin could hand-craft a PATCH and
-- (a) forge bookings.payment_state = 'paid' / status = 'confirmed', or (b) rewrite financial
-- and identity columns (total_minor, payout, customer_email, ref, …), or (c) fabricate a
-- paid `payments` row — all bypassing the invariant that payment confirmation comes ONLY
-- from the verified webhook -> append_payment_event ledger path.
--
-- We enforce the invariant at the database (the UI is not a security boundary), mirroring
-- the existing enforce_profile_role pattern: the SECURITY DEFINER RPCs (create_booking,
-- append_payment_event, api_create_payment) run as the table owner and service_role runs as
-- itself, so `current_user not in ('anon','authenticated')` lets the legitimate flow through
-- untouched while a browser session is constrained.

-- ---------------------------------------------------------------------------
-- bookings: from a browser session, only `notes` and the operational status
-- transitions (-> completed / -> cancelled) may change. Everything financial,
-- identity- or payment-related is pinned to its previous value.
-- ---------------------------------------------------------------------------
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

  -- Status may only move through the operational transitions staff are allowed to make.
  if new.status is distinct from old.status then
    if not (
      (new.status = 'completed' and old.status = 'confirmed') or
      (new.status = 'cancelled' and old.status in ('draft', 'held', 'payment_pending', 'confirmed'))
    ) then
      raise exception 'forbidden_booking_status_transition'
        using detail = format('%s -> %s', old.status, new.status);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_admin_update_guard on bookings;
create trigger bookings_admin_update_guard
  before update on bookings
  for each row execute function enforce_booking_admin_update();

-- ---------------------------------------------------------------------------
-- payments + booking_items: never written directly from a browser session. All
-- legitimate writes go through SECURITY DEFINER RPCs (owner) or service_role. We
-- block INSERT/UPDATE only (not DELETE) so booking-delete FK cascades still work.
-- ---------------------------------------------------------------------------
create or replace function forbid_public_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'forbidden_direct_write' using detail = tg_table_name;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_no_public_write on payments;
create trigger payments_no_public_write
  before insert or update on payments
  for each row execute function forbid_public_write();

drop trigger if exists booking_items_no_public_write on booking_items;
create trigger booking_items_no_public_write
  before insert or update on booking_items
  for each row execute function forbid_public_write();

-- ---- 20260616120000_open_availability --------------------------------------
-- Open-ended availability. An activity with activities.daily_capacity set is bookable on ANY
-- future day — no pre-generated year, no annual re-enable. The calendar materializes the day
-- slots it needs on demand (capped horizon, so the window simply rolls forward), and a day is
-- full once its bookings + holds reach the capacity. Activities with daily_capacity = null keep
-- the legacy explicit-occurrence model untouched.

alter table activities add column if not exists daily_capacity int;

-- Needed so day-materialization can de-dupe via ON CONFLICT (and a good integrity guard against
-- duplicate slots). Idempotent — also repairs databases that drifted without it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'session_occurrences_option_start_key') then
    alter table session_occurrences
      add constraint session_occurrences_option_start_key unique (activity_option_id, starts_at);
  end if;
end $$;

-- Availability for an activity over a date range, with live seats_left. For open-ended
-- activities it first fills in any missing daily slots within the (capped) window — so the
-- customer calendar always shows future dates without anyone topping it up. SECURITY DEFINER so
-- the lazy fill can write; gated to published activities, so it never leaks draft availability.
create or replace function api_list_availability(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_activity activities;
  v_from date := coalesce((p ->> 'from')::date, current_date);
  v_to date := coalesce((p ->> 'to')::date, current_date + 30);
  v_fill_to date;
  v_result jsonb;
begin
  select * into v_activity from activities where slug = p ->> 'slug';
  if not found or v_activity.status <> 'published' then
    return '[]'::jsonb;
  end if;

  v_from := greatest(v_from, current_date);
  v_to := least(v_to, current_date + 400);
  -- Bound the per-call write to ~6 months regardless of the read window, so an anonymous read
  -- can never trigger a huge fill; the window still rolls forward as current_date advances.
  v_fill_to := least(v_to, current_date + 185);

  -- Open-ended activity: fill any day in [today, fill horizon] that has NO occurrence yet for
  -- the option — compared on the UTC calendar day, so a legacy/seed slot at a different time of
  -- day blocks a duplicate and each day ends up with exactly one bookable slot. Includes today,
  -- so same-day booking works. One slot per option per day at noon UTC; capacity = daily_capacity.
  if coalesce(v_activity.daily_capacity, 0) > 0 then
    insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
    select o.id,
           v_activity.operator_id,
           (d::date + time '12:00') at time zone 'UTC',
           ((d::date + time '12:00') at time zone 'UTC')
             + make_interval(mins => coalesce(v_activity.duration_minutes, 240)),
           v_activity.daily_capacity,
           'open'
    from activity_options o
    cross join generate_series(greatest(v_from, current_date), v_fill_to, interval '1 day') d
    where o.activity_id = v_activity.id
      and exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
      and not exists (
        select 1 from session_occurrences x
        where x.activity_option_id = o.id
          and (x.starts_at at time zone 'UTC')::date = d::date
      )
    on conflict (activity_option_id, starts_at) do nothing;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrenceId', so.id, 'activityOptionId', so.activity_option_id, 'optionName', o.name,
    'startsAt', so.starts_at, 'endsAt', so.ends_at, 'capacity', so.capacity,
    -- Never report negative seats (e.g. if capacity was lowered below already-booked seats).
    'seatsLeft', greatest(so.capacity - used_capacity(so.id), 0), 'status', so.status
  ) order by so.starts_at), '[]'::jsonb)
  into v_result
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  where o.activity_id = v_activity.id
    and so.status = 'open'
    and so.starts_at >= v_from::timestamptz
    and so.starts_at < (v_to + 1)::timestamptz;

  return v_result;
end;
$$;

-- ---- 20260616130000_widen_booking_ref --------------------------------------
-- Widen the booking reference from 8 to 16 hex chars (~32 -> ~64 bits). The ref guards
-- /bookings/{ref} and the confirm webhook lookup; 32 bits is brute-forceable. Existing refs
-- stay valid; only new bookings get the wider space.
alter table bookings
  alter column ref set default ('BMT-' || upper(substr(md5(gen_random_uuid()::text), 1, 16)));

-- ---- 20260616140000_rename_island_to_sightseeing ---------------------------
-- Rename the "Island tours" category to "Sightseeing tours" across the enum, the managed
-- categories row (name + slug) and any activities filed under the old name. Guarded/idempotent.
do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'activity_category' and e.enumlabel = 'Island tours'
  ) then
    alter type activity_category rename value 'Island tours' to 'Sightseeing tours';
  end if;
end $$;
update categories
   set name = 'Sightseeing tours', slug = 'sightseeing-tours'
 where name = 'Island tours' or slug = 'island-tours';
update activities set category = 'Sightseeing tours' where category = 'Island tours';

-- ---- 20260616150000_api_book_slug_guard ------------------------------------
-- api_book optionally verifies the occurrence belongs to the asserted activity slug
-- (expectedSlug), rejecting a tampered occurrenceId. Optional param — contract unchanged.
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
  v_total_qty int := 0;
  v_items jsonb := '[]'::jsonb;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1
    from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::int as q from jsonb_each(p -> 'party') loop
    if r.q < 0 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 then raise exception 'invalid_party'; end if;

  v_hold := create_hold(v_occ, v_total_qty, v_key || ':hold');
  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items
  );

  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- ---- 20260616160000_notifications ------------------------------------------
-- Enqueue a booking-confirmation (and refund) notification on the booking status transition, and
-- the claim/mark RPCs the drain worker uses. Makes the notification_outbox a live path.
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

-- ---- 20260616170000_maintenance --------------------------------------------
-- Scheduled sweep: expire stale holds + abandoned (never-paid, past-grace) bookings. Safe — a
-- late payment on an expired booking is routed to refund_pending by append_payment_event.
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
  )
  select count(*) into v_bookings from stale;

  update booking_holds h
     set status = 'released'
    from bookings b
   where h.booking_id = b.id and b.status = 'expired' and h.status = 'active';

  return jsonb_build_object('holdsExpired', v_holds, 'bookingsExpired', v_bookings);
end;
$$;

revoke execute on function run_booking_maintenance(jsonb) from public;
grant execute on function run_booking_maintenance(jsonb) to service_role;

commit;
