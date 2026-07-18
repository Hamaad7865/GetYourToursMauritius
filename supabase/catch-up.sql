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

-- ---- 20260616180000_availability_read_only ---------------------------------
-- Move open-ended day-slot fill OFF the read path: api_list_availability becomes a pure STABLE
-- read; materialize_availability() (cron + admin) does the fill. (This api_list_availability
-- supersedes the lazy one defined earlier in this file.)
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

revoke execute on function materialize_availability(jsonb) from public;
grant execute on function materialize_availability(jsonb) to authenticated, service_role;

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
    and so.starts_at >= v_from::timestamptz
    and so.starts_at < (v_to + 1)::timestamptz;

  return v_result;
end;
$$;

-- ---- 20260616190000_vehicle_pricing ----------------------------------------
-- Third pricing mode: one flat price for the vehicle that fits the party. Replaces the
-- group_pricing boolean with a pricing_mode enum, adds booking_items.pax, rewrites create_booking
-- (vehicle branch), api_book (hold = 1 vehicle), booking_json (pax), and the catalogue DTOs.
alter table activities add column if not exists pricing_mode text not null default 'per_person'
  check (pricing_mode in ('per_person', 'per_group', 'vehicle'));
-- Backfill only if the legacy column is still present (a re-run, or a DB that never had 121900,
-- will have dropped/never-had it). Guarded so the statement isn't planned when the column is gone.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activities' and column_name = 'group_pricing'
  ) then
    update activities set pricing_mode = 'per_group' where coalesce(group_pricing, false) = true;
  end if;
end $$;
alter table booking_items add column if not exists pax int;

create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_bracket_label text;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  select a.pricing_mode into v_mode
  from activity_options o join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_mode = 'vehicle' then
    select amount_minor, label into v_unit, v_bracket_label
    from activity_option_prices
    where activity_option_id = v_option_id and max_guests >= v_qty_total
    order by max_guests asc limit 1;
    if not found then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    v_total := v_unit;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch' using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_mode = 'vehicle' then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (v_booking.id, v_hold.session_occurrence_id, v_option_id, v_bracket_label, 1, v_unit, v_unit, v_qty_total);
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
             else v_unit * v_qty end
      );
    end loop;
  end if;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

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
  v_mode text := 'per_person';
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;
  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
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

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');

  if v_mode = 'vehicle' then
    v_hold := create_hold(v_occ, 1, v_key || ':hold');
  else
    v_hold := create_hold(v_occ, v_total_qty, v_key || ':hold');
  end if;

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

create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

create or replace function api_get_activity(p jsonb)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description, 'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', (select min(pr.amount_minor)::float / 100 from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id where o.activity_id = a.id),
    'heroImage', (select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position) from activity_images img where img.activity_id = a.id order by img.position limit 1),
    'images', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position) from activity_images i where i.activity_id = a.id), '[]'::jsonb),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests) order by pr.position) from activity_option_prices pr where pr.activity_option_id = o.id), '[]'::jsonb)
      ) order by o.position) from activity_options o where o.activity_id = a.id), '[]'::jsonb),
    'translations', coalesce((select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description)) from activity_translations t where t.activity_id = a.id), '{}'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at) order by rv.created_at desc) from reviews rv where rv.activity_id = a.id), '[]'::jsonb)
  )
  from activities a where a.slug = p ->> 'slug';
$$;

create or replace function api_search_activities(p jsonb)
returns jsonb language sql stable security invoker set search_path = public as $$
  with filtered as (
    select a.* from activities a
    where a.status = 'published'
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (p ->> 'q' is null or a.title ilike '%' || (p ->> 'q') || '%' or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%')
  ), paged as (
    select * from filtered order by rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'fromPriceEur', (select min(pr.amount_minor)::float / 100 from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id where o.activity_id = x.id),
        'fromPriceMaxGuests', (select pr.max_guests from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id where o.activity_id = x.id order by pr.amount_minor asc nulls last limit 1),
        'heroImage', (select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position) from activity_images img where img.activity_id = x.id order by img.position limit 1),
        'images', coalesce((select jsonb_agg(jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position) order by img.position) from activity_images img where img.activity_id = x.id), '[]'::jsonb)
      )) from paged x), '[]'::jsonb),
    'total', (select count(*)::int from filtered),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

alter table activities drop column if exists group_pricing;


-- ============================================================================
-- APPENDED 2026-06-17 — folds the later migrations into the single catch-up so the
-- live DB no longer drifts: sightseeing_pricing table + global vehicle pricing (130000),
-- custom itinerary (140000), hold reuse (150000), FLAT vehicle pricing (160000),
-- pickup location (170000), child seats (180000). All idempotent — last definition wins.
-- ============================================================================

-- ---- migration 20260617130000_sightseeing_vehicle_pricing ----------------------------------------------
-- Sightseeing vehicle pricing — ONE global rule for every sightseeing tour.
--
-- Price = €70 per block of 4 people (per_block_minor * ceil(P / 4)), with a flat €85 SUV upgrade for
-- parties of 1-4. Party is capped at 25. The vehicle name is a function of P (Sedan/Family car/
-- Minibus/Coaster; SUV when upgraded). The two prices live in a single-row config table so the owner
-- changes them once for all tours. Each booking still reserves ONE vehicle slot of the day's capacity
-- (quantity = 1) and records people in booking_items.pax. Replaces the old flat-bracket vehicle mode.

-- 1) Global config: one row, two tunable prices. The prices are public (shown on the site), and the
--    SECURITY INVOKER catalogue RPCs read it as the caller's role, so RLS allows public SELECT but no
--    write policy → only the owner / service_role (SQL editor) can change the prices.
create table if not exists sightseeing_pricing (
  id              boolean primary key default true check (id),
  per_block_minor int not null default 7000,  -- €70 per block of 4
  suv_flat_minor  int not null default 8500,  -- €85 SUV, flat, parties of 1-4
  updated_at      timestamptz not null default now()
);
insert into sightseeing_pricing (id) values (true) on conflict (id) do nothing;
alter table sightseeing_pricing enable row level security;
drop policy if exists sightseeing_pricing_read on sightseeing_pricing;
create policy sightseeing_pricing_read on sightseeing_pricing for select using (true);
grant select on sightseeing_pricing to anon, authenticated, service_role;

-- 2) create_booking gains p_suv (8th arg). Drop the old 7-arg first so this REPLACES it rather than
--    creating an overload (7-arg positional callers then bind here via the default).
drop function if exists create_booking(text, uuid, text, text, text, booking_source, jsonb);

create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb,
  p_suv boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_vehicle text;
  v_per_block bigint;
  v_suv_flat bigint;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  select a.pricing_mode into v_mode
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  -- Aggregate quantity (people) per price_label, collapsing duplicate lines.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_mode = 'vehicle' then
    -- Global sightseeing rule. P = v_qty_total (people on board).
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select per_block_minor, suv_flat_minor into v_per_block, v_suv_flat from sightseeing_pricing limit 1;
    if v_per_block is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 and p_suv then
      v_total := v_suv_flat;
      v_vehicle := 'SUV';
    else
      v_total := v_per_block * ceil(v_qty_total::numeric / 4)::int;
      v_vehicle := case
        when v_qty_total <= 4 then 'Sedan'
        when v_qty_total <= 6 then 'Family car'
        when v_qty_total <= 14 then 'Minibus'
        else 'Coaster'
      end;
    end if;
    -- The hold reserves ONE vehicle, not P seats.
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: price each aggregated tier from the DB.
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch'
        using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_mode = 'vehicle' then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (
      v_booking.id, v_hold.session_occurrence_id, v_option_id, v_vehicle,
      1, v_total, v_total, v_qty_total
    );
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case
          when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
          else v_unit * v_qty
        end
      );
    end loop;
  end if;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to anon, authenticated, service_role;

-- 3) api_book: keep F23 (replay-disclosure guard) + F25 (party bound), restore the vehicle branch
--    (hold ONE vehicle), and thread the suv flag to create_booking.
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
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

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');

  -- Vehicle bookings take ONE slot of the day's capacity regardless of party size.
  if v_mode = 'vehicle' then
    v_hold := create_hold(v_occ, 1, v_key || ':hold');
  else
    v_hold := create_hold(v_occ, v_total_qty::int, v_key || ':hold');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23: a replay with someone else's key must not echo back their booking.
  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;

  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 4) Catalogue: for vehicle mode, fromPriceEur = the €70 base and expose the config block so the
--    booking widget mirrors the exact numbers. Non-vehicle modes unchanged.
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select per_block_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'perBlockEur', per_block_minor::float / 100,
        'suvFlatEur', suv_flat_minor::float / 100,
        'blockSize', 4,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*
    from activities a
    where a.status = 'published'
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
  ),
  paged as (
    select * from filtered
    order by rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'fromPriceEur', case
          when x.pricing_mode = 'vehicle'
            then (select per_block_minor from sightseeing_pricing limit 1)::float / 100
          else (
            select min(pr.amount_minor)::float / 100
            from activity_option_prices pr
            join activity_options o on o.id = pr.activity_option_id
            where o.activity_id = x.id
          )
        end,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from filtered),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- ---- migration 20260617140000_booking_custom_itinerary ----------------------------------------------
-- Customer-customizable itinerary: the chosen route is saved on the booking so the driver follows it.
-- It carries no price (informational), so api_book stores it with a post-create UPDATE — create_booking
-- and the pricing path are untouched.

alter table bookings add column if not exists custom_itinerary jsonb;

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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
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

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');

  if v_mode = 'vehicle' then
    v_hold := create_hold(v_occ, 1, v_key || ':hold');
  else
    v_hold := create_hold(v_occ, v_total_qty::int, v_key || ':hold');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;

  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  -- Save the customer's chosen route (informational; no price impact). Only on a fresh booking
  -- (an idempotency replay keeps the original route).
  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- ---- migration 20260617150000_hold_reuse ----------------------------------------------
-- Hold-on-Continue: a dedicated anonymous hold RPC + api_book reuse of an existing hold (so the spot
-- is reserved when the customer clicks Continue, and the same hold is settled at pay — no double-hold).

-- 1) api_create_hold: reserve the spot for a date. qty is authoritative from the pricing mode
--    (vehicle → 1 vehicle; else the people count). Anonymous-friendly (no email needed).
create or replace function api_create_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_people bigint := coalesce((p ->> 'people')::bigint, 0);
  v_mode text := 'per_person';
  v_qty int;
  v_hold booking_holds;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;
  if v_people <= 0 or v_people > 1000000 then
    raise exception 'invalid_party';
  end if;
  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_qty := case when coalesce(v_mode, 'per_person') = 'vehicle' then 1 else v_people::int end;

  v_hold := create_hold(v_occ, v_qty, v_key);
  return jsonb_build_object('holdId', v_hold.id, 'quantity', v_hold.quantity, 'expiresAt', v_hold.expires_at);
end;
$$;

grant execute on function api_create_hold(jsonb) to anon, authenticated, service_role;

-- 2) api_book: reuse a hold passed by Continue (holdId) instead of creating a fresh one. Falls back
--    to creating one if holdId is absent/expired/mismatched, so a stale hold never blocks booking.
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode = 'vehicle' then 1 else v_total_qty::int end;

  -- Reuse the Continue hold when it's still valid for this exact occurrence + qty and not yet linked
  -- to a booking (so a leaked/already-consumed hold can't be re-attached).
  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  -- Fall back to a FRESH hold on any reuse miss. The key must differ from the Continue hold's
  -- '<key>:hold' (api_create_hold) — otherwise create_hold's idempotency short-circuit would hand back
  -- the very hold that just failed the guard (e.g. expired), hard-locking the booking.
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- ---- migration 20260617160000_flat_vehicle_pricing ----------------------------------------------
-- Flat per-vehicle sightseeing pricing (owner-confirmed). Replaces the "€70 per block of 4" rule with
-- ONE flat price per bracket: Sedan €70 (SUV €85) for 1-4, Family car €85 for 5-6, Van €125 for 7-14,
-- Coaster €225 for 15-25, capped at 25. create_booking + the catalogue functions only (api_book and
-- booking_json keep their later hold-reuse / custom-itinerary definitions).

-- 1) Config: the five bracket prices (one global row). add-if-not-exists so a live DB picks up the
--    new columns with the confirmed defaults; the legacy per_block_minor/suv_flat_minor are left
--    unused.
alter table sightseeing_pricing add column if not exists sedan_minor   int not null default 7000;  -- €70
alter table sightseeing_pricing add column if not exists suv_minor     int not null default 8500;  -- €85
alter table sightseeing_pricing add column if not exists family_minor  int not null default 8500;  -- €85
alter table sightseeing_pricing add column if not exists van_minor     int not null default 12500; -- €125
alter table sightseeing_pricing add column if not exists coaster_minor int not null default 22500; -- €225

-- 2) create_booking: flat-bracket vehicle pricing.
create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb,
  p_suv boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_vehicle text;
  v_sedan bigint;
  v_suv_price bigint;
  v_family bigint;
  v_van bigint;
  v_coaster bigint;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  select a.pricing_mode into v_mode
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  -- Aggregate quantity (people) per price_label, collapsing duplicate lines.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_mode = 'vehicle' then
    -- One flat price for the bracket that fits P = v_qty_total (people on board).
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select sedan_minor, suv_minor, family_minor, van_minor, coaster_minor
      into v_sedan, v_suv_price, v_family, v_van, v_coaster
      from sightseeing_pricing limit 1;
    if v_sedan is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_suv_price;
        v_vehicle := 'SUV';
      else
        v_total := v_sedan;
        v_vehicle := 'Sedan';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_family;
      v_vehicle := 'Family car';
    elsif v_qty_total <= 14 then
      v_total := v_van;
      v_vehicle := 'Van';
    else
      v_total := v_coaster;
      v_vehicle := 'Coaster';
    end if;
    -- The hold reserves ONE vehicle, not P seats.
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: price each aggregated tier from the DB.
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch'
        using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_mode = 'vehicle' then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (
      v_booking.id, v_hold.session_occurrence_id, v_option_id, v_vehicle,
      1, v_total, v_total, v_qty_total
    );
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case
          when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
          else v_unit * v_qty
        end
      );
    end loop;
  end if;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to anon, authenticated, service_role;

-- 3) Catalogue: vehicle mode → fromPriceEur = the Sedan price, and the five-bracket config block.
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*
    from activities a
    where a.status = 'published'
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
  ),
  paged as (
    select * from filtered
    order by rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'fromPriceEur', case
          when x.pricing_mode = 'vehicle'
            then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
          else (
            select min(pr.amount_minor)::float / 100
            from activity_option_prices pr
            join activity_options o on o.id = pr.activity_option_id
            where o.activity_id = x.id
          )
        end,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from filtered),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- ---- migration 20260617170000_booking_pickup_location ----------------------------------------------
-- Persist the pickup location the customer enters at checkout. It was collected in the checkout UI
-- but never sent/stored, so the provider received nothing. Like custom_itinerary, it carries no price
-- (informational), so api_book stores it with a post-create UPDATE — create_booking / pricing untouched.

alter table bookings add column if not exists pickup_location text;

-- api_book: same hold-reuse logic as before, plus persisting the pickup location after create.
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode = 'vehicle' then 1 else v_total_qty::int end;

  -- Reuse the Continue hold when it's still valid for this exact occurrence + qty and not yet linked
  -- to a booking (so a leaked/already-consumed hold can't be re-attached).
  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  -- Fall back to a FRESH hold on any reuse miss. The key must differ from the Continue hold's
  -- '<key>:hold' (api_create_hold) — otherwise create_hold's idempotency short-circuit would hand back
  -- the very hold that just failed the guard (e.g. expired), hard-locking the booking.
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  -- Save the customer's chosen route (informational; no price impact). Only on a fresh booking.
  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  -- Save the customer's pickup location (informational; bounded). Only on a fresh booking.
  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- booking_json: expose pickupLocation alongside customItinerary.
create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- ---- migration 20260617180000_child_seats ----------------------------------------------
-- Baby/child seats add-on (every tour): the first seat is free, each additional seat is €6. The
-- charge is computed SERVER-SIDE in api_book and folded into the booking total (operator payout too),
-- so the client price is never trusted. Like pickup/itinerary, it's a guarded post-create UPDATE —
-- create_booking and its pricing are untouched.

alter table bookings add column if not exists child_seats int not null default 0;

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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode = 'vehicle' then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden (original F23);
  --   * an anonymous caller whose supplied email doesn't match the booking on file -> forbidden. This
  --     closes guest replays (user_id NULL): a stolen/guessed key alone would otherwise hand back the
  --     original customer's name/email/ref/items. A legitimate guest retry resends the same email and
  --     passes; a fresh create trivially passes (the row was just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (auth.uid() is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Child seats: first free, €6 (600 minor) each additional. Bounded to the party size; folded into
  -- the total + operator payout. Guard child_seats=0 so an idempotency replay can't charge twice.
  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  return booking_json(v_booking.id);
end;
$$;

create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'childSeats', b.child_seats,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- ============================================================================================
-- APPENDED 2026-06-17 — folds the 20260617120000–120500 fix series the earlier catch-up build
-- skipped (it jumped 20260616190000 → 20260617130000). These are the FINAL definitions; placed
-- here so create-or-replace supersedes the older copies above. NOTE: migration 120100 also
-- redefined api_book, but its FINAL version is in 180000_child_seats (already applied above), so
-- only 120100's INSERT-guard trigger + reviews policy drop are folded — NOT its stale api_book.
-- ============================================================================================

-- ---- migration 20260617120000_payment_integrity (F3: one live payment row per booking) ------
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
  -- Refuse to (re)create a payment for a booking that is already paid or in a terminal state — a
  -- returning customer (back/reload of checkout) must not be walked into a second charge for the same
  -- booking. The pre-payment states (draft/held/payment_pending) are allowed through unchanged.
  if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
     or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'booking_not_payable' using detail = v_booking.status::text;
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  select * into v_payment from payments
  where booking_id = v_booking.id and status <> 'failed'
  order by created_at desc
  limit 1;

  if not found then
    select * into v_payment from payments where idempotency_key = p ->> 'idempotencyKey';
  end if;

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

-- ---- migration 20260617120100_booking_authz_integrity (F2 forged-booking guard + F12) --------
drop trigger if exists bookings_no_public_insert on bookings;
create trigger bookings_no_public_insert
  before insert on bookings
  for each row execute function forbid_public_write();

drop policy if exists reviews_insert on reviews;

-- ---- migration 20260617120200_notification_lease (F4: lease so the drain can't double-send) --
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
    returning o.id, o.channel, o.recipient, o.template, o.payload, o.booking_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'channel', channel, 'recipient', recipient, 'template', template,
    'payload', payload, 'bookingId', booking_id
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

-- ---- migration 20260617120300_availability_fixes (F19 30-min hold / F5 reopen / F16 filter) --
alter table booking_holds alter column expires_at set default (now() + interval '30 minutes');

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
  -- Staff (admin browser) or the service-role maintenance worker only (sweep medium: was open to any
  -- signed-in customer, who could loop a full-catalogue 400-day write).
  if not (is_staff() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

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
    and so.starts_at > now()
    and so.starts_at >= v_from::timestamptz
    and so.starts_at < (v_to + 1)::timestamptz;

  return v_result;
end;
$$;

-- ---- migration 20260617120400_booking_cancel_refund (F14: paid cancel -> refund_pending) -----
create or replace function enforce_booking_admin_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

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

  if new.status = 'cancelled' and old.payment_state in ('paid', 'partially_refunded') then
    new.status := 'refund_pending';
  end if;

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

-- ---- migration 20260617120500_leads_rate_limit (F7: per-IP hourly cap on lead capture) -------
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

-- ---- migration 20260617190000_flatfare_pricing_mode -----------------------------------------
-- Flat-fare tours (private tour, airport transfer, car/scooter rental) were on the default
-- pricing_mode 'per_person', so the flat per-booking fare was multiplied by headcount (a 4-person
-- private-south tour billed €440 instead of €110). They are per-group fares. Guarded so it only
-- corrects rows still on the wrong default.
update activities
set pricing_mode = 'per_group'
where slug in ('private-south-tour-with-pickup', 'airport-transfer', 'car-and-scooter-rental')
  -- Self-heal: a drifted live DB may have these rows on NULL (column added without the default by an
  -- older script) — `= 'per_person'` skipped those. Cover NULL/per_person; preserve a deliberate 'vehicle'.
  and coalesce(pricing_mode, '') <> 'vehicle';


-- ============ planner vehicle pricing (vehicle_custom) — folded for parity ============

-- Planner vehicle pricing — a PARALLEL flat-bracket path for the AI Road Trip Planner, separate from
-- the sightseeing 'vehicle' mode. A new pricing_mode 'vehicle_custom' reads its OWN config table
-- (planner_pricing: Standard €95 / SUV €100 (1-4) · 6-seater €110 (5-6) · Van €150 (7-14) ·
-- Coach €250 (15-22), cap 22). The existing 'vehicle' path (sightseeing_pricing) is left untouched.
-- Both config tables become staff-editable (admin pricing screen). create_booking gains a parallel
-- branch; api_create_hold / api_book treat vehicle_custom like vehicle (reserve ONE vehicle).

-- 1) Planner config: one row, five bracket prices + cap. Public read (shown in the planner), staff edit.
create table if not exists planner_pricing (
  id             boolean primary key default true check (id),
  standard_minor int not null default 9500,   -- €95  (1-4)
  suv_minor      int not null default 10000,  -- €100 (1-4 upgrade)
  six_minor      int not null default 11000,  -- €110 (5-6)
  van_minor      int not null default 15000,  -- €150 (7-14)
  coach_minor    int not null default 25000,  -- €250 (15-22)
  max_party      int not null default 22,
  updated_at     timestamptz not null default now()
);
insert into planner_pricing (id) values (true) on conflict (id) do nothing;
alter table planner_pricing enable row level security;
grant select on planner_pricing to anon, authenticated, service_role;
grant update on planner_pricing to authenticated;
drop policy if exists planner_pricing_read on planner_pricing;
create policy planner_pricing_read on planner_pricing for select using (true);
drop policy if exists planner_pricing_staff on planner_pricing;
create policy planner_pricing_staff on planner_pricing for all using (is_staff()) with check (is_staff());

-- 2) Make the sightseeing config staff-editable too (it was read-only / SQL-only before).
grant update on sightseeing_pricing to authenticated;
drop policy if exists sightseeing_pricing_staff on sightseeing_pricing;
create policy sightseeing_pricing_staff on sightseeing_pricing for all using (is_staff()) with check (is_staff());

-- 3) Activities: flag the planner activity (hidden from the public catalogue) + allow the new mode.
alter table activities add column if not exists is_custom_planner boolean not null default false;
do $$
begin
  alter table activities drop constraint if exists activities_pricing_mode_check;
  alter table activities add constraint activities_pricing_mode_check
    check (pricing_mode in ('per_person', 'per_group', 'vehicle', 'vehicle_custom'));
exception when duplicate_object then null;
end $$;

-- 4) create_booking: add a 'vehicle_custom' branch (planner_pricing). The 'vehicle' and per-person/
--    per-group branches are byte-for-byte the shipped (flat_vehicle_pricing) versions.
create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb,
  p_suv boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_vehicle text;
  v_sedan bigint;
  v_suv_price bigint;
  v_family bigint;
  v_van bigint;
  v_coaster bigint;
  v_pl_standard bigint;
  v_pl_suv bigint;
  v_pl_six bigint;
  v_pl_van bigint;
  v_pl_coach bigint;
  v_pl_max int;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  select a.pricing_mode into v_mode
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_mode = 'vehicle' then
    -- One flat price for the bracket that fits P = v_qty_total (people on board). (Unchanged.)
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select sedan_minor, suv_minor, family_minor, van_minor, coaster_minor
      into v_sedan, v_suv_price, v_family, v_van, v_coaster
      from sightseeing_pricing limit 1;
    if v_sedan is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_suv_price;
        v_vehicle := 'SUV';
      else
        v_total := v_sedan;
        v_vehicle := 'Sedan';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_family;
      v_vehicle := 'Family car';
    elsif v_qty_total <= 14 then
      v_total := v_van;
      v_vehicle := 'Van';
    else
      v_total := v_coaster;
      v_vehicle := 'Coaster';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle_custom' then
    -- Parallel planner path: same bracket shape, the planner's own prices/names + cap.
    select standard_minor, suv_minor, six_minor, van_minor, coach_minor, max_party
      into v_pl_standard, v_pl_suv, v_pl_six, v_pl_van, v_pl_coach, v_pl_max
      from planner_pricing limit 1;
    if v_pl_standard is null then
      raise exception 'planner_pricing_unset';
    end if;
    if v_qty_total < 1 or v_qty_total > v_pl_max then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_pl_suv;
        v_vehicle := 'SUV';
      else
        v_total := v_pl_standard;
        v_vehicle := 'Standard car';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_pl_six;
      v_vehicle := '6-seater';
    elsif v_qty_total <= 14 then
      v_total := v_pl_van;
      v_vehicle := 'Van';
    else
      v_total := v_pl_coach;
      v_vehicle := 'Coach';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: price each aggregated tier from the DB. (Unchanged.)
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch'
        using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_mode in ('vehicle', 'vehicle_custom') then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (
      v_booking.id, v_hold.session_occurrence_id, v_option_id, v_vehicle,
      1, v_total, v_total, v_qty_total
    );
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case
          when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
          else v_unit * v_qty
        end
      );
    end loop;
  end if;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to anon, authenticated, service_role;

-- 5) api_create_hold: vehicle_custom reserves ONE vehicle, like vehicle. (Else unchanged from hold_reuse.)
create or replace function api_create_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_people bigint := coalesce((p ->> 'people')::bigint, 0);
  v_mode text := 'per_person';
  v_qty int;
  v_hold booking_holds;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;
  if v_people <= 0 or v_people > 1000000 then
    raise exception 'invalid_party';
  end if;
  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_qty := case when coalesce(v_mode, 'per_person') in ('vehicle', 'vehicle_custom') then 1 else v_people::int end;

  v_hold := create_hold(v_occ, v_qty, v_key);
  return jsonb_build_object('holdId', v_hold.id, 'quantity', v_hold.quantity, 'expiresAt', v_hold.expires_at);
end;
$$;
grant execute on function api_create_hold(jsonb) to anon, authenticated, service_role;

-- 6) api_book: vehicle_custom reserves ONE vehicle. (Else byte-for-byte the child_seats version.)
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom') then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 7) Hide the planner activity from the public catalogue search. (Else byte-for-byte flat_vehicle_pricing.)
create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
  ),
  paged as (
    select * from filtered
    order by rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'fromPriceEur', case
          when x.pricing_mode = 'vehicle'
            then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
          else (
            select min(pr.amount_minor)::float / 100
            from activity_option_prices pr
            join activity_options o on o.id = pr.activity_option_id
            where o.activity_id = x.id
          )
        end,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from filtered),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- ---- migration 20260618010000_booking_replay_guard_fix (restore F23 guest replay guard) ----------
-- The last api_book above (from planner_vehicle_pricing) silently reverted the guest half of the F23
-- replay-disclosure guard. Re-apply it with the full guard so a guest idempotency replay with a
-- mismatched email is refused instead of echoing the original customer's PII.
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom') then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): refuse to echo a booking the caller can't prove they own —
  -- authenticated user replaying someone else's OWNED booking, OR an anonymous guest whose supplied
  -- email doesn't match the booking on file (closes guest user_id-NULL replays).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (auth.uid() is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- ---- migration 20260617220000_admin_atomic_writes (staff-only transactional admin RPCs) ----------
create or replace function api_swap_category_positions(p_id_a uuid, p_id_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos_a int;
  v_pos_b int;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  select position into v_pos_a from categories where id = p_id_a;
  if not found then raise exception 'category_not_found'; end if;
  select position into v_pos_b from categories where id = p_id_b;
  if not found then raise exception 'category_not_found'; end if;
  update categories set position = v_pos_b where id = p_id_a;
  update categories set position = v_pos_a where id = p_id_b;
end;
$$;
revoke execute on function api_swap_category_positions(uuid, uuid) from public;
grant execute on function api_swap_category_positions(uuid, uuid) to authenticated, service_role;

create or replace function set_daily_capacity_atomic(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id uuid := nullif(p ->> 'activityId', '')::uuid;
  v_capacity int := (p ->> 'capacity')::int;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_activity_id is null or v_capacity is null or v_capacity < 0 then
    raise exception 'invalid_request';
  end if;
  update activities set daily_capacity = v_capacity where id = v_activity_id;
  update session_occurrences so
     set capacity = v_capacity
    from activity_options o
   where so.activity_option_id = o.id
     and o.activity_id = v_activity_id
     and so.starts_at >= now();
  perform materialize_availability(jsonb_build_object('activityId', v_activity_id::text));
end;
$$;
revoke execute on function set_daily_capacity_atomic(jsonb) from public;
grant execute on function set_daily_capacity_atomic(jsonb) to authenticated, service_role;

create or replace function stop_availability_atomic(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id uuid := nullif(p ->> 'activityId', '')::uuid;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_activity_id is null then
    raise exception 'invalid_request';
  end if;
  update activities set daily_capacity = null where id = v_activity_id;
  update session_occurrences so
     set status = 'closed'
    from activity_options o
   where so.activity_option_id = o.id
     and o.activity_id = v_activity_id
     and so.starts_at >= now()
     and (
       exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
       or exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active')
     );
  delete from session_occurrences so
   using activity_options o
   where so.activity_option_id = o.id
     and o.activity_id = v_activity_id
     and so.starts_at >= now()
     and not exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
     and not exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active');
end;
$$;
revoke execute on function stop_availability_atomic(jsonb) from public;
grant execute on function stop_availability_atomic(jsonb) to authenticated, service_role;

-- ---- migration 20260718120000_availability_mauritius_tz (anchor availability to Mauritius local time) ----
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
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
  v_count int;
begin
  if not (is_staff() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

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
         (d::date + time '12:00') at time zone 'Indian/Mauritius',
         ((d::date + time '12:00') at time zone 'Indian/Mauritius') + make_interval(mins => coalesce(a.duration_minutes, 240)),
         a.daily_capacity,
         'open'
  from activities a
  join activity_options o on o.activity_id = a.id
  cross join generate_series(v_today, v_today + v_days, interval '1 day') d
  where a.status = 'published'
    and coalesce(a.daily_capacity, 0) > 0
    and (v_activity_id is null or a.id = v_activity_id)
    and exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
    and not exists (
      select 1 from session_occurrences x
      where x.activity_option_id = o.id
        and (x.starts_at at time zone 'Indian/Mauritius')::date = d::date
    )
  on conflict (activity_option_id, starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function api_list_availability(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_activity activities;
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
  v_from date := coalesce((p ->> 'from')::date, v_today);
  v_to date := coalesce((p ->> 'to')::date, v_today + 30);
  v_result jsonb;
begin
  select * into v_activity from activities where slug = p ->> 'slug';
  if not found or v_activity.status <> 'published' then
    return '[]'::jsonb;
  end if;

  v_from := greatest(v_from, v_today);
  v_to := least(v_to, v_today + 400);

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
    and so.starts_at > now()
    and so.starts_at >= (v_from::timestamp at time zone 'Indian/Mauritius')
    and so.starts_at < ((v_to + 1)::timestamp at time zone 'Indian/Mauritius');

  return v_result;
end;
$$;

-- ============ planner_places (curated POIs) — folded for live-DB sync ============

-- Curated places for the AI Road Trip Planner — a free-form, hand-picked set of real Mauritius POIs
-- the co-pilot plans a day around (distinct from per-tour itinerary stops). Public read (shown in the
-- planner), staff write (admin editor). `api_planner_places` returns the camelCase DTO.
-- Seed = 39 web-verified POIs (coords inside Mauritius), curated via multi-agent research.

create table if not exists planner_places (
  id text primary key,               -- kebab-case slug
  name text not null,
  category text not null,            -- Beach | Waterfall | Viewpoint | Nature | Culture | Garden | Island | Market | Landmark | Food
  region text not null,              -- North | South | East | West | Central
  lat numeric(9, 6) not null,
  lng numeric(9, 6) not null,
  duration_min int not null check (duration_min > 0),
  closes_at time,                    -- null = open-access
  blurb text,
  image_url text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists planner_places_region_idx on planner_places (region);
create index if not exists planner_places_position_idx on planner_places (position);

alter table planner_places enable row level security;
grant select on planner_places to anon, authenticated, service_role;
grant insert, update, delete on planner_places to authenticated;
drop policy if exists planner_places_read on planner_places;
create policy planner_places_read on planner_places for select using (true);
drop policy if exists planner_places_staff on planner_places;
create policy planner_places_staff on planner_places for all using (is_staff()) with check (is_staff());

-- Seed the curated set (only when empty, so re-running never duplicates).
insert into planner_places (id, name, category, region, lat, lng, duration_min, closes_at, blurb, position)
select * from (values
  ('grand-baie-beach', 'Grand Baie', 'Beach', 'North', -20.0182, 57.5802, 120, null::time, 'Sheltered bay with an emerald lagoon, powder-white beaches, and the liveliest resort town on the island with vibrant nightlife and water sports.', 0),
  ('pereybere-beach', 'Pereybère Beach', 'Beach', 'North', -19.9991, 57.5887, 120, null::time, 'Popular family-friendly beach with a protected swimming area, soft sand, and close proximity to Grand Baie''s restaurants and amenities.', 1),
  ('trou-aux-biches-beach', 'Trou aux Biches', 'Beach', 'North', -20.05, 57.55, 150, null::time, 'One of the island''s finest beaches, blending seamlessly with Mont Choisy as the longest and most beautiful stretch of white sand on the north coast.', 2),
  ('cap-malheureux-church', 'Cap Malheureux (Notre Dame Auxiliatrice)', 'Landmark', 'North', -19.9842, 57.6142, 60, null::time, 'Iconic red-roofed chapel at the northernmost point of Mauritius, overlooking the Indian Ocean and the five northern islets including Coin de Mire.', 3),
  ('pamplemousses-botanical-garden', 'Sir Seewoosagur Ramgoolam Botanical Garden', 'Garden', 'North', -20.1067, 57.5017, 150, '17:30'::time, 'Lush 37-hectare botanical garden featuring giant water lilies, exotic flora, and serene pathways—one of Mauritius'' most visited attractions.', 4),
  ('maheswarnath-temple', 'Maheswarnath Mandir', 'Culture', 'North', -20.0182, 57.5519, 45, '18:00'::time, 'Mauritius'' largest Hindu temple, built in 1888 and dedicated to Lord Shiva, featuring vibrant architecture and spiritual significance.', 5),
  ('coin-de-mire-island', 'Coin de Mire (Gunner''s Quoin)', 'Island', 'North', -19.9392, 57.6136, 180, null::time, 'Protected uninhabited island 8km north with crystal-clear reef snorkeling, diverse marine life, and a nature reserve with dramatic cliff vistas.', 6),
  ('ilot-gabriel-island', 'Ilot Gabriel', 'Island', 'North', -19.9, 57.61, 300, null::time, 'Pristine 42-hectare protected nature reserve island with unspoiled white-sand beaches, crystal-clear waters, and world-class snorkeling opportunities.', 7),
  ('port-louis-central-market', 'Port Louis Central Market', 'Market', 'North', -20.1628, 57.5007, 90, '18:00'::time, 'Historic Victorian-era market bustling with tropical fruits, fresh seafood, spices, and local crafts—the authentic pulse of Mauritian culture since 1839.', 8),
  ('chamarel-seven-coloured-earth', 'Chamarel Seven Coloured Earth Geopark', 'Nature', 'South', -20.4251, 57.3917, 120, '17:00'::time, 'Geological wonder featuring sand dunes of seven distinct rainbow colors set against tropical forest backdrops, a UNESCO-inspired natural marvel.', 9),
  ('le-morne-brabant', 'Le Morne Brabant', 'Landmark', 'South', -20.4563, 57.3082, 180, null::time, 'UNESCO World Heritage site with a 556-meter basaltic monolith offering panoramic views and cultural significance as a former refuge for escaped slaves.', 10),
  ('chamarel-waterfall', 'Chamarel Waterfall', 'Waterfall', 'South', -20.4208, 57.3958, 90, null::time, 'Mauritius'' tallest waterfall at nearly 100 meters, plunging dramatically from forested basalt cliffs into a lush gorge with accessible viewpoint platforms.', 11),
  ('black-river-gorges-viewpoint', 'Black River Gorges Viewpoint', 'Viewpoint', 'South', -20.381, 57.407, 45, null::time, 'Spectacular panoramic vistas across deep valleys and native forests, offering some of Mauritius'' finest views toward the west coast on clear days.', 12),
  ('rochester-falls', 'Rochester Falls', 'Waterfall', 'South', -20.4992, 57.51, 60, null::time, 'Unique 10-meter waterfall surrounded by distinctive basalt column formations and lush jungle, creating a cinematic landscape near Souillac.', 13),
  ('ebony-forest-reserve', 'Ebony Forest Reserve', 'Nature', 'South', -20.413, 57.396, 150, '17:00'::time, 'Restored endemic forest sanctuary hosting pink pigeons, Mauritius kestrels, and echo parakeets, with guided walks and panoramic forest viewpoints.', 14),
  ('maconde-viewpoint', 'Macondé Viewpoint', 'Viewpoint', 'South', -20.491, 57.371, 30, null::time, 'Clifftop vantage point with dramatic ocean vistas of the Indian Ocean and coastal coves, though strong winds demand careful footing.', 15),
  ('la-vanille-nature-park', 'La Vanille Nature Park', 'Nature', 'South', -20.4985, 57.5626, 180, '17:00'::time, 'Tropical forest reserve home to Nile crocodiles, giant tortoises, lemurs, and exotic wildlife, with guided tours through 3.5 hectares of biodiversity.', 16),
  ('ile-aux-aigrettes', 'Île aux Aigrettes', 'Island', 'South', -20.4172, 57.7267, 120, '16:00'::time, 'Protected coral island reserve off Mahebourg featuring Telfair''s skinks, colorful day geckos, and giant Aldabran tortoises, accessible by guided boat tour.', 17),
  ('belle-mare-beach', 'Belle Mare Beach', 'Beach', 'East', -20.183, 57.774, 120, null::time, 'One of Mauritius''s longest and most tranquil beaches stretching over six kilometers with soft white sand and calm turquoise waters.', 18),
  ('ile-aux-cerfs', 'Île aux Cerfs', 'Island', 'East', -20.272, 57.804, 240, null::time, 'A private island off Trou d''Eau Douce featuring pristine beaches, lagoons, water sports, adventure park, and an 18-hole golf course.', 19),
  ('grand-river-south-east-waterfall', 'Grand River South East Waterfall', 'Waterfall', 'East', -20.28, 57.775, 180, null::time, 'A scenic waterfall where Mauritius''s longest river cascades into the ocean, accessible by a dramatic boat journey through mangrove-lined waters.', 20),
  ('pointe-desny-beach', 'Pointe d''Esny Beach', 'Beach', 'East', -20.427, 57.728, 90, null::time, 'A serene, often-empty white-sand beach on the southeast coast with shallow lagoon waters, ideal for morning walks as the tide recedes.', 21),
  ('bras-deau-national-park', 'Bras d''Eau National Park', 'Nature', 'East', -20.137, 57.733, 180, '16:30'::time, 'A northeast coastal national park with mangrove forests, hiking trails, bird-watching opportunities, and scenic viewpoints overlooking the Indian Ocean.', 22),
  ('trou-deau-douce', 'Trou d''Eau Douce', 'Landmark', 'East', -20.235, 57.794, 120, null::time, 'A charming authentic fishing village and departure point for island excursions, offering traditional Mauritian character with direct boat access to Île aux Cerfs.', 23),
  ('central-flacq-market', 'Central Flacq Market', 'Market', 'East', -20.189, 57.726, 90, '17:00'::time, 'Mauritius''s largest vibrant open-air market bustling with local vendors selling fresh produce, seafood, textiles, and authentic street food, best visited Wednesdays and Sundays.', 24),
  ('la-vallee-de-ferney', 'La Vallée de Ferney', 'Nature', 'East', -20.361, 57.697, 180, '17:00'::time, 'A wildlife reserve and nature sanctuary in the southeast featuring hiking trails, 4x4 tours, bird-watching, and waterfall pools for swimming.', 25),
  ('flic-en-flac-beach', 'Flic-en-Flac Beach', 'Beach', 'West', -20.2667, 57.3667, 180, null::time, 'One of Mauritius''s longest and most beloved beaches, this 8km stretch of golden sand fringed with filaos trees offers excellent swimming, snorkeling, and water sports in crystal-clear turquoise waters.', 26),
  ('le-morne-beach', 'Le Morne Beach', 'Beach', 'West', -20.4517, 57.3133, 180, null::time, 'A stunning beach backed by the iconic UNESCO-listed Le Morne mountain, this picturesque spot is perfect for swimming, snorkeling, windsurfing, and kite-surfing with pristine lagoon views.', 27),
  ('casela-nature-parks', 'Casela Nature & Leisure Park', 'Nature', 'West', -20.2908, 57.4043, 360, '17:00'::time, 'A sprawling 350-hectare wildlife park featuring African savannah animals with thrilling activities including safari drives, zip-lining, lion walking, and camel rides.', 28),
  ('black-river-gorges-national-park', 'Black River Gorges National Park', 'Nature', 'West', -20.4167, 57.4167, 300, null::time, 'Mauritius''s largest national park with over 50km of well-marked hiking trails, waterfalls, lookout points, and preserved forest featuring rare endemic bird species and indigenous plants.', 29),
  ('albion-lighthouse', 'Albion Lighthouse', 'Landmark', 'West', -20.35, 57.5, 60, null::time, 'A striking red-and-white heritage lighthouse built in 1910 standing 46 meters above Pointe-aux-Caves cliffs, offering spectacular views of the west coast and a small museum.', 30),
  ('ile-aux-benitiers', 'Île aux Bénitiers', 'Island', 'West', -20.4161, 57.3372, 240, null::time, 'An uninhabited islet accessible by boat tour from Black River, perfect for snorkeling at nearby Crystal Rock and experiencing pristine lagoon scenery.', 31),
  ('la-route-du-sel', 'La Route du Sel (Tamarin Salt Flats)', 'Culture', 'West', -20.3256, 57.3706, 45, '16:00'::time, 'An 18th-century salt flats heritage site spanning 20 hectares with over 1,600 basins showing traditional sea salt production, offering guided 15-minute tours of the last working salt farm in Mauritius.', 32),
  ('trou-aux-cerfs', 'Trou aux Cerfs', 'Viewpoint', 'Central', -20.3179, 57.5115, 30, null::time, 'A dramatic 100-meter-deep volcanic crater surrounded by lush forest offering panoramic views of the central plateau.', 33),
  ('eureka-house', 'Eureka House', 'Culture', 'Central', -20.2195, 57.5023, 75, '17:00'::time, 'A beautifully preserved 1830s colonial mansion museum with period furnishings, gardens, and nearby Eureka Waterfalls.', 34),
  ('curepipe-botanic-garden', 'Curepipe Botanic Garden', 'Garden', 'Central', -20.3291, 57.5244, 60, '18:00'::time, 'A sprawling 27-acre botanical garden featuring rare palms, a scenic lake, and the world''s rarest palm tree.', 35),
  ('tamarind-falls', 'Tamarind Falls', 'Waterfall', 'Central', -20.3444, 57.4664, 180, null::time, 'A spectacular series of seven cascading waterfalls set in lush mountain scenery requiring a scenic hiking adventure.', 36),
  ('le-pouce-mountain', 'Le Pouce Mountain', 'Viewpoint', 'Central', -20.2167, 57.4833, 180, null::time, 'The third-highest peak in Mauritius offering panoramic views of Port Louis and surrounding plateau countryside.', 37),
  ('pieter-both-mountain', 'Pieter Both Mountain', 'Viewpoint', 'Central', -20.25, 57.52, 240, null::time, 'Mauritius'' second-highest peak featuring a distinctive balanced rock formation at the summit and challenging scramble.', 38)
) as v(id, name, category, region, lat, lng, duration_min, closes_at, blurb, position)
where not exists (select 1 from planner_places);

create or replace function api_planner_places(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'category', category, 'region', region,
    'lat', lat, 'lng', lng, 'durationMin', duration_min,
    'closesAt', to_char(closes_at, 'HH24:MI'), 'blurb', blurb, 'imageUrl', image_url
  ) order by position, name), '[]'::jsonb)
  from planner_places;
$$;
grant execute on function api_planner_places(jsonb) to anon, authenticated, service_role;


-- ============ Custom Road Trip bookable activity — folded for live-DB sync ============

-- The single bookable "Custom Road Trip" activity the AI Road Trip Planner books against. It reuses
-- the existing vehicle booking flow (hold -> api_book), priced by planner_pricing via the
-- create_booking 'vehicle_custom' branch. Hidden from the public catalogue (is_custom_planner) and
-- made bookable every day via daily_capacity (materialize_availability fills the day-slots).
--
-- Note: materialize_availability only fills slots for an option that HAS an activity_option_prices
-- row, so the single option carries ONE placeholder price row (label 'Per vehicle'). The vehicle_custom
-- pricing branch never reads it — the real price comes from planner_pricing.

-- Ensure the operator exists (seed.sql also creates it; this lets the migration stand alone, since
-- migrations run before seed.sql on a fresh setup).
insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')
  on conflict (slug) do nothing;

insert into activities (
  operator_id, slug, type, title, summary, category, duration_minutes, pickup_available,
  pricing_mode, is_custom_planner, status, daily_capacity
)
select o.id, 'custom-road-trip', 'activity', 'Custom Road Trip',
  'Design your own day across Mauritius with the AI planner — one flat price per vehicle.',
  'Sightseeing tours', 480, true, 'vehicle_custom', true, 'published', 10
from operators o
where o.slug = 'belle-mare-tours'
on conflict (slug) do nothing;

insert into activity_options (activity_id, name)
select a.id, 'Private vehicle'
from activities a
where a.slug = 'custom-road-trip'
  and not exists (select 1 from activity_options o where o.activity_id = a.id);

insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests, position)
select o.id, 'Per vehicle', 9500, 22, 0
from activity_options o
join activities a on a.id = o.activity_id
where a.slug = 'custom-road-trip'
  and not exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id);

-- ---- migration 20260618030000_places_cache (durable shared Google Places cache) ----------
create table if not exists places_cache (
  key        text primary key,
  data       jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists places_cache_expires_idx on places_cache (expires_at);
alter table places_cache enable row level security;
revoke all on places_cache from anon, authenticated;
grant select, insert, update, delete on places_cache to service_role;

-- ── 2026-06-19 correctness-audit fixes (migration 20260719120000): tomorrow-earliest booking,
-- F23 authenticated-replay guard, release_hold revoke. Mirrors the migration body for live sync. ──
-- 1a. create_hold: keep the past-slot guard (occurrence_in_past), add a tomorrow-earliest guard.
create or replace function create_hold(
  p_occurrence_id uuid,
  p_quantity int,
  p_idempotency_key text
)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing booking_holds;
  v_occ session_occurrences;
  v_available int;
  v_hold booking_holds;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity' using detail = 'quantity must be > 0';
  end if;

  select * into v_existing from booking_holds where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_occ from session_occurrences where id = p_occurrence_id for update;
  if not found then
    raise exception 'occurrence_not_found';
  end if;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  if v_occ.starts_at <= now() then
    raise exception 'occurrence_in_past';
  end if;
  -- We don't fulfil same-day bookings: the earliest bookable day is tomorrow (Mauritius local time).
  if v_occ.starts_at < (((now() at time zone 'Indian/Mauritius')::date + 1)::timestamp at time zone 'Indian/Mauritius') then
    raise exception 'occurrence_too_soon';
  end if;

  v_available := v_occ.capacity - used_capacity(p_occurrence_id);
  if p_quantity > v_available then
    raise exception 'insufficient_capacity'
      using detail = format('requested %s, available %s', p_quantity, v_available);
  end if;

  insert into booking_holds (session_occurrence_id, quantity, idempotency_key)
  values (p_occurrence_id, p_quantity, p_idempotency_key)
  returning * into v_hold;
  return v_hold;
end;
$$;

-- 1b. api_list_availability: clamp the lower bound to TOMORROW (Mauritius) so today is never advertised
--     (winning body from 20260718120000, only `v_today` -> `v_today + 1` on the lower clamp).
create or replace function api_list_availability(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_activity activities;
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
  v_from date := coalesce((p ->> 'from')::date, v_today);
  v_to date := coalesce((p ->> 'to')::date, v_today + 30);
  v_result jsonb;
begin
  select * into v_activity from activities where slug = p ->> 'slug';
  if not found or v_activity.status <> 'published' then
    return '[]'::jsonb;
  end if;

  v_from := greatest(v_from, v_today + 1); -- earliest bookable day is tomorrow (no same-day)
  v_to := least(v_to, v_today + 400);

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
    and so.starts_at >= (v_from::timestamp at time zone 'Indian/Mauritius')
    and so.starts_at < ((v_to + 1)::timestamp at time zone 'Indian/Mauritius');

  return v_result;
end;
$$;

-- 2. api_book F23 guard: the email-knowledge check must apply to ANY caller replaying an UNOWNED guest
--    booking, not only anonymous callers (winning body from 20260618010000; only the guard precondition
--    `auth.uid() is null` -> `v_booking.user_id is null` changes).
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom') then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 3. release_hold has no ownership check (booking_holds carries no user_id) and no app route calls it;
--    a leaked hold id would let any logged-in user cancel a reservation. Owner / service_role only.
--    Revoke the implicit PUBLIC grant too (a create-function default the original migration never
--    dropped, which authenticated inherits) — revoking the explicit grant alone would do nothing.
revoke execute on function release_hold(uuid) from public, authenticated;

-- ── 2026-06-20 Cart & Hold Lifecycle Task 4 (migration 20260720120000): owner-scoped hold release ──
-- booking_holds gains a created_by owner column; create_hold stamps it; an owner SELECT RLS policy
-- is added; api_release_hold replaces the ownerless release_hold for the authenticated role.
-- create_hold is re-applied from its winning body VERBATIM except the INSERT now sets created_by.
alter table booking_holds add column if not exists created_by uuid;

create or replace function create_hold(
  p_occurrence_id uuid,
  p_quantity int,
  p_idempotency_key text
)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing booking_holds;
  v_occ session_occurrences;
  v_available int;
  v_hold booking_holds;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity' using detail = 'quantity must be > 0';
  end if;

  select * into v_existing from booking_holds where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_occ from session_occurrences where id = p_occurrence_id for update;
  if not found then
    raise exception 'occurrence_not_found';
  end if;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  if v_occ.starts_at <= now() then
    raise exception 'occurrence_in_past';
  end if;
  -- We don't fulfil same-day bookings: the earliest bookable day is tomorrow (Mauritius local time).
  if v_occ.starts_at < (((now() at time zone 'Indian/Mauritius')::date + 1)::timestamp at time zone 'Indian/Mauritius') then
    raise exception 'occurrence_too_soon';
  end if;

  v_available := v_occ.capacity - used_capacity(p_occurrence_id);
  if p_quantity > v_available then
    raise exception 'insufficient_capacity'
      using detail = format('requested %s, available %s', p_quantity, v_available);
  end if;

  insert into booking_holds (session_occurrence_id, quantity, idempotency_key, created_by)
  values (p_occurrence_id, p_quantity, p_idempotency_key, auth.uid())
  returning * into v_hold;
  return v_hold;
end;
$$;

-- RLS is already enabled on booking_holds and the staff-all policy stays; add owner read access.
drop policy if exists holds_owner_select on booking_holds;
create policy holds_owner_select on booking_holds for select
  using (created_by is not null and created_by = auth.uid());

create or replace function api_release_hold(p_hold_id uuid)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold booking_holds;
begin
  select * into v_hold from booking_holds where id = p_hold_id;
  if not found then
    raise exception 'hold_not_found';
  end if;

  if not (is_staff() or (auth.uid() is not null and v_hold.created_by = auth.uid())) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: only an active hold is flipped; an already-released hold is a no-op.
  update booking_holds set status = 'released'
  where id = p_hold_id and status = 'active'
  returning * into v_hold;
  if not found then
    select * into v_hold from booking_holds where id = p_hold_id;
  end if;

  return v_hold;
end;
$$;

revoke execute on function api_release_hold(uuid) from public;
grant execute on function api_release_hold(uuid) to authenticated, service_role;

-- ===== Region-based transport add-on (mirrors 20260720000000_activity_transport_pricing.sql) =====
-- Region-based transport add-on for per_person / per_group activities.
--
-- Activities like "Swimming with Dolphins" board in a fixed part of the island (the West). The real
-- cost to Belle Mare Tours is the ROUND-TRIP drive from the customer's hotel to that boarding point —
-- same region = short drive = cheap; North/East/South = farther = more. This adds an OPTIONAL transport
-- line that scales with that distance:
--   fare = transport_band_pricing[ band(pickupRegion, activityRegion) ][ vehicle(pax, suv) ]
-- where band is Same (same region) / Near / Far. One global config; each activity just needs its home
-- region (or lat/lng, from which the region is derived).
--
-- EXCLUDED: 'vehicle' (Private Sightseeing) and 'vehicle_custom' (Custom planner) — those already price
-- the whole drive. The add-on applies ONLY to per_person / per_group activities with pickup_available.
--
-- Server is authoritative: api_book RE-DERIVES the pickup region from coordinates and looks up the fare;
-- it never trusts a client-sent price. The TS transportFare() in src/lib/services/pricing.ts mirrors the
-- functions below cent-for-cent (covered by the pricing parity unit tests). Mirror this whole file into
-- supabase/catch-up.sql per the DB-sync convention.

-- 1) activities: home/boarding region + coords. region resolves as coalesce(region, region_from_coords(lat,lng)).
alter table activities add column if not exists region text;
alter table activities add column if not exists lat double precision;
alter table activities add column if not exists lng double precision;

-- 2) bookings: record the transport add-on + the pickup geo (for receipts and the operator's run sheet).
alter table bookings add column if not exists transport_minor bigint not null default 0;
alter table bookings add column if not exists pickup_region text;
alter table bookings add column if not exists pickup_lat double precision;
alter table bookings add column if not exists pickup_lng double precision;

-- 3) region_from_coords(): SQL port of regionFromCoords() in src/lib/maps/google-places.ts — EXACTLY the
--    same thresholds, so the widget, the planner and the server all classify a point identically.
create or replace function region_from_coords(p_lat double precision, p_lng double precision)
returns text
language sql
immutable
as $$
  select case
    when p_lat is null or p_lng is null then null
    when p_lat >= -20.08 then 'North'
    when p_lat <= -20.42 then 'South'
    when p_lng >= 57.63 then 'East'
    when p_lng <= 57.43 then 'West'
    else 'Central'
  end;
$$;

-- 4) transport_band_pricing: ONE flat fare per (band × vehicle bracket). Public read (shown in the widget),
--    staff edit (admin pricing screen). Seeded with sensible defaults; the owner tunes them in /admin.
create table if not exists transport_band_pricing (
  band          text primary key check (band in ('same', 'near', 'far')),
  sedan_minor   int not null,   -- 1-4
  suv_minor     int not null,   -- 1-4 upgrade
  family_minor  int not null,   -- 5-6
  van_minor     int not null,   -- 7-14
  coaster_minor int not null,   -- 15-25 (×N coasters above 25)
  updated_at    timestamptz not null default now()
);
insert into transport_band_pricing (band, sedan_minor, suv_minor, family_minor, van_minor, coaster_minor) values
  ('same', 1500, 2000, 2500, 4000, 7000),    -- €15 / €20 / €25 / €40 / €70
  ('near', 3000, 3800, 4500, 7000, 12000),   -- €30 / €38 / €45 / €70 / €120
  ('far',  5000, 6000, 7000, 11000, 18000)   -- €50 / €60 / €70 / €110 / €180
on conflict (band) do nothing;
alter table transport_band_pricing enable row level security;
grant select on transport_band_pricing to anon, authenticated, service_role;
grant update on transport_band_pricing to authenticated;
drop policy if exists transport_band_pricing_read on transport_band_pricing;
create policy transport_band_pricing_read on transport_band_pricing for select using (true);
drop policy if exists transport_band_pricing_staff on transport_band_pricing;
create policy transport_band_pricing_staff on transport_band_pricing for all using (is_staff()) with check (is_staff());

-- 5) region_zone_distance: unordered region pair -> 'near' | 'far' (same-region is handled in code as 'same').
--    Stored canonically (region_a <= region_b). All 10 cross-pairs seeded from Mauritius geography.
create table if not exists region_zone_distance (
  region_a text not null,
  region_b text not null,
  band     text not null check (band in ('near', 'far')),
  primary key (region_a, region_b),
  check (region_a < region_b)
);
insert into region_zone_distance (region_a, region_b, band) values
  ('Central', 'East',  'near'),
  ('Central', 'North', 'near'),
  ('Central', 'South', 'near'),
  ('Central', 'West',  'near'),
  ('East',    'North', 'near'),
  ('East',    'South', 'near'),
  ('East',    'West',  'far'),
  ('North',   'South', 'far'),
  ('North',   'West',  'near'),
  ('South',   'West',  'near')
on conflict (region_a, region_b) do nothing;
alter table region_zone_distance enable row level security;
grant select on region_zone_distance to anon, authenticated, service_role;
grant insert, update, delete on region_zone_distance to authenticated;
drop policy if exists region_zone_distance_read on region_zone_distance;
create policy region_zone_distance_read on region_zone_distance for select using (true);
drop policy if exists region_zone_distance_staff on region_zone_distance;
create policy region_zone_distance_staff on region_zone_distance for all using (is_staff()) with check (is_staff());

-- 6) region_distance_band(): 'same' when equal, else the seeded near/far for the unordered pair ('far' if
--    a pair is missing — fail safe to the higher fare). Mirrors regionDistanceBand() in pricing.ts.
create or replace function region_distance_band(p_a text, p_b text)
returns text
language sql
stable
as $$
  select case
    when p_a is null or p_b is null then 'far'
    when p_a = p_b then 'same'
    else coalesce((
      select band from region_zone_distance
      where region_a = least(p_a, p_b) and region_b = greatest(p_a, p_b)
    ), 'far')
  end;
$$;

-- 7) transport_fare_minor(): band lookup -> vehicle bracket by party size (Sedan ≤4, Family ≤6, Van ≤14,
--    Coaster ≤25, ×ceil(pax/25) coasters above 25). SUV is the ≤4 upgrade. Mirrors transportFare() in
--    pricing.ts cent-for-cent. Returns 0 when inputs are missing (no pickup -> no fee).
create or replace function transport_fare_minor(
  p_pickup_region text,
  p_activity_region text,
  p_pax int,
  p_suv boolean
)
returns bigint
language plpgsql
stable
as $$
declare
  v_band text;
  v_row transport_band_pricing;
begin
  if p_pickup_region is null or p_activity_region is null or p_pax is null or p_pax < 1 then
    return 0;
  end if;
  v_band := region_distance_band(p_pickup_region, p_activity_region);
  select * into v_row from transport_band_pricing where band = v_band;
  if not found then
    return 0;
  end if;
  if p_pax <= 4 then
    return case when coalesce(p_suv, false) then v_row.suv_minor else v_row.sedan_minor end;
  elsif p_pax <= 6 then
    return v_row.family_minor;
  elsif p_pax <= 14 then
    return v_row.van_minor;
  elsif p_pax <= 25 then
    return v_row.coaster_minor;
  else
    return v_row.coaster_minor * ceil(p_pax::numeric / 25)::int;
  end if;
end;
$$;
grant execute on function region_from_coords(double precision, double precision) to anon, authenticated, service_role;
grant execute on function region_distance_band(text, text) to anon, authenticated, service_role;
grant execute on function transport_fare_minor(text, text, int, boolean) to anon, authenticated, service_role;

-- 8) api_book: re-applied from its WINNING body (20260719120000_audit_fixes) VERBATIM, with two additions:
--    (a) the activity's home region + pickup_available are read alongside pricing_mode;
--    (b) a transport surcharge block after the child-seats block (same after-create pattern).
--    Carrying the full body (not a partial create-or-replace) keeps the F23 guard + every other branch —
--    avoids the migration-revert-drift class. create_booking / api_create_hold are unchanged (their
--    winning bodies in 20260617210000 still apply), so they are intentionally NOT redefined here.
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false)
    into v_mode, v_activity_region, v_pickup_available
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom') then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 9) booking_json: expose the transport add-on (transportMinor + pickupRegion) alongside childSeats, so the
--    order summary / confirmation / receipt can itemise it. Re-applied from the winning child_seats body.
create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'pickupRegion', b.pickup_region,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- 10) api_get_activity: expose the activity's home region + coords and (for per_person / per_group tours
--     that offer pickup) the global transport fare tables, so the booking widget can show a live, exact
--     transport quote. Re-applied from the winning flat_vehicle_pricing body with those keys added.
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

-- ===========================================================================
-- 20260721000000_booking_dropoff: distinct dropoff_location + pickup_pending.
-- Drop-off is its OWN field (never merged into pickup_location); pickup_pending = "pickup to be
-- arranged" (TBD), distinct from no pickup. api_book + booking_json re-applied from their winning
-- 20260720000000 bodies VERBATIM, with those two fields added. Mirror of the migration.
-- ===========================================================================
alter table bookings add column if not exists dropoff_location text;
alter table bookings add column if not exists pickup_pending boolean not null default false;

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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false)
    into v_mode, v_activity_region, v_pickup_available
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom') then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'pickupPending', b.pickup_pending,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'pickupRegion', b.pickup_region,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- ===========================================================================
-- 20260722120000_generic_rate_limit: a generic per-IP limiter the public AI/planner routes share.
-- The four unauthenticated AI/planner endpoints each fan out to BILLED Gemini + Google Places/Routes
-- with no throttle (wallet-DoS). The only prior limiter was inline in api_capture_lead, coupled to the
-- leads table, so it couldn't be reused. This factors a generic fixed-window counter. Mirror of the
-- migration; additive (new table + function) so it can't drift a migrated DB.
-- ===========================================================================
create table if not exists rate_limits (
  bucket       text not null,
  ip           text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (bucket, ip, window_start)
);
create index if not exists rate_limits_window_idx on rate_limits (window_start);

alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;

create or replace function api_rate_limit(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text := nullif(p ->> 'bucket', '');
  v_ip text := nullif(p ->> 'ip', '');
  v_limit int := greatest(coalesce((p ->> 'limit')::int, 0), 1);
  v_window int := greatest(coalesce((p ->> 'windowSeconds')::int, 60), 1);
  v_start timestamptz;
  v_hits int;
begin
  if v_bucket is null then
    raise exception 'invalid_request' using detail = 'rate_limit: bucket required';
  end if;
  if v_ip is null then
    return jsonb_build_object('ok', true, 'remaining', v_limit);
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);

  insert into rate_limits (bucket, ip, window_start, hits)
  values (v_bucket, v_ip, v_start, 1)
  on conflict (bucket, ip, window_start)
  do update set hits = rate_limits.hits + 1
  returning hits into v_hits;

  if v_hits > v_limit then
    raise exception 'rate_limited' using detail = format('bucket %s ip %s', v_bucket, v_ip);
  end if;

  return jsonb_build_object('ok', true, 'remaining', greatest(v_limit - v_hits, 0));
end;
$$;

grant execute on function api_rate_limit(jsonb) to anon, authenticated, service_role;

-- ===========================================================================
-- 20260723000000_payment_charge: persist what the card was actually charged.
-- The booking ledger is EUR but the Mauritius acquirer settles in USD; createPaymentLink converts
-- the EUR total to whole-dollar USD at charge time and never recorded it, so a receipt/invoice could
-- only show the EUR figure. Record the real charge (best-effort) on the payment row. Additive (two
-- nullable columns + a new SECURITY DEFINER writer) so it can't drift a migrated DB.
-- ===========================================================================
alter table payments add column if not exists charged_amount_minor integer;
alter table payments add column if not exists charged_currency text;

-- Superseded by 20260725000000_payment_charge_guard: IDOR guard (SECURITY DEFINER bypassed payments RLS,
-- so any signed-in user with a payment UUID could falsify the recorded charge on another customer's
-- invoice) + record-once (FX-drift: a re-pay at a moved rate must not overwrite the first charge).
create or replace function api_record_payment_charge(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
  v_minor int := (p ->> 'chargedAmountMinor')::int;
  v_currency text := nullif(p ->> 'chargedCurrency', '');
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_charge: paymentId required';
  end if;

  -- IDOR guard: SECURITY DEFINER bypasses payments RLS, so authorize here. Only staff or the booking's
  -- owner may record a charge. auth.uid() must be non-null, else `null = null` is NULL (not false).
  if not (is_staff() or exists (
    select 1 from payments pay
    join bookings b on b.id = pay.booking_id
    where pay.id = v_payment_id and auth.uid() is not null and b.user_id = auth.uid()
  )) then
    raise exception 'forbidden';
  end if;

  -- Record the charge ONCE (FX-drift fix): a later re-pay at a different rate must not overwrite it.
  update payments
  set charged_amount_minor = v_minor,
      charged_currency = v_currency
  where id = v_payment_id and charged_amount_minor is null;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function api_record_payment_charge(jsonb) to authenticated, service_role;

-- ===========================================================================
-- 20260724000000_booking_receipt: feed the notification drain the invoice/receipt data in one read.
-- claim_notifications also returns bookingId so the drain can load the booking by id; api_booking_receipt
-- (SECURITY DEFINER, service_role only) returns booking_json + the joined activityTitle/when + the
-- payment block (real charge or EUR fallback, paid timestamp, provider ref). claim_notifications is a
-- create-or-replace of the lease version (body must match the migration for parity); the RPC is additive.
-- ===========================================================================
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

  -- The booking's most recent payment, with the real charge (or the EUR ledger fallback), the paid
  -- timestamp (first 'paid' event) and the provider event ref.
  select jsonb_build_object(
           'chargedAmountMinor', coalesce(pay.charged_amount_minor, pay.amount_minor),
           'chargedCurrency', coalesce(pay.charged_currency, pay.currency),
           'paidAt', paid.occurred_at,
           'providerRef', paid.provider_event_id
         )
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
   order by pay.created_at desc
   limit 1;

  return v_base
    || jsonb_build_object('activityTitle', v_title, 'when', v_when)
    || jsonb_build_object('payment', coalesce(v_payment, 'null'::jsonb));
end;
$$;

revoke execute on function api_booking_receipt(jsonb) from public;
grant execute on function api_booking_receipt(jsonb) to service_role;

-- ===========================================================================
-- 20260726000000_mark_refunded: staff "Mark refunded" records a manual (Peach-dashboard) refund.
-- An admin cancel of a paid booking lands it in refund_pending but nothing ever moves it to refunded
-- (only a `refunded` provider event does, which a manual refund never produces). This RPC records the
-- refund through the SAME append_payment_event path the webhook uses (idempotent via a synthesised
-- provider_event_id), so refunded_minor is set, the booking transitions to refunded, and the
-- booking_refunded customer email fires via the existing enqueue trigger.
-- ===========================================================================
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

  -- Most recent payment for this booking (the one the customer was charged on).
  select * into v_payment from payments
   where booking_id = v_booking_id
   order by created_at desc
   limit 1;
  if not found then
    raise exception 'payment_not_found';
  end if;

  -- Already fully refunded → no-op (idempotent: a repeat click must not error or re-enqueue).
  if v_payment.status = 'refunded' then
    return jsonb_build_object('ok', true, 'alreadyRefunded', true);
  end if;

  -- Only a booking whose money is actually held may be refunded: the cancel path lands it in
  -- refund_pending (payment_state stays paid), or staff refund a confirmed/completed paid booking
  -- directly. Anything else (unpaid, draft, already cancelled with no money) is rejected.
  if not (
    v_booking.status in ('refund_pending', 'confirmed', 'completed')
    and v_payment.status in ('paid', 'partially_refunded')
  ) then
    raise exception 'not_refundable'
      using detail = format('booking %s / payment %s', v_booking.status, v_payment.status);
  end if;

  -- Reverse the full outstanding (paid − already-refunded) amount. append_payment_event derives the
  -- refunded state from the SUM of refund events, so this carries the booking to refunded in one step.
  v_amount := greatest(v_payment.paid_minor - v_payment.refunded_minor, 0);

  -- Record through the SAME path the webhook uses. The synthesised provider_event_id makes it idempotent
  -- at the ledger: a second call with the same id hits the (payment_id, provider_event_id) conflict and is
  -- a no-op, so the booking_refunded enqueue (which also guards old.status is distinct from 'refunded')
  -- never double-fires. This sets refunded_minor, transitions payment + booking to refunded, releases holds.
  perform append_payment_event(
    v_payment.id,
    'refunded',
    'manual:refund:' || v_booking_id::text,
    v_amount,
    now(),
    jsonb_build_object('source', 'admin_mark_refunded', 'bookingId', v_booking_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_mark_refunded(jsonb) from public;
grant execute on function api_mark_refunded(jsonb) to authenticated, service_role;

-- ===========================================================================
-- 20260727000000_gdpr_erase.sql
-- GDPR right-to-erasure engine: api_erase_user(p jsonb)
--
-- Implements anonymize-WITH-RETENTION. Two classes of data:
--   * NO retention obligation (unpaid/abandoned bookings + their items/holds, leads, chat, the profile)
--     → HARD-DELETE. Nothing financial or legally required is lost.
--   * MUST be retained for tax/audit (PAID + terminal bookings: confirmed / completed / refund_pending /
--     refunded) → KEEP THE ROW, strip the PII. Hard-deleting one of these would destroy a financial
--     record; leaving PII on it would defeat the erasure. So name → '(Deleted user)', email → the
--     non-routable sentinel 'deleted@privacy.invalid' (customer_name/customer_email are NOT NULL in the
--     real schema, so they cannot be nulled — they are redacted to placeholders instead), phone/notes
--     nulled, while total_minor / status / the whole money trail stay intact.
--
-- The split is anchored on payment_state, NOT just status: a booking is only deletable when it is in a
-- non-paid status AND payment_state = 'pending' (never carried money). Everything that ever touched money
-- is anonymized, never deleted.
--
-- Scope: rows owned by the user (user_id = v_uid) OR matching the guest email (lower(customer_email) =
-- v_email). That sweeps a logged-in user's pre-account guest bookings, and lets staff erase a pure-guest
-- booking (user_id null) by email alone.
--
-- Guard: staff, OR the signed-in user erasing THEMSELVES (auth.uid() = v_uid). SECURITY DEFINER so the
-- deletes/updates run under owner rights regardless of per-table RLS. Idempotent: re-running finds the
-- rows already deleted/anonymized and is a clean no-op. One audit row, counts only — no PII.
--
-- reviews are NOT touched: the table has only (activity_id, author text) with no user_id or booking
-- linkage (reviews are scraped/seeded, not authored by account-holders), so there is no reliable way to
-- target "this user's reviews". Deliberately skipped.
-- ===========================================================================
create or replace function api_erase_user(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := nullif(p ->> 'userId', '')::uuid;
  v_email text := lower(nullif(btrim(p ->> 'email'), ''));
  -- Non-paid booking statuses that are safe to hard-delete (only ever combined with payment_state pending).
  v_del_states text[] := array['draft', 'held', 'payment_pending', 'expired', 'cancelled', 'failed'];
  -- Paid / terminal statuses that must be retained (financial records) and only anonymized.
  v_anon_states text[] := array['confirmed', 'completed', 'refund_pending', 'refunded'];
  v_del_ids uuid[];
  v_del_bookings int := 0;
  v_anon_bookings int := 0;
  v_del_leads int := 0;
begin
  -- Guard: staff, or the signed-in user erasing their own account.
  if not (is_staff() or (auth.uid() is not null and v_uid is not null and auth.uid() = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Bind the email scope to the CALLER'S identity for a non-staff self-erase. The caller-supplied email
  -- is untrusted: a signed-in user could pass a stranger's address and, because the row scope matches on
  -- lower(customer_email) = v_email, sweep that stranger's GUEST bookings/leads (user_id null) — broken
  -- access control. So for non-staff we IGNORE the supplied email and force v_email to the caller's own
  -- JWT identity, read from auth.users (the SECURITY DEFINER owner can see it; auth.email() is not
  -- relied on here). This still catches the user's own pre-account guest bookings (made under their own
  -- email before they had an account), while making a stranger's email unreachable. Staff keep the
  -- supplied email — they legitimately erase a pure-guest record by its address.
  if not is_staff() then
    select lower(email) into v_email from auth.users where id = auth.uid();
  end if;

  if v_uid is null and v_email is null then
    raise exception 'invalid_request' using detail = 'erase_user: userId or email required';
  end if;

  -- ---- Hard-delete the non-retained (unpaid/abandoned) bookings + their children -------------------
  -- Identify them first; a booking matches by ownership OR guest email, must be in a deletable status
  -- AND have never carried money (payment_state pending). Anything paid is excluded here on purpose.
  select array_agg(id) into v_del_ids
    from bookings
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_del_states::booking_status[])
     and payment_state = 'pending';

  if v_del_ids is not null then
    -- FK order: holds (FK on delete set null, so delete explicitly) + items (cascades, but be explicit),
    -- then the parent bookings. payments cannot exist on a pending booking, so none to clear here.
    delete from booking_holds where booking_id = any(v_del_ids);
    delete from booking_items where booking_id = any(v_del_ids);
    delete from bookings where id = any(v_del_ids);
    get diagnostics v_del_bookings = row_count;
  end if;

  -- ---- Anonymize the retained (paid/terminal) bookings --------------------------------------------
  -- Keep the row + every financial column (total_minor, payouts, payment_state, status); strip the PII.
  -- customer_name + customer_email are NOT NULL in the schema, so they are redacted to placeholders
  -- (a routed-nowhere .invalid sentinel) rather than nulled. customer_phone + notes are nullable → null.
  -- This is an UPDATE that does NOT touch status, so the status-only enqueue trigger never re-fires.
  update bookings
     set customer_name = '(Deleted user)',
         customer_email = 'deleted@privacy.invalid',
         customer_phone = null,
         notes = null,
         traveller_gender = null,
         traveller_company = null,
         traveller_country = null,
         special_notes = null,
         room_or_cabin = null,
         luggage_details = null,
         child_seat_age = null,
         flight_number = null,
         arrival_time = null,
         return_date = null,
         return_time = null,
         departure_flight_number = null
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_anon_states::booking_status[])
     -- idempotent: skip rows already anonymized (so a second call updates 0 rows, never re-counts).
     and customer_name is distinct from '(Deleted user)';
  get diagnostics v_anon_bookings = row_count;

  -- ---- Redact the notification outbox -------------------------------------------------------------
  -- Strip recipient (the email) + the customerName key from any queued/sent message for this person,
  -- matched by the recipient address OR by linkage to one of their (still-existing, anonymized) bookings.
  -- recipient is NOT NULL in the schema, so it is redacted to the sentinel rather than nulled. Removing
  -- customerName from the payload (jsonb - key) is a no-op when the key is already absent → idempotent.
  update notification_outbox
     set recipient = 'deleted@privacy.invalid',
         payload = payload - 'customerName'
   where (v_email is not null and lower(recipient) = v_email)
      or booking_id in (
        select id from bookings
         where (v_uid is not null and user_id = v_uid)
            or (v_email is not null and lower(customer_email) = v_email)
      );

  -- ---- Redact audit_logs diffs that captured this person's PII ------------------------------------
  -- Older admin actions may have snapshotted customer fields into diff. Null the diff on rows whose
  -- entity is one of their bookings (the anonymized financial rows). Counts only; we keep the action row.
  update audit_logs
     set diff = null
   where diff is not null
     and entity_type = 'booking'
     and entity_id in (
       select id from bookings
        where (v_uid is not null and user_id = v_uid)
           or (v_email is not null and lower(customer_email) = v_email)
     );

  -- ---- Hard-delete the remaining personal data ----------------------------------------------------
  -- leads: PII lives in (name, contact); contact holds the email/phone. Delete by email match.
  if v_email is not null then
    delete from leads where lower(contact) = v_email;
    get diagnostics v_del_leads = row_count;
  end if;

  -- chat: messages cascade from sessions, but delete explicitly for clarity. By user only (no email link).
  if v_uid is not null then
    delete from chat_messages where session_id in (select id from chat_sessions where user_id = v_uid);
    delete from chat_sessions where user_id = v_uid;
    -- profile last (auth.users row itself is removed by the caller's service-role admin.deleteUser).
    delete from profiles where id = v_uid;
  end if;

  -- ---- One audit row, counts only (NO PII) -------------------------------------------------------
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    case when is_staff() then 'staff' else 'user' end,
    'erase_user',
    'user',
    v_uid,
    'gdpr erasure: deleted ' || v_del_bookings || ' booking(s), ' || v_del_leads
      || ' lead(s); anonymized ' || v_anon_bookings || ' retained booking(s)'
  );

  return jsonb_build_object(
    'ok', true,
    'deletedBookings', v_del_bookings,
    'anonymizedBookings', v_anon_bookings,
    'deletedLeads', v_del_leads
  );
end;
$$;

revoke execute on function api_erase_user(jsonb) from anon;
grant execute on function api_erase_user(jsonb) to authenticated, service_role;

-- ---- 20260622000000_profile_dob --------------------------------------------
-- Optional date of birth on customer profiles (account "Personal details" page).
-- RLS profiles_update already lets a user edit their own row; the GDPR erase
-- deletes the whole profiles row, so this column is wiped on erasure too.
alter table profiles add column if not exists date_of_birth date;

-- ---- 20260728000000_activity_min_advance ------------------------------------
-- Per-activity minimum advance booking (lead time). Generalises the hardcoded "earliest is tomorrow"
-- rule: default 1 = tomorrow; set higher in admin for planning-heavy trips. Enforced in create_hold
-- (the universal gate) + clamped in api_list_availability; exposed via api_get_activity. The three
-- functions are re-applied from their WINNING bodies VERBATIM except the lead-time change, and MUST
-- stay byte-identical to supabase/migrations/20260728000000_activity_min_advance.sql.
alter table activities add column if not exists min_advance_days int not null default 1;

create or replace function create_hold(
  p_occurrence_id uuid,
  p_quantity int,
  p_idempotency_key text
)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing booking_holds;
  v_occ session_occurrences;
  v_available int;
  v_hold booking_holds;
  v_lead int;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity' using detail = 'quantity must be > 0';
  end if;

  select * into v_existing from booking_holds where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_occ from session_occurrences where id = p_occurrence_id for update;
  if not found then
    raise exception 'occurrence_not_found';
  end if;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  if v_occ.starts_at <= now() then
    raise exception 'occurrence_in_past';
  end if;
  -- Per-activity minimum advance booking. Default 1 = no same-day (earliest is tomorrow, Mauritius
  -- local time); planning-heavy activities set a larger activities.min_advance_days in admin.
  select coalesce(a.min_advance_days, 1) into v_lead
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_occ.activity_option_id;
  if v_occ.starts_at < (((now() at time zone 'Indian/Mauritius')::date + coalesce(v_lead, 1))::timestamp at time zone 'Indian/Mauritius') then
    raise exception 'occurrence_too_soon';
  end if;

  v_available := v_occ.capacity - used_capacity(p_occurrence_id);
  if p_quantity > v_available then
    raise exception 'insufficient_capacity'
      using detail = format('requested %s, available %s', p_quantity, v_available);
  end if;

  insert into booking_holds (session_occurrence_id, quantity, idempotency_key, created_by)
  values (p_occurrence_id, p_quantity, p_idempotency_key, auth.uid())
  returning * into v_hold;
  return v_hold;
end;
$$;

create or replace function api_list_availability(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_activity activities;
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
  v_from date := coalesce((p ->> 'from')::date, v_today);
  v_to date := coalesce((p ->> 'to')::date, v_today + 30);
  v_result jsonb;
begin
  select * into v_activity from activities where slug = p ->> 'slug';
  if not found or v_activity.status <> 'published' then
    return '[]'::jsonb;
  end if;

  -- Earliest bookable day = today + the activity's min advance booking (default 1 = tomorrow).
  v_from := greatest(v_from, v_today + coalesce(v_activity.min_advance_days, 1));
  v_to := least(v_to, v_today + 400);

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
    and so.starts_at >= (v_from::timestamp at time zone 'Indian/Mauritius')
    and so.starts_at < ((v_to + 1)::timestamp at time zone 'Indian/Mauritius');

  return v_result;
end;
$$;

create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

-- ---- 20260729000001_summary_min_advance -------------------------------------
-- Surface min_advance_days on the activity summary so listing cards can show "Book N+ days ahead".
-- api_search_activities re-applied from its WINNING body VERBATIM except the added minAdvanceDays
-- field; MUST stay byte-identical to supabase/migrations/20260729000001_summary_min_advance.sql.
create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
  ),
  paged as (
    select * from filtered
    order by rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', case
          when x.pricing_mode = 'vehicle'
            then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
          else (
            select min(pr.amount_minor)::float / 100
            from activity_option_prices pr
            join activity_options o on o.id = pr.activity_option_id
            where o.activity_id = x.id
          )
        end,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from filtered),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- ---- 20260729000000_payment_checkout_id ------------------------------------
-- Persist the Peach checkout id for server-side reconciliation: a later sweep re-queries Peach for a
-- payment's status, which needs the checkout id on the payment row. Additive (one nullable column + a
-- new SECURITY DEFINER writer). Unlike the charge (record-once), the checkout id OVERWRITES: a re-pay
-- opens a fresh checkout the sweep must query, so the latest one wins.
alter table payments add column if not exists provider_checkout_id text;

create or replace function api_record_payment_checkout(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_checkout: paymentId required';
  end if;

  -- IDOR guard: SECURITY DEFINER bypasses payments RLS, so authorize here. Only staff or the booking's
  -- owner may record a charge. auth.uid() must be non-null, else `null = null` is NULL (not false).
  if not (is_staff() or exists (
    select 1 from payments pay
    join bookings b on b.id = pay.booking_id
    where pay.id = v_payment_id and auth.uid() is not null and b.user_id = auth.uid()
  )) then
    raise exception 'forbidden';
  end if;

  -- OVERWRITE (latest checkout wins): a re-pay opens a new checkout the sweep must query, so the most
  -- recent checkout id replaces any prior one — no record-once guard here.
  update payments
  set provider_checkout_id = left(btrim(p ->> 'checkoutId'), 128)
  where id = v_payment_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_record_payment_checkout(jsonb) from anon;
grant execute on function api_record_payment_checkout(jsonb) to authenticated, service_role;

-- Enumerate stuck `payment_pending` bookings the server-side reconciliation sweep should re-query.
-- Returns the LATEST payment (with a stored checkout id) of each booking still awaiting settlement,
-- bounded by a grace window (default 4h — older ones are expired by run_booking_maintenance) and a row
-- cap (default 100) to bound the per-run Peach API call volume. Excludes any payment that already has a
-- settled ('paid'/'refunded') ledger event, so a booking confirmed by the client sync is never re-swept.
--
-- Guard: SECURITY DEFINER (bypasses payments/bookings RLS to read across users), granted ONLY to
-- service_role — the maintenance cron's role. We deliberately do NOT use is_staff() here: as service_role
-- auth.uid() is null, so is_staff() is FALSE; the grant IS the authorization (mirrors run_booking_maintenance).
create or replace function api_pending_payment_checkouts(p jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('ref', t.ref, 'paymentId', t.payment_id, 'checkoutId', t.provider_checkout_id)
      order by t.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    -- latest payment per booking (a re-pay opens a fresh checkout the sweep must query), then the
    -- most-recent stuck bookings up to the batch cap. The two orderings need separate query levels:
    -- distinct-on requires its leading sort be (b.id, pay.created_at), so recency + limit wrap it.
    select c.ref, c.payment_id, c.provider_checkout_id, c.created_at
    from (
      select distinct on (b.id)
             b.id, b.ref, b.created_at, pay.id as payment_id, pay.provider_checkout_id
        from bookings b
        join payments pay on pay.booking_id = b.id
       where b.status = 'payment_pending'
         and b.payment_state = 'pending'
         and b.created_at > now() - make_interval(
               mins => least(greatest(coalesce((p ->> 'graceMinutes')::int, 240), 1), 10080)
             )
         and pay.provider_checkout_id is not null
         and not exists (
               select 1 from payment_events pe
                where pe.payment_id = pay.id and pe.type in ('paid', 'refunded')
             )
       order by b.id, pay.created_at desc
    ) c
    -- recency-ordered batch, capped (default 100, hard ceiling 1000) to bound Peach API calls per run
    order by c.created_at desc
    limit least(greatest(coalesce((p ->> 'limit')::int, 100), 1), 1000)
  ) t;
$$;

revoke execute on function api_pending_payment_checkouts(jsonb) from public;
grant execute on function api_pending_payment_checkouts(jsonb) to service_role;

-- ==================== 20260730000000_airport_transfers_bookable.sql ====================
-- 1) activities: flag the airport-transfer product.
alter table activities add column if not exists is_airport_transfer boolean not null default false;

-- 2) bookings: flight + trip details for the operator run sheet, confirmation and receipt.
alter table bookings add column if not exists trip_type text not null default 'one_way'
  check (trip_type in ('one_way', 'return'));
alter table bookings add column if not exists flight_number text;
alter table bookings add column if not exists arrival_time text;
alter table bookings add column if not exists return_date date;
alter table bookings add column if not exists return_time text;
alter table bookings add column if not exists departure_flight_number text;

-- 3) airport_transfer_fare: the ZONE × vehicle fare matrix is created further down (the
--    20260731000000_airport_transfer_zones section); the original region-keyed table+seed has been
--    superseded and removed from catch-up so a re-run never tries to seed a `region` column that the
--    zone table no longer has.

-- 4) airport_transfer_config: single-row config (the return-trip discount %). Mirrors planner_pricing.
create table if not exists airport_transfer_config (
  id                  boolean primary key default true check (id),
  return_discount_pct int not null default 10 check (return_discount_pct between 0 and 90),
  updated_at          timestamptz not null default now()
);
insert into airport_transfer_config (id) values (true) on conflict (id) do nothing;
alter table airport_transfer_config enable row level security;
grant select on airport_transfer_config to anon, authenticated, service_role;
grant update on airport_transfer_config to authenticated;
drop policy if exists airport_transfer_config_read on airport_transfer_config;
create policy airport_transfer_config_read on airport_transfer_config for select using (true);
drop policy if exists airport_transfer_config_staff on airport_transfer_config;
create policy airport_transfer_config_staff on airport_transfer_config for all using (is_staff()) with check (is_staff());

-- 5) airport_transfer_hotels: the server's source of truth for each hotel's destination region (keyed by
--    the SEO page slug). api_book looks the region up here so it never trusts a client-sent region. Seeded
--    from src/lib/content/_transfers.gen.ts; re-sync if the SEO content workflow adds hotels.
create table if not exists airport_transfer_hotels (
  slug       text primary key,
  hotel_name text not null,
  region     text not null check (region in ('North', 'South', 'East', 'West', 'Central'))
);
insert into airport_transfer_hotels (slug, hotel_name, region) values
  ('lux-belle-mare', 'LUX* Belle Mare', 'East'),
  ('constance-belle-mare-plage', 'Constance Belle Mare Plage', 'East'),
  ('long-beach-mauritius', 'Long Beach Mauritius', 'East'),
  ('shangri-la-le-touessrok', 'Shangri-La Le Touessrok', 'East'),
  ('ambre-mauritius', 'Ambre Mauritius', 'East'),
  ('paradis-beachcomber', 'Paradis Beachcomber', 'West'),
  ('dinarobin-beachcomber', 'Dinarobin Beachcomber', 'West'),
  ('lux-le-morne', 'LUX* Le Morne', 'West'),
  ('st-regis-mauritius', 'The St. Regis Mauritius Resort', 'West'),
  ('sugar-beach-mauritius', 'Sugar Beach Mauritius', 'West'),
  ('sofitel-so-mauritius', 'Sofitel So Mauritius', 'South'),
  ('heritage-le-telfair', 'Heritage Le Telfair', 'South'),
  ('trou-aux-biches-beachcomber', 'Trou aux Biches Beachcomber', 'North'),
  ('canonnier-beachcomber', 'Canonnier Beachcomber', 'North'),
  ('lux-grand-gaube', 'LUX* Grand Gaube', 'North'),
  ('ravenala-attitude', 'The Ravenala Attitude', 'North'),
  ('westin-turtle-bay', 'The Westin Turtle Bay Resort & Spa', 'North'),
  ('le-meridien-ile-maurice', 'Le Méridien Ile Maurice', 'North'),
  ('victoria-beachcomber', 'Victoria Beachcomber', 'North'),
  ('radisson-blu-azuri', 'Radisson Blu Azuri Resort & Spa', 'East'),
  ('royal-palm-beachcomber', 'Royal Palm Beachcomber Luxury', 'North'),
  ('mauricia-beachcomber', 'Mauricia Beachcomber Resort & Spa', 'North'),
  ('veranda-grand-baie', 'Veranda Grand Baie', 'North'),
  ('lagoon-attitude', 'Lagoon Attitude', 'North'),
  ('zilwa-attitude', 'Zilwa Attitude', 'North'),
  ('recif-attitude', 'Recif Attitude', 'North'),
  ('coin-de-mire-attitude', 'Coin de Mire Attitude', 'North'),
  ('veranda-pointe-aux-biches', 'Veranda Pointe aux Biches', 'North'),
  ('anahita-golf-spa', 'Anahita Golf & Spa Resort', 'East'),
  ('four-seasons-anahita', 'Four Seasons Resort Mauritius at Anahita', 'East'),
  ('one-only-le-saint-geran', 'One&Only Le Saint Géran', 'East'),
  ('the-residence-mauritius', 'The Residence Mauritius', 'East'),
  ('emeraude-beach-attitude', 'Émeraude Beach Attitude', 'East'),
  ('tropical-attitude', 'Tropical Attitude', 'East'),
  ('solana-beach', 'Solana Beach Mauritius', 'East'),
  ('preskil-island-resort', 'Preskil Island Resort', 'South'),
  ('shandrani-beachcomber', 'Shandrani Beachcomber Resort & Spa', 'South'),
  ('tamassa-bel-ombre', 'Tamassa Bel Ombre', 'South'),
  ('outrigger-mauritius', 'Outrigger Mauritius Beach Resort', 'South'),
  ('hilton-mauritius', 'Hilton Mauritius Resort & Spa', 'West'),
  ('la-pirogue', 'La Pirogue Mauritius', 'West'),
  ('sands-suites', 'Sands Suites Resort & Spa', 'West'),
  ('maradiva-villas', 'Maradiva Villas Resort & Spa', 'West'),
  ('pearle-beach', 'Pearle Beach Resort & Spa', 'West'),
  ('riu-le-morne', 'Riu Le Morne', 'West')
on conflict (slug) do update set hotel_name = excluded.hotel_name, region = excluded.region;
alter table airport_transfer_hotels enable row level security;
grant select on airport_transfer_hotels to anon, authenticated, service_role;
grant insert, update, delete on airport_transfer_hotels to authenticated;
drop policy if exists airport_transfer_hotels_read on airport_transfer_hotels;
create policy airport_transfer_hotels_read on airport_transfer_hotels for select using (true);
drop policy if exists airport_transfer_hotels_staff on airport_transfer_hotels;
create policy airport_transfer_hotels_staff on airport_transfer_hotels for all using (is_staff()) with check (is_staff());

-- ==================== 20260731000000_airport_transfer_zones.sql ====================
-- Re-key the airport fare matrix from destination REGION to a TWO-ZONE model (Zone 1 / Zone 2 × vehicle).
-- Zone 2 = the near-airport south-east cluster (only shandrani-beachcomber + preskil-island-resort of the
-- seeded hotels); Zone 1 = everywhere else. Zone 2 standard car = €35; all other cells owner-tunable.

-- airport_transfer_hotels: add the ZONE column + classify the near-airport cluster (region stays harmless).
alter table airport_transfer_hotels
  add column if not exists zone text not null default 'zone1' check (zone in ('zone1', 'zone2'));
update airport_transfer_hotels set zone = 'zone2'
  where slug in ('shandrani-beachcomber', 'preskil-island-resort');
update airport_transfer_hotels set zone = 'zone1'
  where slug not in ('shandrani-beachcomber', 'preskil-island-resort');

-- airport_transfer_fare: re-key region → zone. Drop + recreate keyed by zone (only owner config; no FK
-- references it). Zone 2 standard = €35 (confirmed); every other cell is an owner-tunable placeholder.
drop table if exists airport_transfer_fare;
create table airport_transfer_fare (
  zone          text primary key check (zone in ('zone1', 'zone2')),
  sedan_minor   int not null,   -- Standard car 1-4
  suv_minor     int not null,   -- 1-4 upgrade
  family_minor  int not null,   -- Family car 5-6
  van_minor     int not null,   -- Minibus 7-14
  coaster_minor int not null,   -- Coaster 15-25 (×N coasters above 25)
  updated_at    timestamptz not null default now()
);
insert into airport_transfer_fare (zone, sedan_minor, suv_minor, family_minor, van_minor, coaster_minor) values
  ('zone2', 3500, 4800, 5500,  8500, 14500),
  ('zone1', 5500, 7000, 8000, 12000, 20000)
on conflict (zone) do nothing;
alter table airport_transfer_fare enable row level security;
grant select on airport_transfer_fare to anon, authenticated, service_role;
grant update on airport_transfer_fare to authenticated;
drop policy if exists airport_transfer_fare_read on airport_transfer_fare;
create policy airport_transfer_fare_read on airport_transfer_fare for select using (true);
drop policy if exists airport_transfer_fare_staff on airport_transfer_fare;
create policy airport_transfer_fare_staff on airport_transfer_fare for all using (is_staff()) with check (is_staff());

-- 6) airport_transfer_fare_minor(): ZONE row -> vehicle bracket by party size (Sedan ≤4, Family ≤6,
--    Van ≤14, Coaster ≤25, ×ceil(pax/25) coasters above 25). SUV is the ≤4 upgrade. Mirrors
--    airportTransferFareMinor() in pricing.ts cent-for-cent. Returns 0 when inputs are missing. The
--    parameter is renamed region→zone, so drop the old function first (create-or-replace can't rename it).
drop function if exists airport_transfer_fare_minor(text, int, boolean);
create function airport_transfer_fare_minor(p_zone text, p_pax int, p_suv boolean)
returns bigint
language plpgsql
stable
as $$
declare
  v_row airport_transfer_fare;
begin
  if p_zone is null or p_pax is null or p_pax < 1 then
    return 0;
  end if;
  select * into v_row from airport_transfer_fare where zone = p_zone;
  if not found then
    return 0;
  end if;
  if p_pax <= 4 then
    return case when coalesce(p_suv, false) then v_row.suv_minor else v_row.sedan_minor end;
  elsif p_pax <= 6 then
    return v_row.family_minor;
  elsif p_pax <= 14 then
    return v_row.van_minor;
  elsif p_pax <= 25 then
    return v_row.coaster_minor;
  else
    return v_row.coaster_minor * ceil(p_pax::numeric / 25)::int;
  end if;
end;
$$;
grant execute on function airport_transfer_fare_minor(text, int, boolean) to anon, authenticated, service_role;

-- 7) api_book: re-applied from its WINNING body (20260721000000_booking_dropoff) VERBATIM, with the
--    airport-transfer additions: read is_airport_transfer with the activity row; after the pickup blocks,
--    look up the destination region from airport_transfer_hotels by dropoffSlug (zero-trust), recompute
--    the fare (× return discount), OVERRIDE the booking total + operator payout + the single line item,
--    and store the flight/trip fields. Carrying the full body keeps the F23 guard + every branch.
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
  v_is_airport boolean := false;
  v_dropoff_zone text;
  v_trip_type text;
  v_ret_pct int;
  v_fare bigint;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom') then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  -- Airport transfer (server-authoritative, zero-trust): the destination ZONE comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent zone. The whole fare is the zone × vehicle
  -- matrix (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    v_trip_type := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
    select zone into v_dropoff_zone from airport_transfer_hotels
      where slug = nullif(p ->> 'dropoffSlug', '');
    v_fare := airport_transfer_fare_minor(v_dropoff_zone, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40)
      where id = v_booking.id;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 8) booking_json: re-applied from its WINNING body (20260721000000_booking_dropoff) VERBATIM, plus the
--    flight/trip fields so the run sheet / confirmation / receipt can show them.
create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'pickupPending', b.pickup_pending,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'pickupRegion', b.pickup_region,
    'tripType', b.trip_type,
    'flightNumber', b.flight_number,
    'arrivalTime', b.arrival_time,
    'returnDate', b.return_date,
    'returnTime', b.return_time,
    'departureFlightNumber', b.departure_flight_number,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- 9) api_get_activity: re-applied from its WINNING body (20260728000000_activity_min_advance) VERBATIM,
--    plus isAirportTransfer + the airport fare matrix + return discount, so the hotel booking widget can
--    show a live, exact transfer quote.
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'returnDiscountPct', case when coalesce(a.is_airport_transfer, false)
      then (select return_discount_pct from airport_transfer_config limit 1) else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

-- 9b) Seed the airport-transfer PRODUCT itself (the row + its vehicle options/prices). It previously
--     lived only in seed.sql, so a prod DB that ran ONLY catch-up.sql never had it — and with no
--     activity there were no bookable slots. Insert it here (idempotent) so catch-up.sql is self-sufficient.
insert into activities
  (operator_id, slug, type, title, summary, description, category, location, duration_minutes,
   meeting_point, pickup_available, languages, inclusions, exclusions, highlights, status, pricing_mode)
select id, 'airport-transfer', 'transport', 'Airport Transfer',
   'Private meet-and-greet transfer between SSR International Airport and your accommodation, 24/7.',
   null, 'Airport transfers', 'Island-wide', 60, 'SSR International Airport (arrivals)', true,
   array['en','fr']::text[], array['Driver','Luggage assistance']::text[], '{}'::text[],
   array['Meet & greet','24/7','Door to door']::text[], 'published', 'vehicle'
from operators where slug = 'belle-mare-tours'
on conflict (slug) do nothing;

do $$
declare v_act uuid := (select id from activities where slug = 'airport-transfer'); v_opt uuid; r record;
begin
  if v_act is null then return; end if;
  for r in select * from (values
      ('Standard car (4 seats, 2 suitcases)', 3600, 4), ('SUV (4 seats, 4 suitcases)', 4000, 4),
      ('Family car (6 seats, 4 suitcases)', 4000, 6), ('Minibus (14 seats)', 9000, 14),
      ('Coaster (22 seats)', 13000, 22)) as t(name, amount_minor, max_guests)
  loop
    select id into v_opt from activity_options where activity_id = v_act and name = r.name limit 1;
    if v_opt is null then
      insert into activity_options (activity_id, name) values (v_act, r.name) returning id into v_opt;
    end if;
    if not exists (select 1 from activity_option_prices where activity_option_id = v_opt and label = 'Per transfer') then
      insert into activity_option_prices (activity_option_id, label, amount_minor, currency, max_guests)
      values (v_opt, 'Per transfer', r.amount_minor::int, 'EUR', r.max_guests::int);
    end if;
  end loop;
end $$;

-- 10) Configure the seeded airport-transfer activity as a bookable vehicle product (idempotent; runs LAST
--     so it wins over the 20260617190000 per_group correction). min_advance_days = 0 so same-day flights
--     book. Then directly materialize the open-ended day-slots (the materialize_availability function is
--     staff/service-role gated and would raise if called from a plain SQL session, so inline the insert).
--     NOTE: this does NOT touch status — the seed INSERT (9b) publishes it on FIRST creation, and on later
--     re-runs we must respect a deliberate Draft set in admin (forcing 'published' here re-published it
--     on every catch-up run, clobbering the owner's choice). A Draft just won't materialize slots, which
--     is exactly what "hidden / not bookable" should mean.
update activities
set is_airport_transfer = true,
    pricing_mode = 'vehicle',
    min_advance_days = 0,
    region = coalesce(region, 'South'),
    lat = coalesce(lat, -20.43),
    lng = coalesce(lng, 57.68),
    daily_capacity = coalesce(daily_capacity, 40)
where slug = 'airport-transfer';

insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
select o.id,
       a.operator_id,
       (d::date + time '12:00') at time zone 'Indian/Mauritius',
       ((d::date + time '12:00') at time zone 'Indian/Mauritius') + make_interval(mins => coalesce(a.duration_minutes, 240)),
       a.daily_capacity,
       'open'
from activities a
join activity_options o on o.activity_id = a.id
cross join generate_series(
  (now() at time zone 'Indian/Mauritius')::date,
  (now() at time zone 'Indian/Mauritius')::date + 185,
  interval '1 day'
) d
where a.slug = 'airport-transfer'
  and a.status = 'published'
  and coalesce(a.daily_capacity, 0) > 0
  and exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
  and not exists (
    select 1 from session_occurrences x
    where x.activity_option_id = o.id
      and (x.starts_at at time zone 'Indian/Mauritius')::date = d::date
  )
on conflict (activity_option_id, starts_at) do nothing;

-- ===========================================================================
-- 20260732000000_airport_transfer_booking_fields.sql — the AT-2 booking form: traveller + trip detail
-- columns, the arrival/departure/return trip_direction, the free-text "not listed" area→zone fallback,
-- the named Zone 2 hotels, and api_book / booking_json re-applied from their winning bodies with ONLY the
-- new fields added (no zone-pricing / guard reverts). Mirrors the migration byte-for-byte.
-- ===========================================================================

-- 1) bookings: the new traveller + trip detail columns (all nullable/additive). trip_direction defaults
--    to 'arrival' so an old client that sends no direction still classifies sensibly; the check allows the
--    three confirmed values.
alter table bookings add column if not exists trip_direction text;
alter table bookings drop constraint if exists bookings_trip_direction_check;
alter table bookings add constraint bookings_trip_direction_check
  check (trip_direction is null or trip_direction in ('arrival', 'departure', 'return'));
alter table bookings add column if not exists traveller_gender text;
alter table bookings add column if not exists traveller_company text;
alter table bookings add column if not exists traveller_country text;
alter table bookings add column if not exists special_notes text;
alter table bookings add column if not exists room_or_cabin text;
alter table bookings add column if not exists luggage_details text;
alter table bookings add column if not exists child_seat_age int;

-- 2) airport_transfer_hotels: add the named Zone 2 hotels the owner confirmed that weren't yet seeded
--    (Anantara IKO, Holiday Inn Mauritius, Astroea Beach, Le Peninsula Bay) and ensure they're zoned 2.
insert into airport_transfer_hotels (slug, hotel_name, region, zone) values
  ('anantara-iko-mauritius', 'Anantara Iko Mauritius Resort', 'South', 'zone2'),
  ('holiday-inn-mauritius', 'Holiday Inn Mauritius Mon Trésor', 'South', 'zone2'),
  ('astroea-beach', 'Astroea Beach', 'South', 'zone2'),
  ('le-peninsula-bay', 'Le Peninsula Bay Beach Resort', 'South', 'zone2')
on conflict (slug) do update set hotel_name = excluded.hotel_name, zone = excluded.zone;
update airport_transfer_hotels set zone = 'zone2'
  where slug in ('shandrani-beachcomber', 'preskil-island-resort',
                 'anantara-iko-mauritius', 'holiday-inn-mauritius', 'astroea-beach', 'le-peninsula-bay');

-- 3) airport_transfer_area_zone(): classify a free-text drop-off AREA to a pricing zone for the
--    "my hotel isn't listed" path. Zone 2 = the near-airport south-east areas (Mahébourg, Blue Bay,
--    Pointe d'Esny, Ferney, Grand Port). Everything else is Zone 1. Mirrors airportAreaZone() in pricing.ts.
create or replace function airport_transfer_area_zone(p_area text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(btrim(coalesce(p_area, '')));
begin
  if v = '' then
    return 'zone1';
  end if;
  -- Normalise the common accented spelling so "mahébourg" and "mahebourg" both match.
  v := replace(v, 'é', 'e');
  if v like '%mahebourg%' or v like '%blue bay%' or v like '%pointe d%esny%'
     or v like '%ferney%' or v like '%grand port%' then
    return 'zone2';
  end if;
  return 'zone1';
end;
$$;
grant execute on function airport_transfer_area_zone(text) to anon, authenticated, service_role;

-- 4) api_book: re-applied from its WINNING body (20260731000000_airport_transfer_zones) VERBATIM, adding
--    ONLY: (a) the area→zone fallback when no dropoffSlug is sent (free-text "not listed" hotel), and
--    (b) persisting the new trip_direction + traveller/trip detail fields.
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
  v_is_airport boolean := false;
  v_dropoff_zone text;
  v_trip_type text;
  v_trip_direction text;
  v_ret_pct int;
  v_fare bigint;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom') then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  -- Airport transfer (server-authoritative, zero-trust): the destination ZONE comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent zone. When the guest's hotel isn't listed
  -- (no dropoffSlug), classify the zone from the supplied AREA instead (Zone 2 = the near-airport
  -- south-east areas), still never trusting a client price. The whole fare is the zone × vehicle matrix
  -- (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    -- trip_direction (customer-facing) drives the priced trip_type: return = both legs, arrival/departure
    -- = a single leg (one_way). An old client sending only tripType still works (direction falls back).
    v_trip_direction := case
      when (p ->> 'tripDirection') in ('arrival', 'departure', 'return') then p ->> 'tripDirection'
      when (p ->> 'tripType') = 'return' then 'return'
      else 'arrival'
    end;
    v_trip_type := case when v_trip_direction = 'return' then 'return' else 'one_way' end;
    if nullif(p ->> 'dropoffSlug', '') is not null then
      select zone into v_dropoff_zone from airport_transfer_hotels
        where slug = nullif(p ->> 'dropoffSlug', '');
    end if;
    -- Free-text "not listed" drop-off: classify from the area.
    if v_dropoff_zone is null then
      v_dropoff_zone := airport_transfer_area_zone(p ->> 'dropoffArea');
    end if;
    v_fare := airport_transfer_fare_minor(v_dropoff_zone, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        trip_direction = v_trip_direction,
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        child_seat_age = nullif(p ->> 'childSeatAge', '')::int,
        traveller_gender = left(nullif(btrim(p ->> 'travellerGender'), ''), 20),
        traveller_company = left(nullif(btrim(p ->> 'travellerCompany'), ''), 120),
        traveller_country = left(nullif(btrim(p ->> 'travellerCountry'), ''), 80),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 5) booking_json: re-applied from its WINNING body VERBATIM, plus the new trip_direction +
--    traveller/trip detail fields so the voucher (PDF/email) + admin booking drawer can show them.
create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'pickupPending', b.pickup_pending,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'pickupRegion', b.pickup_region,
    'tripType', b.trip_type,
    'tripDirection', b.trip_direction,
    'flightNumber', b.flight_number,
    'arrivalTime', b.arrival_time,
    'returnDate', b.return_date,
    'returnTime', b.return_time,
    'departureFlightNumber', b.departure_flight_number,
    'roomOrCabin', b.room_or_cabin,
    'luggageDetails', b.luggage_details,
    'childSeatAge', b.child_seat_age,
    'travellerGender', b.traveller_gender,
    'travellerCompany', b.traveller_company,
    'travellerCountry', b.traveller_country,
    'specialNotes', b.special_notes,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;


-- ---- migration 20260733000000_cancel_booking ----------------------------------------------------------
-- Customer-initiated "Cancel activity & claim refund": a confirmed + paid booking, >24h before the trip,
-- self-cancels to refund_pending (frees the seat, notifies the owner); the owner refunds in Peach + marks
-- it refunded (api_mark_refunded). Self-service blocked inside 24h / after start. No automated refund.
create or replace function api_cancel_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(p ->> 'ref', '');
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_starts_at timestamptz;
begin
  if v_ref is null then
    raise exception 'invalid_request' using detail = 'cancel: ref required';
  end if;

  select * into v_booking from bookings where ref = v_ref;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Ownership: the booking's own customer, or staff. (A definer function bypasses RLS — check here.)
  if not (is_staff() or (v_uid is not null and v_booking.user_id = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: already cancelled / refund in flight / refunded → return current state, no re-enqueue.
  if v_booking.status in ('refund_pending', 'cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', v_booking.status, 'alreadyCancelled', true);
  end if;

  -- Only a confirmed, paid booking can be self-cancelled for a refund.
  if not (v_booking.status = 'confirmed' and v_booking.payment_state = 'paid') then
    raise exception 'not_cancellable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- The 24-hour window: the EARLIEST occurrence on this booking must start more than 24h from now.
  select min(so.starts_at) into v_starts_at
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_booking.id;
  if v_starts_at is null or v_starts_at <= now() + interval '24 hours' then
    raise exception 'cancellation_window_passed'
      using detail = 'self-service cancellation closes 24 hours before the activity';
  end if;

  -- Cancel → refund_pending (refund_pending frees used_capacity, so the seat is resellable at once). The
  -- actual money movement is recorded later through api_mark_refunded → append_payment_event.
  update bookings set status = 'refund_pending', updated_at = now() where id = v_booking.id;

  -- Heads-up to the owner to process the refund (best-effort; the admin refund_pending queue is the
  -- authoritative work-list). The idempotency key stops a double-cancel enqueuing twice.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'bookings@bellemaretours.com', 'booking_cancellation',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'booking_cancellation:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', 'refund_pending');
end;
$$;

revoke execute on function api_cancel_booking(jsonb) from public;
grant execute on function api_cancel_booking(jsonb) to authenticated, service_role;

create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'pickupPending', b.pickup_pending,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'pickupRegion', b.pickup_region,
    'tripType', b.trip_type,
    'tripDirection', b.trip_direction,
    'flightNumber', b.flight_number,
    'arrivalTime', b.arrival_time,
    'returnDate', b.return_date,
    'returnTime', b.return_time,
    'departureFlightNumber', b.departure_flight_number,
    'roomOrCabin', b.room_or_cabin,
    'luggageDetails', b.luggage_details,
    'childSeatAge', b.child_seat_age,
    'travellerGender', b.traveller_gender,
    'travellerCompany', b.traveller_company,
    'travellerCountry', b.traveller_country,
    'specialNotes', b.special_notes,
    'cancellable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and coalesce((
        select min(so.starts_at)
          from booking_items bi
          join session_occurrences so on so.id = bi.session_occurrence_id
         where bi.booking_id = b.id
      ), 'epoch'::timestamptz) > now() + interval '24 hours'
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;


commit;

-- ---- migration 20260733000001_pending_cart_autocancel (pending bookings in cart + safe auto-cancel) ----
-- api_my_pending_bookings: owner-scoped pending bookings + live hold expiry (RLS-safe seam for the cart).
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

-- run_booking_maintenance: + audit row per auto-expired booking (guard + hold-release unchanged).
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

  update booking_holds h
     set status = 'released'
    from bookings b
   where h.booking_id = b.id and b.status = 'expired' and h.status = 'active';

  return jsonb_build_object('holdsExpired', v_holds, 'bookingsExpired', v_bookings);
end;
$$;

revoke execute on function run_booking_maintenance(jsonb) from public;
grant execute on function run_booking_maintenance(jsonb) to service_role;

-- enqueue_booking_notification: email outbox (confirmed/refunded/expired) + per-user in-app feed rows
-- (confirmed/cancelled/refunded, owner only, idempotent). Mirrors 20260739000000_notifications_feed.sql.
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


-- ==================== 20260734000000_hotel_transfers (mirror) ====================
-- Hotel-to-hotel transfers: a bookable point-to-point private transfer between two hotels, priced by the
-- DISTANCE BAND between the two hotels' regions (same / near / far coast) × vehicle bracket.
--
-- This is a SECOND transfer product alongside the airport transfer. It reuses the existing machinery:
--   * the hotel registry airport_transfer_hotels (each row already carries a `region`),
--   * region_distance_band() + region_zone_distance (the same/near/far classifier),
--   * the vehicle brackets (Sedan ≤4, SUV ≤4 upgrade, Family 5–6, Van 7–14, Coaster 15–25),
-- and adds its OWN owner-tunable band×vehicle fare table (hotel_transfer_fare — full-transfer prices,
-- distinct from the cheaper per-tour transport_band_pricing add-on) + a return-discount config.
--
-- Pricing stays SERVER-AUTHORITATIVE and zero-trust: api_book derives BOTH endpoints' regions from the
-- hotel SLUGS (airport_transfer_hotels.region) — or, for an unlisted end, from the supplied AREA via
-- area_region() — classifies the band, recomputes the fare, and OVERRIDES the booking total + payout +
-- line item. Client price/region/band are display-only. The TS hotelTransferQuoteMinor() in
-- src/lib/services/pricing.ts mirrors the functions below cent-for-cent (pricing parity unit tests).
--
-- api_book / booking_json / api_get_activity are re-applied from their WINNING bodies
-- (20260732000000_airport_transfer_booking_fields) VERBATIM, adding ONLY the hotel-transfer branch /
-- keys — no airport guard or feature silently reverts ([[gytm-migration-revert-drift]]). Mirror this
-- whole file into supabase/catch-up.sql per the DB-sync convention ([[gytm-db-sync]]).

-- 1) activities: flag the hotel-transfer product (parallel to is_airport_transfer).
alter table activities add column if not exists is_hotel_transfer boolean not null default false;

-- 2) bookings: the pickup hotel slug (drop-off slug rides the existing dropoff fields). Additive/nullable.
alter table bookings add column if not exists pickup_hotel_slug text;

-- 3) hotel_transfer_fare: ONE flat fare per (distance band × vehicle bracket). Full-transfer prices —
--    owner-tunable in /admin (distinct from the cheaper per-tour transport_band_pricing add-on). Every
--    cell is a placeholder until the owner sets the real rates. Public read, staff edit.
create table if not exists hotel_transfer_fare (
  band          text primary key check (band in ('same', 'near', 'far')),
  sedan_minor   int not null,   -- 1-4
  suv_minor     int not null,   -- 1-4 upgrade
  family_minor  int not null,   -- 5-6
  van_minor     int not null,   -- 7-14
  coaster_minor int not null,   -- 15-25 (×N coasters above 25)
  updated_at    timestamptz not null default now()
);
insert into hotel_transfer_fare (band, sedan_minor, suv_minor, family_minor, van_minor, coaster_minor) values
  ('same', 2500, 3500, 4000,  6500, 11000),   -- €25 / €35 / €40 / €65 / €110 (placeholders)
  ('near', 4000, 5200, 6000,  9500, 16000),   -- €40 / €52 / €60 / €95 / €160
  ('far',  6000, 7500, 8500, 13000, 22000)    -- €60 / €75 / €85 / €130 / €220
on conflict (band) do nothing;
alter table hotel_transfer_fare enable row level security;
grant select on hotel_transfer_fare to anon, authenticated, service_role;
grant update on hotel_transfer_fare to authenticated;
drop policy if exists hotel_transfer_fare_read on hotel_transfer_fare;
create policy hotel_transfer_fare_read on hotel_transfer_fare for select using (true);
drop policy if exists hotel_transfer_fare_staff on hotel_transfer_fare;
create policy hotel_transfer_fare_staff on hotel_transfer_fare for all using (is_staff()) with check (is_staff());

-- 4) hotel_transfer_config: single-row config (the return-trip discount %), separate from the airport
--    config so the two products are tuned independently.
create table if not exists hotel_transfer_config (
  id                  boolean primary key default true check (id),
  return_discount_pct int not null default 10 check (return_discount_pct between 0 and 90),
  updated_at          timestamptz not null default now()
);
insert into hotel_transfer_config (id) values (true) on conflict (id) do nothing;
alter table hotel_transfer_config enable row level security;
grant select on hotel_transfer_config to anon, authenticated, service_role;
grant update on hotel_transfer_config to authenticated;
drop policy if exists hotel_transfer_config_read on hotel_transfer_config;
create policy hotel_transfer_config_read on hotel_transfer_config for select using (true);
drop policy if exists hotel_transfer_config_staff on hotel_transfer_config;
create policy hotel_transfer_config_staff on hotel_transfer_config for all using (is_staff()) with check (is_staff());

-- 5) hotel_transfer_fare_minor(): band row -> vehicle bracket by party size. A copy of
--    airport_transfer_fare_minor keyed on band (not zone). Mirrors hotelTransferFareMinor() in pricing.ts.
create or replace function hotel_transfer_fare_minor(p_band text, p_pax int, p_suv boolean)
returns bigint
language plpgsql
stable
as $$
declare
  v_row hotel_transfer_fare;
begin
  if p_band is null or p_pax is null or p_pax < 1 then
    return 0;
  end if;
  select * into v_row from hotel_transfer_fare where band = p_band;
  if not found then
    return 0;
  end if;
  if p_pax <= 4 then
    return case when coalesce(p_suv, false) then v_row.suv_minor else v_row.sedan_minor end;
  elsif p_pax <= 6 then
    return v_row.family_minor;
  elsif p_pax <= 14 then
    return v_row.van_minor;
  elsif p_pax <= 25 then
    return v_row.coaster_minor;
  else
    return v_row.coaster_minor * ceil(p_pax::numeric / 25)::int;
  end if;
end;
$$;
grant execute on function hotel_transfer_fare_minor(text, int, boolean) to anon, authenticated, service_role;

-- 6) area_region(): classify a free-text "my place isn't listed" area to one of the five regions, for the
--    server-side hotel-to-hotel fare. Case/space-insensitive, accent-light. Unknown -> NULL, which
--    region_distance_band() treats as 'far' (fail safe to the higher fare — never under-prices). Used only
--    for an unlisted end; a listed hotel takes its region from airport_transfer_hotels.
create or replace function area_region(p_area text)
returns text
language plpgsql
immutable
as $$
declare
  v text := translate(lower(btrim(coalesce(p_area, ''))), 'éèê', 'eee');
begin
  if v = '' then return null; end if;
  if v like '%grand baie%' or v like '%grand bay%' or v like '%pereybere%' or v like '%cap malheureux%'
     or v like '%trou aux biches%' or v like '%mont choisy%' or v like '%canonniers%' or v like '%balaclava%'
     or v like '%pointe aux piments%' or v like '%calodyne%' or v like '%grand gaube%' or v like '%port louis%' then
    return 'North';
  elsif v like '%belle mare%' or v like '%trou d%eau douce%' or v like '%palmar%' or v like '%poste lafayette%'
     or v like '%roches noires%' or v like '%flacq%' or v like '%bel air%' then
    return 'East';
  elsif v like '%mahebourg%' or v like '%blue bay%' or v like '%pointe d%esny%' or v like '%bel ombre%'
     or v like '%souillac%' or v like '%chamarel%' or v like '%ferney%' or v like '%grand port%' then
    return 'South';
  elsif v like '%flic en flac%' or v like '%flic-en-flac%' or v like '%tamarin%' or v like '%riviere noire%'
     or v like '%black river%' or v like '%le morne%' or v like '%wolmar%' or v like '%albion%' or v like '%la gaulette%' then
    return 'West';
  elsif v like '%curepipe%' or v like '%quatre bornes%' or v like '%moka%' or v like '%vacoas%'
     or v like '%ebene%' or v like '%floreal%' or v like '%rose hill%' or v like '%phoenix%' then
    return 'Central';
  end if;
  return null;
end;
$$;
grant execute on function area_region(text) to anon, authenticated, service_role;

-- 6b) hotel_end_region(): resolve ONE end of a hotel-to-hotel transfer to its pricing region, zero-trust.
--    Precedence: a listed hotel SLUG (airport_transfer_hotels) → the COORDS of a free Google Places pick
--    (region_from_coords) → the free-text AREA (area_region). NULL when nothing resolves, which
--    region_distance_band() treats as the far band (fail safe — never under-prices).
create or replace function hotel_end_region(p_slug text, p_lat double precision, p_lng double precision, p_area text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_region text;
begin
  if nullif(p_slug, '') is not null then
    select region into v_region from airport_transfer_hotels where slug = nullif(p_slug, '');
    if v_region is not null then return v_region; end if;
  end if;
  if p_lat is not null and p_lng is not null then
    v_region := region_from_coords(p_lat, p_lng);
    if v_region is not null then return v_region; end if;
  end if;
  return area_region(p_area);
end;
$$;
grant execute on function hotel_end_region(text, double precision, double precision, text) to anon, authenticated, service_role;

-- 7) api_book: re-applied from its WINNING body (20260732000000_airport_transfer_booking_fields) VERBATIM,
--    adding ONLY the hotel-to-hotel branch (after the airport branch): derive both regions from the slugs
--    (or area_region for a free-text end), reject same pickup==dropoff, classify the band, price band ×
--    vehicle × return-discount, and OVERRIDE the total/payout/line-item. The airport branch + F23 guard +
--    every other branch are unchanged.
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
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
  v_is_airport boolean := false;
  v_is_hotel boolean := false;
  v_dropoff_zone text;
  v_trip_type text;
  v_trip_direction text;
  v_ret_pct int;
  v_fare bigint;
  v_hotel_pickup_region text;
  v_hotel_dropoff_region text;
  v_band text;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false),
         coalesce(a.is_hotel_transfer, false)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom') then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  -- Airport transfer (server-authoritative, zero-trust): the destination ZONE comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent zone. When the guest's hotel isn't listed
  -- (no dropoffSlug), classify the zone from the supplied AREA instead (Zone 2 = the near-airport
  -- south-east areas), still never trusting a client price. The whole fare is the zone × vehicle matrix
  -- (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    v_trip_direction := case
      when (p ->> 'tripDirection') in ('arrival', 'departure', 'return') then p ->> 'tripDirection'
      when (p ->> 'tripType') = 'return' then 'return'
      else 'arrival'
    end;
    v_trip_type := case when v_trip_direction = 'return' then 'return' else 'one_way' end;
    if nullif(p ->> 'dropoffSlug', '') is not null then
      select zone into v_dropoff_zone from airport_transfer_hotels
        where slug = nullif(p ->> 'dropoffSlug', '');
    end if;
    if v_dropoff_zone is null then
      v_dropoff_zone := airport_transfer_area_zone(p ->> 'dropoffArea');
    end if;
    v_fare := airport_transfer_fare_minor(v_dropoff_zone, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        trip_direction = v_trip_direction,
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        child_seat_age = nullif(p ->> 'childSeatAge', '')::int,
        traveller_gender = left(nullif(btrim(p ->> 'travellerGender'), ''), 20),
        traveller_company = left(nullif(btrim(p ->> 'travellerCompany'), ''), 120),
        traveller_country = left(nullif(btrim(p ->> 'travellerCountry'), ''), 80),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  -- Hotel-to-hotel transfer (server-authoritative, zero-trust): derive BOTH endpoints' regions from the
  -- hotel SLUGS via airport_transfer_hotels (or area_region() for a free-text end), reject a same-hotel
  -- trip, classify the distance band (region_distance_band), and price band × vehicle (× return discount).
  -- OVERRIDE the booking total + payout + line item. Mirrors hotelTransferQuoteMinor() in pricing.ts.
  if v_is_hotel then
    if nullif(p ->> 'pickupSlug', '') is not null
       and nullif(p ->> 'pickupSlug', '') = nullif(p ->> 'dropoffSlug', '') then
      raise exception 'same_hotel';
    end if;
    v_trip_type := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
    v_hotel_pickup_region := hotel_end_region(
      p ->> 'pickupSlug',
      nullif(p ->> 'pickupLat', '')::double precision,
      nullif(p ->> 'pickupLng', '')::double precision,
      p ->> 'pickupArea');
    v_hotel_dropoff_region := hotel_end_region(
      p ->> 'dropoffSlug',
      nullif(p ->> 'dropoffLat', '')::double precision,
      nullif(p ->> 'dropoffLng', '')::double precision,
      p ->> 'dropoffArea');
    v_band := region_distance_band(v_hotel_pickup_region, v_hotel_dropoff_region);
    v_fare := hotel_transfer_fare_minor(v_band, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        pickup_hotel_slug = left(nullif(btrim(p ->> 'pickupSlug'), ''), 120),
        pickup_region = v_hotel_pickup_region,
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 8) booking_json: re-applied from its WINNING body (20260733000000_cancel_booking — keeping its
--    `cancellable` field) VERBATIM, plus pickupHotelSlug so the run sheet / confirmation / admin drawer
--    can show the hotel-to-hotel pickup. (Rebase drift guard — do NOT drop `cancellable`.)
create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'pickupPending', b.pickup_pending,
    'pickupHotelSlug', b.pickup_hotel_slug,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'pickupRegion', b.pickup_region,
    'tripType', b.trip_type,
    'tripDirection', b.trip_direction,
    'flightNumber', b.flight_number,
    'arrivalTime', b.arrival_time,
    'returnDate', b.return_date,
    'returnTime', b.return_time,
    'departureFlightNumber', b.departure_flight_number,
    'roomOrCabin', b.room_or_cabin,
    'luggageDetails', b.luggage_details,
    'childSeatAge', b.child_seat_age,
    'travellerGender', b.traveller_gender,
    'travellerCompany', b.traveller_company,
    'travellerCountry', b.traveller_country,
    'specialNotes', b.special_notes,
    'cancellable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and coalesce((
        select min(so.starts_at)
          from booking_items bi
          join session_occurrences so on so.id = bi.session_occurrence_id
         where bi.booking_id = b.id
      ), 'epoch'::timestamptz) > now() + interval '24 hours'
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- 9) api_get_activity: re-applied from its WINNING body (20260732000000) VERBATIM, plus isHotelTransfer +
--    the hotel band×vehicle fare table + region distances + return discount, so the hotel-to-hotel quote
--    console can show a live, exact price. The airport keys are unchanged.
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the bookable hotel-transfer (point-to-point) activity + rolling availability — mirrors the
-- airport-transfer bookable seed so on-site booking works the moment this is applied: availability ->
-- hold -> /checkout against expectedSlug='hotel-transfer', NO separate publish step. Idempotent.
insert into activities (
  operator_id, slug, type, title, summary, description, category, location, duration_minutes,
  meeting_point, pickup_available, languages, inclusions, exclusions, highlights, status, pricing_mode
)
select o.id, 'hotel-transfer', 'transport',
  'Private Transfer',
  'Private fixed-price transfer between any two points in Mauritius — hotels, resorts or towns, door to door.',
  null, 'Airport transfers', 'Island-wide', null,
  null, true, array['en', 'fr']::text[],
  array['Private driver', 'Door to door', 'Luggage assistance']::text[], '{}'::text[],
  array['Fixed price', 'Door to door', 'Any two locations']::text[], 'published', 'vehicle'
from operators o
where o.slug = 'belle-mare-tours'
on conflict (slug) do nothing;

insert into activity_translations (activity_id, locale, title, summary)
select a.id, 'en', 'Private Transfer',
  'Private fixed-price transfer between any two points in Mauritius — hotels, resorts or towns, door to door.'
from activities a where a.slug = 'hotel-transfer'
on conflict (activity_id, locale) do nothing;

insert into activity_translations (activity_id, locale, title, summary)
select a.id, 'fr', 'Transfert privé',
  'Transfert privé à prix fixe entre deux points de l''île Maurice — hôtels, complexes ou villes, de porte à porte.'
from activities a where a.slug = 'hotel-transfer'
on conflict (activity_id, locale) do nothing;

insert into activity_options (activity_id, name)
select a.id, 'Per transfer'
from activities a
where a.slug = 'hotel-transfer'
  and not exists (
    select 1 from activity_options o2 where o2.activity_id = a.id and o2.name = 'Per transfer'
  );

insert into activity_option_prices (activity_option_id, label, amount_minor, currency, max_guests)
select o.id, 'Per transfer', 4000, 'EUR', null
from activity_options o
join activities a on a.id = o.activity_id
where a.slug = 'hotel-transfer' and o.name = 'Per transfer'
  and not exists (
    select 1 from activity_option_prices pr where pr.activity_option_id = o.id
  );

update activities
set is_hotel_transfer = true,
    pricing_mode = 'vehicle',
    min_advance_days = 0,
    daily_capacity = coalesce(daily_capacity, 40)
where slug = 'hotel-transfer';

insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
select o.id,
       a.operator_id,
       (d::date + time '12:00') at time zone 'Indian/Mauritius',
       ((d::date + time '12:00') at time zone 'Indian/Mauritius') + make_interval(mins => coalesce(a.duration_minutes, 120)),
       a.daily_capacity,
       'open'
from activities a
join activity_options o on o.activity_id = a.id
cross join generate_series(
  (now() at time zone 'Indian/Mauritius')::date,
  (now() at time zone 'Indian/Mauritius')::date + 185,
  interval '1 day'
) d
where a.slug = 'hotel-transfer'
  and a.status = 'published'
  and coalesce(a.daily_capacity, 0) > 0
  and exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
  and not exists (
    select 1 from session_occurrences x
    where x.activity_option_id = o.id
      and (x.starts_at at time zone 'Indian/Mauritius')::date = d::date
  )
on conflict (activity_option_id, starts_at) do nothing;

-- ---- 20260735000000_transfer_service_date -----------------------------------
-- booking_json gains `serviceDate` (the booking's occurrence date) so the confirmation page can show the
-- transfer's arrival date. Re-applied from the winning hotel_transfers body (KEEPS pickupHotelSlug +
-- cancellable; drift guard) — see [[gytm-migration-revert-drift]].
create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'pickupPending', b.pickup_pending,
    'pickupHotelSlug', b.pickup_hotel_slug,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'pickupRegion', b.pickup_region,
    'tripType', b.trip_type,
    'tripDirection', b.trip_direction,
    'flightNumber', b.flight_number,
    'arrivalTime', b.arrival_time,
    'returnDate', b.return_date,
    'returnTime', b.return_time,
    'departureFlightNumber', b.departure_flight_number,
    'roomOrCabin', b.room_or_cabin,
    'luggageDetails', b.luggage_details,
    'childSeatAge', b.child_seat_age,
    'travellerGender', b.traveller_gender,
    'travellerCompany', b.traveller_company,
    'travellerCountry', b.traveller_country,
    'specialNotes', b.special_notes,
    'cancellable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and coalesce((
        select min(so.starts_at)
          from booking_items bi
          join session_occurrences so on so.id = bi.session_occurrence_id
         where bi.booking_id = b.id
      ), 'epoch'::timestamptz) > now() + interval '24 hours'
    ),
    'serviceDate', (
      select min(so.starts_at)
        from booking_items bi
        join session_occurrences so on so.id = bi.session_occurrence_id
       where bi.booking_id = b.id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- ---- 20260736000000_peach_safe_booking_ref ----------------------------------
-- Peach caps merchantTransactionId at 16 alphanumeric chars + strips dashes, mangling the old `BMT-` +
-- 16-hex ref. Make new refs Peach-safe (16-char alnum, `BMT` + 13 hex, no dash) so admin ↔ Peach match
-- and the webhook reconcile-by-ref works. Existing rows keep their refs.
alter table bookings alter column ref set default ('BMT' || upper(substr(md5(gen_random_uuid()::text), 1, 13)));

-- ---- 20260737000000_booking_history -----------------------------------------
-- Owner-scoped "My Trips" list backing GET /api/v1/bookings. Newest-first, paginated, optional
-- status + trip-date filters; totalEur in EUR major units. Same RLS-safe SECURITY DEFINER seam as
-- api_my_pending_bookings. Idempotent create-or-replace.
create or replace function api_my_bookings(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := nullif(p ->> 'status', '');
  v_from date := nullif(p ->> 'from', '')::date;
  v_to date := nullif(p ->> 'to', '')::date;
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_page_size int := least(greatest(coalesce((p ->> 'pageSize')::int, 20), 1), 100);
  v_total int;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  with mine as (
    select
      b.id, b.ref, b.status, b.payment_state, b.total_minor, b.currency, b.created_at,
      a.id as activity_id, coalesce(a.title, 'Your booking') as title, occ.starts_at
    from bookings b
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
      and (v_status is null or b.status::text = v_status)
      and (v_from is null or occ.starts_at >= v_from)
      and (v_to is null or occ.starts_at < (v_to + 1))
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', m.ref,
        'title', m.title,
        'status', m.status,
        'paymentState', m.payment_state,
        'totalEur', m.total_minor::float / 100,
        'currency', m.currency,
        'startsAt', m.starts_at,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = m.activity_id order by img.position limit 1
        ),
        'createdAt', m.created_at
      ) order by m.created_at desc)
      from (
        select * from mine
        order by created_at desc
        limit v_page_size
        offset (v_page - 1) * v_page_size
      ) m
    ), '[]'::jsonb),
    (select count(*)::int from mine)
  into v_items, v_total;

  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

revoke execute on function api_my_bookings(jsonb) from public;
grant execute on function api_my_bookings(jsonb) to authenticated;

-- ---- 20260738000000_wishlists -----------------------------------------------
-- Cross-device saved activities. Owner-scoped in RLS + the api_* seam; unique(user_id, activity_id)
-- makes re-adding idempotent. Idempotent DDL so this applies on top of a live DB.
create table if not exists wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_id uuid not null references activities (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, activity_id)
);
create index if not exists wishlists_user_idx on wishlists (user_id, created_at desc);
grant select, insert, delete on wishlists to authenticated;
alter table wishlists enable row level security;
drop policy if exists wishlists_select on wishlists;
drop policy if exists wishlists_insert on wishlists;
drop policy if exists wishlists_delete on wishlists;
drop policy if exists wishlists_staff on wishlists;
create policy wishlists_select on wishlists for select using (user_id = auth.uid());
create policy wishlists_insert on wishlists for insert with check (user_id = auth.uid());
create policy wishlists_delete on wishlists for delete using (user_id = auth.uid());
create policy wishlists_staff on wishlists for all using (is_staff()) with check (is_staff());

create or replace function api_my_wishlist(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(t.item order by t.saved_at desc), '[]'::jsonb) into v_items
  from (
    select w.created_at as saved_at, jsonb_build_object(
      'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
      'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
      'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
      'minAdvanceDays', coalesce(x.min_advance_days, 1),
      'fromPriceEur', case
        when x.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
        else (
          select min(pr.amount_minor)::float / 100
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
        )
      end,
      'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
        select pr.max_guests
        from activity_option_prices pr
        join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = x.id
        order by pr.amount_minor asc nulls last
        limit 1
      ) end,
      'heroImage', (
        select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
        from activity_images img where img.activity_id = x.id order by img.position limit 1
      ),
      'images', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          order by img.position
        )
        from activity_images img where img.activity_id = x.id
      ), '[]'::jsonb)
    ) as item
    from wishlists w
    join activities x on x.id = w.activity_id and x.status = 'published'
    where w.user_id = v_uid
  ) t;
  return v_items;
end;
$$;

create or replace function api_add_wishlist(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := nullif(p ->> 'slug', '');
  v_activity_id uuid;
  v_created boolean;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_slug is null then
    raise exception 'invalid_request: slug is required';
  end if;
  select id into v_activity_id from activities where slug = v_slug and status = 'published';
  if v_activity_id is null then
    raise exception 'activity_not_found';
  end if;
  with ins as (
    insert into wishlists (user_id, activity_id)
    values (v_uid, v_activity_id)
    on conflict (user_id, activity_id) do nothing
    returning 1
  )
  select exists (select 1 from ins) into v_created;
  return jsonb_build_object('slug', v_slug, 'saved', true, 'created', v_created);
end;
$$;

create or replace function api_remove_wishlist(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := nullif(p ->> 'slug', '');
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  delete from wishlists w
   using activities a
   where w.activity_id = a.id and a.slug = v_slug and w.user_id = v_uid;
  return jsonb_build_object('slug', v_slug, 'saved', false);
end;
$$;

revoke execute on function api_my_wishlist(jsonb) from public;
revoke execute on function api_add_wishlist(jsonb) from public;
revoke execute on function api_remove_wishlist(jsonb) from public;
grant execute on function api_my_wishlist(jsonb) to authenticated;
grant execute on function api_add_wishlist(jsonb) to authenticated;
grant execute on function api_remove_wishlist(jsonb) to authenticated;

-- ---- 20260739000000_notifications_feed --------------------------------------
-- Per-user in-app notification feed (distinct from notification_outbox). Owner-scoped RLS + DEFINER
-- read/mark RPCs. The enqueue_booking_notification trigger that populates it is updated in-place above.
-- Idempotent DDL so this applies on top of a live DB.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
grant select, update on notifications to authenticated;
alter table notifications enable row level security;
drop policy if exists notifications_select on notifications;
drop policy if exists notifications_update on notifications;
drop policy if exists notifications_staff on notifications;
create policy notifications_select on notifications for select using (user_id = auth.uid());
create policy notifications_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_staff on notifications for all using (is_staff()) with check (is_staff());

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

-- ---- 20260740000000_notifications_unread_count ------------------------------
create or replace function api_notifications_unread_count(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select count(*)::int into v_count
  from notifications
  where user_id = v_uid and read_at is null;
  return jsonb_build_object('count', v_count);
end;
$$;

revoke execute on function api_notifications_unread_count(jsonb) from public;
grant execute on function api_notifications_unread_count(jsonb) to authenticated;

-- ---- 20260741000000_transfers_read ------------------------------------------
create or replace function api_search_transfer_hotels(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(p ->> 'q'), '');
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_page_size int := least(greatest(coalesce((p ->> 'pageSize')::int, 20), 1), 100);
  v_items jsonb;
  v_total int;
begin
  with filtered as (
    select slug, hotel_name, region, zone
    from airport_transfer_hotels
    where v_q is null or hotel_name ilike '%' || v_q || '%'
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', f.slug, 'name', f.hotel_name, 'region', f.region, 'zone', f.zone
      ) order by f.hotel_name)
      from (select * from filtered order by hotel_name limit v_page_size offset (v_page - 1) * v_page_size) f
    ), '[]'::jsonb),
    (select count(*)::int from filtered)
  into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

create or replace function api_list_transfer_areas(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', t.label,
    'region', area_region(t.label),
    'zone', airport_transfer_area_zone(t.label)
  ) order by area_region(t.label), t.label), '[]'::jsonb)
  from (values
    ('Grand Baie', 'North'), ('Pereybère', 'North'), ('Cap Malheureux', 'North'),
    ('Trou aux Biches', 'North'), ('Mont Choisy', 'North'), ('Pointe aux Canonniers', 'North'),
    ('Balaclava', 'North'), ('Pointe aux Piments', 'North'), ('Grand Gaube', 'North'), ('Port Louis', 'North'),
    ('Belle Mare', 'East'), ('Trou d''Eau Douce', 'East'), ('Palmar', 'East'), ('Poste Lafayette', 'East'),
    ('Roches Noires', 'East'), ('Centre de Flacq', 'East'),
    ('Mahébourg', 'South'), ('Blue Bay', 'South'), ('Pointe d''Esny', 'South'), ('Bel Ombre', 'South'),
    ('Souillac', 'South'), ('Chamarel', 'South'), ('Grand Port', 'South'),
    ('Flic en Flac', 'West'), ('Tamarin', 'West'), ('Rivière Noire (Black River)', 'West'),
    ('Le Morne', 'West'), ('Wolmar', 'West'), ('Albion', 'West'), ('La Gaulette', 'West'),
    ('Curepipe', 'Central'), ('Quatre Bornes', 'Central'), ('Moka', 'Central'),
    ('Vacoas', 'Central'), ('Ébène', 'Central'), ('Rose Hill', 'Central')
  ) as t(label, region);
$$;

create or replace function api_transfer_quote(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text := p ->> 'transferSlug';
  v_pax int := 0;
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_trip_type text := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
  v_zone text;
  v_band text;
  v_pickup_region text;
  v_dropoff_region text;
  v_one_way bigint;
  v_ret_pct int;
  v_total bigint;
  v_zone_or_band text;
  v_vehicle text;
begin
  if v_kind not in ('airport-transfer', 'hotel-transfer') then
    raise exception 'invalid_request: unknown transferSlug';
  end if;
  if jsonb_typeof(p -> 'party') = 'object' then
    select coalesce(sum(value::int), 0) into v_pax from jsonb_each_text(p -> 'party');
  end if;
  if v_pax < 1 then
    v_pax := greatest(coalesce(nullif(p ->> 'pax', '')::int, 1), 1);
  end if;
  if v_kind = 'airport-transfer' then
    v_zone := coalesce(
      (select zone from airport_transfer_hotels where slug = nullif(p ->> 'dropoffSlug', '')),
      airport_transfer_area_zone(p ->> 'dropoffArea'));
    v_one_way := airport_transfer_fare_minor(v_zone, v_pax, v_suv);
    select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
    v_zone_or_band := v_zone;
  else
    -- Resolve each end exactly as api_book does (slug -> coords -> area_region) so the quote equals the
    -- booked charge for free Google-Places picks, not just listed hotels/known areas.
    v_pickup_region := hotel_end_region(
      p ->> 'pickupSlug',
      nullif(p ->> 'pickupLat', '')::double precision,
      nullif(p ->> 'pickupLng', '')::double precision,
      p ->> 'pickupArea');
    v_dropoff_region := hotel_end_region(
      p ->> 'dropoffSlug',
      nullif(p ->> 'dropoffLat', '')::double precision,
      nullif(p ->> 'dropoffLng', '')::double precision,
      p ->> 'dropoffArea');
    v_band := region_distance_band(v_pickup_region, v_dropoff_region);
    v_one_way := hotel_transfer_fare_minor(v_band, v_pax, v_suv);
    select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
    v_zone_or_band := v_band;
  end if;
  v_ret_pct := coalesce(v_ret_pct, 0);
  v_total := case when v_trip_type = 'return'
    then round(v_one_way::numeric * 2 * (100 - v_ret_pct) / 100)::bigint
    else v_one_way end;
  v_vehicle := case
    when v_pax <= 4 then case when v_suv then 'SUV' else 'Sedan' end
    when v_pax <= 6 then 'Family'
    when v_pax <= 14 then 'Van'
    when v_pax <= 25 then 'Coaster'
    else 'Coaster x' || ceil(v_pax::numeric / 25)::int
  end;
  return jsonb_build_object(
    'totalEur', v_total::float / 100,
    'vehicle', v_vehicle,
    'zoneOrBand', v_zone_or_band,
    'tripType', v_trip_type,
    'oneWayEur', v_one_way::float / 100,
    'returnDiscountPct', v_ret_pct
  );
end;
$$;

grant execute on function api_search_transfer_hotels(jsonb) to anon, authenticated, service_role;
grant execute on function api_list_transfer_areas(jsonb) to anon, authenticated, service_role;
grant execute on function api_transfer_quote(jsonb) to anon, authenticated, service_role;

-- ---- 20260742000000_reviews -------------------------------------------------
alter table reviews add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists reviews_user_idx on reviews (user_id);
create unique index if not exists reviews_user_activity_uniq
  on reviews (activity_id, user_id) where user_id is not null;
-- Keep reviews_insert DROPPED (F12): inserts go only through the SECURITY DEFINER api_submit_review,
-- which enforces the booking gate. A direct-insert policy would re-open review forgery.
drop policy if exists reviews_insert on reviews;

create or replace function api_submit_review(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := nullif(p ->> 'slug', '');
  v_rating int := (p ->> 'rating')::int;
  v_text text := nullif(btrim(p ->> 'text'), '');
  v_activity_id uuid;
  v_author text;
  v_review reviews;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_slug is null then
    raise exception 'invalid_request: slug is required';
  end if;
  if v_rating is null or v_rating < 1 or v_rating > 5 then
    raise exception 'invalid_request: rating must be 1..5';
  end if;
  select id into v_activity_id from activities where slug = v_slug;
  if v_activity_id is null then
    raise exception 'activity_not_found';
  end if;
  if not exists (
    select 1
    from bookings b
    join booking_items bi on bi.booking_id = b.id
    join activity_options ao on ao.id = bi.activity_option_id
    where b.user_id = v_uid
      and ao.activity_id = v_activity_id
      and b.status in ('confirmed', 'completed')
  ) then
    raise exception 'forbidden';
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'Traveller') into v_author from profiles where id = v_uid;
  v_author := coalesce(v_author, 'Traveller');
  insert into reviews (activity_id, user_id, author, rating, text)
  values (v_activity_id, v_uid, v_author, v_rating, v_text)
  on conflict (activity_id, user_id) where user_id is not null
  do update set rating = excluded.rating, text = excluded.text, author = excluded.author, created_at = now()
  returning * into v_review;
  update activities a
  set rating_count = sub.cnt,
      rating_avg = case when sub.cnt = 0 then null else round(sub.avg, 1) end
  from (select count(*)::int cnt, avg(rating)::numeric avg from reviews where activity_id = v_activity_id) sub
  where a.id = v_activity_id;
  return jsonb_build_object(
    'id', v_review.id, 'author', v_review.author, 'rating', v_review.rating,
    'text', v_review.text, 'createdAt', v_review.created_at
  );
end;
$$;

create or replace function api_my_reviews(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_page_size int := least(greatest(coalesce((p ->> 'pageSize')::int, 20), 1), 100);
  v_items jsonb;
  v_total int;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  with mine as (
    select r.id, r.rating, r.text, r.created_at, a.slug as activity_slug, a.title as activity_title
    from reviews r
    join activities a on a.id = r.activity_id
    where r.user_id = v_uid
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'activitySlug', m.activity_slug, 'activityTitle', m.activity_title,
        'rating', m.rating, 'text', m.text, 'createdAt', m.created_at
      ) order by m.created_at desc)
      from (select * from mine order by created_at desc limit v_page_size offset (v_page - 1) * v_page_size) m
    ), '[]'::jsonb),
    (select count(*)::int from mine)
  into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

revoke execute on function api_submit_review(jsonb) from public;
revoke execute on function api_my_reviews(jsonb) from public;
grant execute on function api_submit_review(jsonb) to authenticated;
grant execute on function api_my_reviews(jsonb) to authenticated;

-- ---- 20260743000000_activity_filters ----------------------------------------
create or replace function api_search_facets(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select a.duration_minutes,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else (
          select min(pr.amount_minor)
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and a.slug <> all (array['airport-transfer', 'hotel-transfer'])
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
  )
  select jsonb_build_object(
    'priceMinEur', (select min(from_price_minor)::float / 100 from scoped),
    'priceMaxEur', (select max(from_price_minor)::float / 100 from scoped),
    'durationMin', (select min(duration_minutes) from scoped),
    'durationMax', (select max(duration_minutes) from scoped)
  );
$$;

create or replace function api_list_categories(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', c.name, 'slug', c.slug, 'imageUrl', c.image_url
  ) order by c.position, c.name), '[]'::jsonb)
  from categories c
  where c.status = 'active';
$$;

grant execute on function api_search_facets(jsonb) to anon, authenticated, service_role;
grant execute on function api_list_categories(jsonb) to anon, authenticated, service_role;

-- api_search_activities — extended with price/duration/rating filters. Defined LAST so this body wins
-- over the earlier copies in this file (keeps catch-up in parity with 20260743000000_activity_filters).
create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else (
          select min(pr.amount_minor)
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
      and (p ->> 'durationMin' is null or coalesce(a.duration_minutes, 0) >= (p ->> 'durationMin')::int)
      and (p ->> 'durationMax' is null or coalesce(a.duration_minutes, 0) <= (p ->> 'durationMax')::int)
      and (p ->> 'minRating' is null or coalesce(a.rating_avg, 0) >= (p ->> 'minRating')::numeric)
  ),
  priced as (
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
    order by rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', x.from_price_minor::float / 100,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from priced),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- ---- 20260744000000_account_profile -----------------------------------------
create or replace function api_get_profile(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row profiles;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  insert into profiles (id) values (v_uid) on conflict (id) do nothing;
  select * into v_row from profiles where id = v_uid;
  return jsonb_build_object(
    'id', v_row.id, 'fullName', v_row.full_name, 'phone', v_row.phone,
    'dateOfBirth', v_row.date_of_birth, 'role', v_row.role, 'memberSince', v_row.created_at
  );
end;
$$;

create or replace function api_update_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row profiles;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  insert into profiles (id) values (v_uid) on conflict (id) do nothing;
  update profiles set
    full_name = case when p ? 'fullName' then nullif(btrim(p ->> 'fullName'), '') else full_name end,
    phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else phone end,
    date_of_birth = case when p ? 'dateOfBirth' then nullif(p ->> 'dateOfBirth', '')::date else date_of_birth end
  where id = v_uid
  returning * into v_row;
  return jsonb_build_object(
    'id', v_row.id, 'fullName', v_row.full_name, 'phone', v_row.phone,
    'dateOfBirth', v_row.date_of_birth, 'role', v_row.role, 'memberSince', v_row.created_at
  );
end;
$$;

create or replace function api_export_user(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_profile profiles;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = v_uid;
  select * into v_profile from profiles where id = v_uid;
  return jsonb_build_object(
    'profile', jsonb_build_object(
      'fullName', v_profile.full_name, 'phone', v_profile.phone,
      'email', v_email, 'dateOfBirth', v_profile.date_of_birth
    ),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', b.ref, 'status', b.status,
        'date', coalesce(
          (select min(so.starts_at) from booking_items bi
             join session_occurrences so on so.id = bi.session_occurrence_id
            where bi.booking_id = b.id),
          b.created_at),
        'totalEur', b.total_minor::float / 100, 'currency', b.currency,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('label', bi.price_label, 'qty', bi.quantity))
          from booking_items bi where bi.booking_id = b.id
        ), '[]'::jsonb),
        'pickup', b.pickup_location, 'dropoff', b.dropoff_location,
        'gender', b.traveller_gender, 'company', b.traveller_company, 'country', b.traveller_country,
        'specialNotes', b.special_notes, 'roomOrCabin', b.room_or_cabin, 'luggageDetails', b.luggage_details,
        'childSeatAge', b.child_seat_age, 'flightNumber', b.flight_number, 'arrivalTime', b.arrival_time,
        'returnDate', b.return_date, 'returnTime', b.return_time, 'departureFlightNumber', b.departure_flight_number
      ) order by b.created_at desc)
      from bookings b where b.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function api_get_profile(jsonb) from public;
revoke execute on function api_update_profile(jsonb) from public;
revoke execute on function api_export_user(jsonb) from public;
grant execute on function api_get_profile(jsonb) to authenticated;
grant execute on function api_update_profile(jsonb) to authenticated;
grant execute on function api_export_user(jsonb) to authenticated;

-- ===========================================================================================
-- Car & scooter rental fleet (migration 20260747000000) — admin-managed, WhatsApp-only.
-- Purely additive: a content table + a public list RPC. No booking/payment/availability changes.
-- ===========================================================================================

-- 1) rental_vehicles: one row per vehicle on offer. Money in integer EUR cents. `category` is free text
--    (used only for grouping/labels on /rent — scooters vs cars), so the owner can add any class without a
--    schema change. Public read, staff edit (RLS copied verbatim from hotel_transfer_fare).
create table if not exists rental_vehicles (
  slug             text primary key,
  name             text not null,
  category         text not null default 'car',
  seats            int not null default 2,
  transmission     text,
  air_con          boolean not null default true,
  image_url        text,
  daily_rate_minor int not null,
  deposit_minor    int not null default 0,
  sort             int not null default 0,
  active           boolean not null default true,
  updated_at       timestamptz not null default now()
);
insert into rental_vehicles (slug, name, category, seats, transmission, daily_rate_minor, deposit_minor, sort) values
  ('nissan-march',   'Nissan March',   'economy', 5, 'automatic', 3600, 0, 10),
  ('nissan-note',    'Nissan Note',    'economy', 5, 'automatic', 3600, 0, 20),
  ('suzuki-ertiga',  'Suzuki Ertiga',  'family',  7, 'automatic', 3600, 0, 30),
  ('haojue-vx',      'Haojue VX',      'scooter', 2, 'automatic', 2000, 0, 40),
  ('sym-crox',       'SYM Crox',       'scooter', 2, 'automatic', 2000, 0, 50),
  ('suzuki-address', 'Suzuki Address', 'scooter', 2, 'automatic', 2000, 0, 60)
on conflict (slug) do nothing;
alter table rental_vehicles enable row level security;
grant select on rental_vehicles to anon, authenticated, service_role;
grant insert, update, delete on rental_vehicles to authenticated;
drop policy if exists rental_vehicles_read on rental_vehicles;
create policy rental_vehicles_read on rental_vehicles for select using (true);
drop policy if exists rental_vehicles_staff on rental_vehicles;
create policy rental_vehicles_staff on rental_vehicles for all using (is_staff()) with check (is_staff());

-- 2) api_list_rental_vehicles(): the public /rent read — active vehicles only, ordered for display.
--    Mirrors listRentalVehicles() in src/lib/services/rental.ts.
create or replace function api_list_rental_vehicles(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', v.slug,
    'name', v.name,
    'category', v.category,
    'seats', v.seats,
    'transmission', v.transmission,
    'airCon', v.air_con,
    'imageUrl', v.image_url,
    'dailyRateEur', v.daily_rate_minor::float / 100,
    'depositEur', v.deposit_minor::float / 100,
    'sort', v.sort
  ) order by v.sort, v.name), '[]'::jsonb)
  from rental_vehicles v
  where v.active;
$$;
grant execute on function api_list_rental_vehicles(jsonb) to anon, authenticated, service_role;

-- ===========================================================================================
-- Age-band pricing (migration 20260748000000) — per-tier age range for the party selector.
-- Additive columns + api_get_activity re-applied with minAge/maxAge (byte-identical to the
-- migration copy). Prices stay ABSOLUTE; create_booking already prices a multi-tier party.
-- ===========================================================================================
alter table activity_option_prices add column if not exists min_age int;
alter table activity_option_prices add column if not exists max_age int;

create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

-- ===========================================================================================
-- Activity card ordering (migration 20260749000000) — per-activity `sort`, admin drag-reorder.
-- api_search_activities re-applied with order-by `sort, rating_count desc, title` + a reorder RPC.
-- ===========================================================================================
alter table activities add column if not exists sort int not null default 0;

create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else (
          select min(pr.amount_minor)
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
      and (p ->> 'durationMin' is null or coalesce(a.duration_minutes, 0) >= (p ->> 'durationMin')::int)
      and (p ->> 'durationMax' is null or coalesce(a.duration_minutes, 0) <= (p ->> 'durationMax')::int)
      and (p ->> 'minRating' is null or coalesce(a.rating_avg, 0) >= (p ->> 'minRating')::numeric)
  ),
  priced as (
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
    order by sort, rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', x.from_price_minor::float / 100,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from priced),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

create or replace function api_reorder_activities(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update activities a
     set sort = t.ord
    from (
      select value::uuid as id, (ordinality - 1)::int as ord
      from jsonb_array_elements_text(p -> 'ids') with ordinality
    ) t
   where a.id = t.id
     -- Server-enforce the client's "one category at a time" rule (was client-only): an id from another
     -- category won't match, so a bad/multi-category id list can't scramble cross-category order.
     and a.category = (p ->> 'category');
end;
$$;
grant execute on function api_reorder_activities(jsonb) to authenticated;

-- ===========================================================================================
-- "From" price bugfix (migration 20260750000000): exclude free (€0) tiers from the from-price so a
-- free infant band doesn't show "From €0". api_get_activity + api_search_activities re-applied.
-- ===========================================================================================

create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select coalesce(min(pr.amount_minor) filter (where pr.amount_minor > 0), min(pr.amount_minor))::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else (
          select coalesce(min(pr.amount_minor) filter (where pr.amount_minor > 0), min(pr.amount_minor))
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
      and (p ->> 'durationMin' is null or coalesce(a.duration_minutes, 0) >= (p ->> 'durationMin')::int)
      and (p ->> 'durationMax' is null or coalesce(a.duration_minutes, 0) <= (p ->> 'durationMax')::int)
      and (p ->> 'minRating' is null or coalesce(a.rating_avg, 0) >= (p ->> 'minRating')::numeric)
  ),
  priced as (
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
    order by sort, rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', x.from_price_minor::float / 100,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from priced),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- ===========================================================================================
-- "From" = adult for age bands (migration 20260751000000): age-banded activities show the adult
-- (highest) band as "From", not the cheapest tier. api_get_activity + api_search_activities re-applied.
-- ===========================================================================================

create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select (case when bool_or(pr.min_age is not null or pr.max_age is not null) then max(pr.amount_minor) else coalesce(min(pr.amount_minor) filter (where pr.amount_minor > 0), min(pr.amount_minor)) end)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else (
          select (case when bool_or(pr.min_age is not null or pr.max_age is not null) then max(pr.amount_minor) else coalesce(min(pr.amount_minor) filter (where pr.amount_minor > 0), min(pr.amount_minor)) end)
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
      and (p ->> 'durationMin' is null or coalesce(a.duration_minutes, 0) >= (p ->> 'durationMin')::int)
      and (p ->> 'durationMax' is null or coalesce(a.duration_minutes, 0) <= (p ->> 'durationMax')::int)
      and (p ->> 'minRating' is null or coalesce(a.rating_avg, 0) >= (p ->> 'minRating')::numeric)
  ),
  priced as (
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
    order by sort, rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', x.from_price_minor::float / 100,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from priced),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- ===========================================================================================
-- Per-option duration + start time (migration 20260752000000) — one activity, Half/Full-day options
-- with different times. Additive columns + api_get_activity options projection re-applied.
-- ===========================================================================================
alter table activity_options add column if not exists duration_minutes int;
alter table activity_options add column if not exists start_window text;

create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select (case when bool_or(pr.min_age is not null or pr.max_age is not null) then max(pr.amount_minor) else coalesce(min(pr.amount_minor) filter (where pr.amount_minor > 0), min(pr.amount_minor)) end)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description, 'durationMinutes', o.duration_minutes, 'startWindow', o.start_window,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

-- ---- 20260615121000_security_integrity_fixes (profiles role guard) ----------
-- SECURITY (bug sweep 2026-07-06): fold in the profile role-escalation guard that
-- was present in the migrations/setup/bootstrap but MISSING from catch-up.sql. RLS
-- on profiles is row-level only (no column restriction on `role`) and `authenticated`
-- holds a blanket UPDATE grant, so WITHOUT this trigger a normal user could
-- PATCH their own profile with {"role":"admin"} and self-promote. Verbatim from
-- migration 20260615121000 so re-running catch-up.sql self-heals a DB that lost it.
create or replace function enforce_profile_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new; -- service_role / owner / superuser
  end if;
  if is_staff() then
    return new; -- staff & admin may assign roles
  end if;
  if tg_op = 'INSERT' then
    new.role := 'customer';
  else
    new.role := old.role; -- self-update cannot change role
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on profiles;
create trigger profiles_role_guard
  before insert or update on profiles
  for each row execute function enforce_profile_role();

-- ---- bug sweep 2026-07-06: api_create_payment double-charge guard -----------
-- Winning body of api_create_payment (verbatim) + one ADDITIVE return field: a still-fresh checkout
-- already recorded for this pending payment is surfaced as `existingCheckoutId` so the service reuses
-- that Peach session instead of minting a SECOND one (a back/reload/retry before the webhook confirms
-- could otherwise charge the card twice). No existing logic changed; only the returned object grows.
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
  if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
     or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'booking_not_payable' using detail = v_booking.status::text;
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  select * into v_payment from payments
  where booking_id = v_booking.id and status <> 'failed'
  order by created_at desc
  limit 1;

  if not found then
    select * into v_payment from payments where idempotency_key = p ->> 'idempotencyKey';
  end if;

  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
    'existingCheckoutId', case
       when v_payment.provider_checkout_id is not null
            and v_payment.updated_at > now() - interval '25 minutes'
       then v_payment.provider_checkout_id else null end
  );
end;
$$;

-- ===========================================================================================
-- Private option with its own capacity pool (migration 20260801000000) — per-option daily_capacity
-- + private base/per-head pricing; trips/day counting via the vehicle-mode contract (qty=1 + pax).
-- ===========================================================================================
-- Private option with its own capacity pool (2026-07-07).
-- Some activities offer a PRIVATE option next to the shared/standard one (e.g. a boat that sails
-- shared most days but can be chartered privately). Product decisions (owner):
--   * independent pools — the private option's capacity is separate from the standard option's;
--   * the private pool counts TRIPS per day (1 booking = 1 unit, any group size);
--   * private price = flat base covering the first `private_included` guests (default 4)
--     + `private_extra_minor` per additional guest, admin-set per activity;
--   * `private_max_guests` caps the party.
-- Occurrences were ALREADY per option (unique (activity_option_id, starts_at)) and every capacity
-- gate (used_capacity, create_hold, append_payment_event) counts per occurrence, so the pools were
-- always independent — only the capacity SOURCE was activity-wide. This migration adds a per-option
-- capacity source + the private pricing branch, mirroring the vehicle-mode contract exactly:
-- hold quantity = 1, ONE booking_items row with quantity = 1 and the headcount in `pax`, so
-- append_payment_event / used_capacity / create_hold need no changes at all.
--
-- Re-applied winning bodies (verbatim + delta, per the revert-drift rule):
--   set_daily_capacity_atomic  (20260617220000)  + optionId / inherit paths; activity path skips overrides
--   materialize_availability   (20260718120000)  + coalesce(option, activity) capacity; private price-gate
--   api_create_hold            (20260617210000)  + private holds ONE unit
--   create_booking             (20260617210000)  + private pricing branch (first) + single pax item
--   api_book                   (20260746000000)  + private books ONE unit
--   api_get_activity           (20260752000000)  + per-option private config in the DTO

-- 1) Per-option config: the private flag IS `private_base_minor is not null` (the completeness
--    constraint keeps half-configured rows out); `daily_capacity` (nullable) is the option's own
--    pool size — null inherits the activity's number. activities.daily_capacity stays the master
--    ON/OFF switch for the whole activity.
alter table activity_options
  add column if not exists private_base_minor  int check (private_base_minor  is null or private_base_minor  >= 0),
  add column if not exists private_included    int check (private_included    is null or private_included    >= 1),
  add column if not exists private_extra_minor int check (private_extra_minor is null or private_extra_minor >= 0),
  add column if not exists private_max_guests  int check (private_max_guests  is null or private_max_guests  >= 1),
  add column if not exists daily_capacity      int check (daily_capacity      is null or daily_capacity      >= 0);
do $$
begin
  alter table activity_options add constraint activity_options_private_complete check (
    private_base_minor is null
    or (private_included is not null and private_extra_minor is not null
        and private_max_guests is not null and private_max_guests >= private_included));
exception when duplicate_object then null;
end $$;

-- 2) set_daily_capacity_atomic: option-scoped capacity writes. The activity-wide path no longer
--    stomps an option that has its own pool; optionId targets one option; inherit clears back.
create or replace function set_daily_capacity_atomic(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id uuid := nullif(p ->> 'activityId', '')::uuid;
  v_capacity int := (p ->> 'capacity')::int;
  v_option_id uuid := nullif(p ->> 'optionId', '')::uuid;
  v_inherit boolean := coalesce((p ->> 'inherit')::boolean, false);
  v_activity_capacity int;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_activity_id is null then
    raise exception 'invalid_request';
  end if;
  if v_option_id is not null and v_inherit then
    -- Clear the option's override; its future occurrences fall back to the activity number.
    update activity_options set daily_capacity = null
     where id = v_option_id and activity_id = v_activity_id;
    if not found then
      raise exception 'invalid_request';
    end if;
    select daily_capacity into v_activity_capacity from activities where id = v_activity_id;
    if v_activity_capacity is not null then
      update session_occurrences so
         set capacity = v_activity_capacity
       where so.activity_option_id = v_option_id
         and so.starts_at >= now();
    end if;
  elsif v_option_id is not null then
    -- Option-scoped pool: only this option's number + future occurrences change.
    if v_capacity is null or v_capacity < 0 then
      raise exception 'invalid_request';
    end if;
    update activity_options set daily_capacity = v_capacity
     where id = v_option_id and activity_id = v_activity_id;
    if not found then
      raise exception 'invalid_request';
    end if;
    update session_occurrences so
       set capacity = v_capacity
     where so.activity_option_id = v_option_id
       and so.starts_at >= now();
  else
    if v_capacity is null or v_capacity < 0 then
      raise exception 'invalid_request';
    end if;
    update activities set daily_capacity = v_capacity where id = v_activity_id;
    update session_occurrences so
       set capacity = v_capacity
      from activity_options o
     where so.activity_option_id = o.id
       and o.activity_id = v_activity_id
       and o.daily_capacity is null
       and so.starts_at >= now();
  end if;
  perform materialize_availability(jsonb_build_object('activityId', v_activity_id::text));
end;
$$;
revoke execute on function set_daily_capacity_atomic(jsonb) from public;
grant execute on function set_daily_capacity_atomic(jsonb) to authenticated, service_role;

-- 3) materialize_availability: occurrences take the OPTION's capacity when set (else the activity's),
--    an option paused at 0 neither reopens nor materializes, and a private option (which carries no
--    price tiers) still materializes.
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
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
  v_count int;
begin
  if not (is_staff() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

  update session_occurrences so
     set status = 'open'
    from activity_options o
    join activities a on a.id = o.activity_id
   where so.activity_option_id = o.id
     and so.status = 'closed'
     and so.starts_at > now()
     and a.status = 'published'
     and coalesce(a.daily_capacity, 0) > 0
     and coalesce(o.daily_capacity, a.daily_capacity, 0) > 0
     and (v_activity_id is null or a.id = v_activity_id);

  insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
  select o.id,
         a.operator_id,
         (d::date + time '12:00') at time zone 'Indian/Mauritius',
         ((d::date + time '12:00') at time zone 'Indian/Mauritius') + make_interval(mins => coalesce(a.duration_minutes, 240)),
         coalesce(o.daily_capacity, a.daily_capacity),
         'open'
  from activities a
  join activity_options o on o.activity_id = a.id
  cross join generate_series(v_today, v_today + v_days, interval '1 day') d
  where a.status = 'published'
    and coalesce(a.daily_capacity, 0) > 0
    and coalesce(o.daily_capacity, a.daily_capacity, 0) > 0
    and (v_activity_id is null or a.id = v_activity_id)
    and (
      exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
      or o.private_base_minor is not null
    )
    and not exists (
      select 1 from session_occurrences x
      where x.activity_option_id = o.id
        and (x.starts_at at time zone 'Indian/Mauritius')::date = d::date
    )
  on conflict (activity_option_id, starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 4) api_create_hold: a private option reserves ONE unit (its pool counts trips/day), like vehicles.
create or replace function api_create_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_people bigint := coalesce((p ->> 'people')::bigint, 0);
  v_mode text := 'per_person';
  v_is_private boolean := false;
  v_qty int;
  v_hold booking_holds;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;
  if v_people <= 0 or v_people > 1000000 then
    raise exception 'invalid_party';
  end if;
  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  select a.pricing_mode, (o.private_base_minor is not null)
    into v_mode, v_is_private
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_qty := case when coalesce(v_mode, 'per_person') in ('vehicle', 'vehicle_custom')
                  or coalesce(v_is_private, false) then 1 else v_people::int end;

  v_hold := create_hold(v_occ, v_qty, v_key);
  return jsonb_build_object('holdId', v_hold.id, 'quantity', v_hold.quantity, 'expiresAt', v_hold.expires_at);
end;
$$;
grant execute on function api_create_hold(jsonb) to anon, authenticated, service_role;

-- 5) create_booking: private pricing branch (base + per-extra-head), checked before the mode branches
--    because it is OPTION-level config under an unchanged activity pricing_mode.
create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb,
  p_suv boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_vehicle text;
  v_sedan bigint;
  v_suv_price bigint;
  v_family bigint;
  v_van bigint;
  v_coaster bigint;
  v_pl_standard bigint;
  v_pl_suv bigint;
  v_pl_six bigint;
  v_pl_van bigint;
  v_pl_coach bigint;
  v_pl_max int;
  v_pb bigint;
  v_pi int;
  v_pe bigint;
  v_pm int;
  v_opt_name text;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  select a.pricing_mode into v_mode
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  select private_base_minor, private_included, private_extra_minor, private_max_guests, name
    into v_pb, v_pi, v_pe, v_pm, v_opt_name
  from activity_options
  where id = v_option_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_pb is not null then
    -- Private option (option-level flag): a flat base covers the first v_pi guests, v_pe per extra
    -- head. Counted like a vehicle: ONE capacity unit per booking (the pool is trips/day), with the
    -- real headcount recorded in pax on the single line item below.
    if v_qty_total < 1 or v_qty_total > v_pm then
      raise exception 'exceeds_max_guests' using detail = format('private: %s > %s', v_qty_total, v_pm);
    end if;
    v_total := v_pb + v_pe * greatest(0, v_qty_total - v_pi);
    v_vehicle := coalesce(nullif(v_opt_name, ''), 'Private');
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('private hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle' then
    -- One flat price for the bracket that fits P = v_qty_total (people on board). (Unchanged.)
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select sedan_minor, suv_minor, family_minor, van_minor, coaster_minor
      into v_sedan, v_suv_price, v_family, v_van, v_coaster
      from sightseeing_pricing limit 1;
    if v_sedan is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_suv_price;
        v_vehicle := 'SUV';
      else
        v_total := v_sedan;
        v_vehicle := 'Sedan';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_family;
      v_vehicle := 'Family car';
    elsif v_qty_total <= 14 then
      v_total := v_van;
      v_vehicle := 'Van';
    else
      v_total := v_coaster;
      v_vehicle := 'Coaster';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle_custom' then
    -- Parallel planner path: same bracket shape, the planner's own prices/names + cap.
    select standard_minor, suv_minor, six_minor, van_minor, coach_minor, max_party
      into v_pl_standard, v_pl_suv, v_pl_six, v_pl_van, v_pl_coach, v_pl_max
      from planner_pricing limit 1;
    if v_pl_standard is null then
      raise exception 'planner_pricing_unset';
    end if;
    if v_qty_total < 1 or v_qty_total > v_pl_max then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_pl_suv;
        v_vehicle := 'SUV';
      else
        v_total := v_pl_standard;
        v_vehicle := 'Standard car';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_pl_six;
      v_vehicle := '6-seater';
    elsif v_qty_total <= 14 then
      v_total := v_pl_van;
      v_vehicle := 'Van';
    else
      v_total := v_pl_coach;
      v_vehicle := 'Coach';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: price each aggregated tier from the DB. (Unchanged.)
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch'
        using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_pb is not null or v_mode in ('vehicle', 'vehicle_custom') then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (
      v_booking.id, v_hold.session_occurrence_id, v_option_id, v_vehicle,
      1, v_total, v_total, v_qty_total
    );
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case
          when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
          else v_unit * v_qty
        end
      );
    end loop;
  end if;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to anon, authenticated, service_role;

-- 6) api_book: same ONE-unit rule at the book step (hold reuse + fresh-hold path both see it).
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
  v_mode text := 'per_person';
  v_is_private boolean := false;
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
  v_is_airport boolean := false;
  v_is_hotel boolean := false;
  v_dropoff_zone text;
  v_trip_type text;
  v_trip_direction text;
  v_ret_pct int;
  v_fare bigint;
  v_hotel_pickup_region text;
  v_hotel_dropoff_region text;
  v_band text;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false),
         coalesce(a.is_hotel_transfer, false),
         (o.private_base_minor is not null)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel, v_is_private
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom')
                       or coalesce(v_is_private, false) then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid())
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  -- Airport transfer (server-authoritative, zero-trust): the destination ZONE comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent zone. When the guest's hotel isn't listed
  -- (no dropoffSlug), classify the zone from the supplied AREA instead (Zone 2 = the near-airport
  -- south-east areas), still never trusting a client price. The whole fare is the zone × vehicle matrix
  -- (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    v_trip_direction := case
      when (p ->> 'tripDirection') in ('arrival', 'departure', 'return') then p ->> 'tripDirection'
      when (p ->> 'tripType') = 'return' then 'return'
      else 'arrival'
    end;
    v_trip_type := case when v_trip_direction = 'return' then 'return' else 'one_way' end;
    if nullif(p ->> 'dropoffSlug', '') is not null then
      select zone into v_dropoff_zone from airport_transfer_hotels
        where slug = nullif(p ->> 'dropoffSlug', '');
    end if;
    if v_dropoff_zone is null then
      v_dropoff_zone := airport_transfer_area_zone(p ->> 'dropoffArea');
    end if;
    v_fare := airport_transfer_fare_minor(v_dropoff_zone, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        trip_direction = v_trip_direction,
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        child_seat_age = nullif(p ->> 'childSeatAge', '')::int,
        traveller_gender = left(nullif(btrim(p ->> 'travellerGender'), ''), 20),
        traveller_company = left(nullif(btrim(p ->> 'travellerCompany'), ''), 120),
        traveller_country = left(nullif(btrim(p ->> 'travellerCountry'), ''), 80),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  -- Hotel-to-hotel transfer (server-authoritative, zero-trust): derive BOTH endpoints' regions from the
  -- hotel SLUGS via airport_transfer_hotels (or area_region() for a free-text end), reject a same-hotel
  -- trip, classify the distance band (region_distance_band), and price band × vehicle (× return discount).
  -- OVERRIDE the booking total + payout + line item. Mirrors hotelTransferQuoteMinor() in pricing.ts.
  if v_is_hotel then
    if nullif(p ->> 'pickupSlug', '') is not null
       and nullif(p ->> 'pickupSlug', '') = nullif(p ->> 'dropoffSlug', '') then
      raise exception 'same_hotel';
    end if;
    v_trip_type := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
    v_hotel_pickup_region := hotel_end_region(
      p ->> 'pickupSlug',
      nullif(p ->> 'pickupLat', '')::double precision,
      nullif(p ->> 'pickupLng', '')::double precision,
      p ->> 'pickupArea');
    v_hotel_dropoff_region := hotel_end_region(
      p ->> 'dropoffSlug',
      nullif(p ->> 'dropoffLat', '')::double precision,
      nullif(p ->> 'dropoffLng', '')::double precision,
      p ->> 'dropoffArea');
    v_band := region_distance_band(v_hotel_pickup_region, v_hotel_dropoff_region);
    v_fare := hotel_transfer_fare_minor(v_band, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        pickup_hotel_slug = left(nullif(btrim(p ->> 'pickupSlug'), ''), 120),
        pickup_region = v_hotel_pickup_region,
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 7) api_get_activity: expose the per-option private config so the widget can price locally
--    (the server stays authoritative at booking).
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select (case when bool_or(pr.min_age is not null or pr.max_age is not null) then max(pr.amount_minor) else coalesce(min(pr.amount_minor) filter (where pr.amount_minor > 0), min(pr.amount_minor)) end)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description, 'durationMinutes', o.duration_minutes, 'startWindow', o.start_window,
        'privateBaseEur', o.private_base_minor::float / 100,
        'privateIncluded', o.private_included,
        'privateExtraEur', o.private_extra_minor::float / 100,
        'privateMaxGuests', o.private_max_guests,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

-- Private-only activities showed "On request" on listing/search cards.
-- api_search_activities derived a card's `from_price_minor` purely from activity_option_prices; a
-- PRIVATE option carries no tier rows (its price is base + €/extra-head), so the subquery returned
-- NULL → "On request" in every grid. This re-applies the winning api_search_activities body VERBATIM
-- (from 20260751000000_from_price_adult_for_agebands.sql) with ONE additive change: the non-vehicle
-- branch now coalesces to the cheapest private option's base, so a private-only activity shows
-- "From €X" and is price-filterable. Tier prices still win when present (a mixed standard+private
-- activity keeps its per-person "from"), matching the client-side activityFromPriceEur() fallback.
create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else coalesce(
          (
            select (case when bool_or(pr.min_age is not null or pr.max_age is not null) then max(pr.amount_minor) else coalesce(min(pr.amount_minor) filter (where pr.amount_minor > 0), min(pr.amount_minor)) end)
            from activity_option_prices pr
            join activity_options o on o.id = pr.activity_option_id
            where o.activity_id = a.id
          ),
          (
            select min(o.private_base_minor)
            from activity_options o
            where o.activity_id = a.id and o.private_base_minor is not null
          )
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
      and (p ->> 'durationMin' is null or coalesce(a.duration_minutes, 0) >= (p ->> 'durationMin')::int)
      and (p ->> 'durationMax' is null or coalesce(a.duration_minutes, 0) <= (p ->> 'durationMax')::int)
      and (p ->> 'minRating' is null or coalesce(a.rating_avg, 0) >= (p ->> 'minRating')::numeric)
  ),
  priced as (
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
    order by sort, rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', x.from_price_minor::float / 100,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from priced),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- Listing cards for a private-only activity showed the "From €X" price but no group size, because
-- the private "base covers up to N guests" count (private_included) wasn't surfaced. A private option's
-- pricing_mode is still per_person (privateness is per-OPTION), so the card can't infer it from the mode.
-- This re-applies the winning api_search_activities body VERBATIM (from 20260802000000_from_price_private_base.sql)
-- with ONE additive output key: `fromPriceIncluded` = the cheapest private option's private_included,
-- emitted ONLY when the from-price came from a private base (no tier prices) — so a card can show
-- "from €650 · up to 4". Null for every non-private activity, so no other card changes.
create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else coalesce(
          (
            select (case when bool_or(pr.min_age is not null or pr.max_age is not null) then max(pr.amount_minor) else coalesce(min(pr.amount_minor) filter (where pr.amount_minor > 0), min(pr.amount_minor)) end)
            from activity_option_prices pr
            join activity_options o on o.id = pr.activity_option_id
            where o.activity_id = a.id
          ),
          (
            select min(o.private_base_minor)
            from activity_options o
            where o.activity_id = a.id and o.private_base_minor is not null
          )
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
      and (p ->> 'durationMin' is null or coalesce(a.duration_minutes, 0) >= (p ->> 'durationMin')::int)
      and (p ->> 'durationMax' is null or coalesce(a.duration_minutes, 0) <= (p ->> 'durationMax')::int)
      and (p ->> 'minRating' is null or coalesce(a.rating_avg, 0) >= (p ->> 'minRating')::numeric)
  ),
  priced as (
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
    order by sort, rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', x.from_price_minor::float / 100,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'fromPriceIncluded', case
          when x.pricing_mode = 'vehicle'
            or exists (
              select 1 from activity_option_prices pr
              join activity_options o on o.id = pr.activity_option_id
              where o.activity_id = x.id
            ) then null
          else (
            select o.private_included
            from activity_options o
            where o.activity_id = x.id and o.private_base_minor is not null
            order by o.private_base_minor asc
            limit 1
          )
        end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from priced),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

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

-- Bug sweep 2026-07-11 -- SQL batch. Every function below re-applies its current WINNING body
-- verbatim (extracted programmatically from the live catch-up state) plus the one described delta,
-- so no prior feature can silently revert ([[gytm-migration-revert-drift]]).
--
-- Fixes:
--  1. from-price: per-OPTION front price, then min across options (was max across the whole activity
--     once ANY option had an age band -- Catamaran Sunset Cruise advertised From EUR 70 vs its EUR 50 entry).
--  2. create_booking rejects EUR 0 totals (all-free parties) -- a 0-amount payment otherwise flips 'paid'
--     on any event; append_payment_event also requires amount > 0 for the paid state (belt & braces).
--  3. api_create_payment idempotency-key lookup is scoped to the booking.
--  4. Re-pay checkout ids are preserved (prev_provider_checkout_id) and the reconcile sweep queries
--     BOTH, so a capture on a revived old checkout can no longer be stranded.
--  5. claim_notifications surfaces rows stranded pending at the attempts cap as 'failed'.
--  6. bookings -> refund_pending now alerts the customer + owner + staff bell (was silent), except when
--     the cancel flow already queued its own alert.
--  7. api_cancel_booking's owner alert uses the 'owner' recipient sentinel (single source of truth).
--  8. GDPR erase: booking-linked outbox rows keep their recipient (owner rows survive; payload still
--     scrubbed), and staff bell rows are rebuilt without the customer's name.

alter table payments add column if not exists prev_provider_checkout_id text;


create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else coalesce(
          (
            -- Per-OPTION front price, then the cheapest across options: a banded option fronts its
            -- adult (max) tier; a plain option its cheapest non-free tier. Aggregating across the whole
            -- ACTIVITY made any age band inflate the headline to the priciest option's adult rate.
            select min(case when opt.banded then opt.max_amt else coalesce(opt.min_paid, opt.min_amt) end)
            from (
              select bool_or(pr.min_age is not null or pr.max_age is not null) as banded,
                     max(pr.amount_minor) as max_amt,
                     min(pr.amount_minor) filter (where pr.amount_minor > 0) as min_paid,
                     min(pr.amount_minor) as min_amt
              from activity_option_prices pr
              join activity_options o on o.id = pr.activity_option_id
              where o.activity_id = a.id
              group by pr.activity_option_id
            ) opt
          ),
          (
            select min(o.private_base_minor)
            from activity_options o
            where o.activity_id = a.id and o.private_base_minor is not null
          )
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
      and (p ->> 'durationMin' is null or coalesce(a.duration_minutes, 0) >= (p ->> 'durationMin')::int)
      and (p ->> 'durationMax' is null or coalesce(a.duration_minutes, 0) <= (p ->> 'durationMax')::int)
      and (p ->> 'minRating' is null or coalesce(a.rating_avg, 0) >= (p ->> 'minRating')::numeric)
  ),
  priced as (
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
    order by sort, rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', x.from_price_minor::float / 100,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'fromPriceIncluded', case
          when x.pricing_mode = 'vehicle'
            or exists (
              select 1 from activity_option_prices pr
              join activity_options o on o.id = pr.activity_option_id
              where o.activity_id = x.id
            ) then null
          else (
            select o.private_included
            from activity_options o
            where o.activity_id = x.id and o.private_base_minor is not null
            order by o.private_base_minor asc
            limit 1
          )
        end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from priced),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        -- Per-OPTION front price, then min across options (mirrors api_search_activities).
        select min(case when opt.banded then opt.max_amt else coalesce(opt.min_paid, opt.min_amt) end)::float / 100
        from (
          select bool_or(pr.min_age is not null or pr.max_age is not null) as banded,
                 max(pr.amount_minor) as max_amt,
                 min(pr.amount_minor) filter (where pr.amount_minor > 0) as min_paid,
                 min(pr.amount_minor) as min_amt
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
          group by pr.activity_option_id
        ) opt
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description, 'durationMinutes', o.duration_minutes, 'startWindow', o.start_window,
        'privateBaseEur', o.private_base_minor::float / 100,
        'privateIncluded', o.private_included,
        'privateExtraEur', o.private_extra_minor::float / 100,
        'privateMaxGuests', o.private_max_guests,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb,
  p_suv boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_vehicle text;
  v_sedan bigint;
  v_suv_price bigint;
  v_family bigint;
  v_van bigint;
  v_coaster bigint;
  v_pl_standard bigint;
  v_pl_suv bigint;
  v_pl_six bigint;
  v_pl_van bigint;
  v_pl_coach bigint;
  v_pl_max int;
  v_pb bigint;
  v_pi int;
  v_pe bigint;
  v_pm int;
  v_opt_name text;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  select a.pricing_mode into v_mode
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  select private_base_minor, private_included, private_extra_minor, private_max_guests, name
    into v_pb, v_pi, v_pe, v_pm, v_opt_name
  from activity_options
  where id = v_option_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_pb is not null then
    -- Private option (option-level flag): a flat base covers the first v_pi guests, v_pe per extra
    -- head. Counted like a vehicle: ONE capacity unit per booking (the pool is trips/day), with the
    -- real headcount recorded in pax on the single line item below.
    if v_qty_total < 1 or v_qty_total > v_pm then
      raise exception 'exceeds_max_guests' using detail = format('private: %s > %s', v_qty_total, v_pm);
    end if;
    v_total := v_pb + v_pe * greatest(0, v_qty_total - v_pi);
    v_vehicle := coalesce(nullif(v_opt_name, ''), 'Private');
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('private hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle' then
    -- One flat price for the bracket that fits P = v_qty_total (people on board). (Unchanged.)
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select sedan_minor, suv_minor, family_minor, van_minor, coaster_minor
      into v_sedan, v_suv_price, v_family, v_van, v_coaster
      from sightseeing_pricing limit 1;
    if v_sedan is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_suv_price;
        v_vehicle := 'SUV';
      else
        v_total := v_sedan;
        v_vehicle := 'Sedan';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_family;
      v_vehicle := 'Family car';
    elsif v_qty_total <= 14 then
      v_total := v_van;
      v_vehicle := 'Van';
    else
      v_total := v_coaster;
      v_vehicle := 'Coaster';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle_custom' then
    -- Parallel planner path: same bracket shape, the planner's own prices/names + cap.
    select standard_minor, suv_minor, six_minor, van_minor, coach_minor, max_party
      into v_pl_standard, v_pl_suv, v_pl_six, v_pl_van, v_pl_coach, v_pl_max
      from planner_pricing limit 1;
    if v_pl_standard is null then
      raise exception 'planner_pricing_unset';
    end if;
    if v_qty_total < 1 or v_qty_total > v_pl_max then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_pl_suv;
        v_vehicle := 'SUV';
      else
        v_total := v_pl_standard;
        v_vehicle := 'Standard car';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_pl_six;
      v_vehicle := '6-seater';
    elsif v_qty_total <= 14 then
      v_total := v_pl_van;
      v_vehicle := 'Van';
    else
      v_total := v_pl_coach;
      v_vehicle := 'Coach';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: price each aggregated tier from the DB. (Unchanged.)
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch'
        using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  -- A EUR 0 booking must never exist: an all-free party (infants only) would otherwise mint a
  -- zero-amount payment that flips 'paid' on any event. The client blocks free-only parties;
  -- enforce it zero-trust here too.
  if v_total <= 0 then
    raise exception 'zero_total';
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_pb is not null or v_mode in ('vehicle', 'vehicle_custom') then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (
      v_booking.id, v_hold.session_occurrence_id, v_option_id, v_vehicle,
      1, v_total, v_total, v_qty_total
    );
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case
          when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
          else v_unit * v_qty
        end
      );
    end loop;
  end if;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

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
  if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
     or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'booking_not_payable' using detail = v_booking.status::text;
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  select * into v_payment from payments
  where booking_id = v_booking.id and status <> 'failed'
  order by created_at desc
  limit 1;

  if not found then
    -- Scoped to THIS booking: an unscoped key lookup let a caller echo another payment's key and
    -- receive that payment's id/amount back.
    select * into v_payment from payments
    where idempotency_key = p ->> 'idempotencyKey' and booking_id = v_booking.id;
  end if;

  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
    'existingCheckoutId', case
       when v_payment.provider_checkout_id is not null
            and v_payment.updated_at > now() - interval '25 minutes'
       then v_payment.provider_checkout_id else null end
  );
end;
$$;

create or replace function append_payment_event(
  p_payment_id uuid,
  p_type text,
  p_provider_event_id text,
  p_amount_minor bigint,
  p_occurred_at timestamptz,
  p_payload jsonb
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_paid bigint;
  v_refunded bigint;
  v_failed boolean;
  v_state payment_state;
  v_booking_status booking_status;
  v_occ_id uuid;
  v_needed bigint;
  v_cap bigint;
  v_used_conf bigint;
  v_used_hold bigint;
  v_oversold boolean := false;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  insert into payment_events (payment_id, type, provider_event_id, amount_minor, occurred_at, payload)
  values (
    p_payment_id, p_type, p_provider_event_id, coalesce(p_amount_minor, 0),
    coalesce(p_occurred_at, now()), coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (payment_id, provider_event_id) do nothing;

  select
    coalesce(sum(amount_minor) filter (where type in ('paid', 'captured')), 0),
    coalesce(sum(amount_minor) filter (where type = 'refunded'), 0),
    bool_or(type = 'failed')
  into v_paid, v_refunded, v_failed
  from payment_events
  where payment_id = p_payment_id;

  if v_paid > 0 and v_refunded >= v_paid then
    v_state := 'refunded';
  elsif v_paid > 0 and v_refunded > 0 then
    v_state := 'partially_refunded';
  -- amount_minor > 0: a zero-amount payment must never read as fully paid (0 >= 0) -- the 'failed'
  -- branch below has to win for it.
  elsif v_payment.amount_minor > 0 and v_paid >= v_payment.amount_minor then
    v_state := 'paid';
  elsif v_paid > 0 then
    v_state := 'pending'; -- underpaid: do not confirm
  elsif coalesce(v_failed, false) then
    v_state := 'failed';
  else
    v_state := 'pending';
  end if;

  update payments
  set status = v_state, paid_minor = v_paid, refunded_minor = v_refunded, updated_at = now()
  where id = p_payment_id
  returning * into v_payment;

  update bookings set payment_state = v_state, updated_at = now() where id = v_payment.booking_id;

  if v_state = 'paid' then
    select status into v_booking_status from bookings where id = v_payment.booking_id;

    if v_booking_status in ('draft', 'held', 'payment_pending') then
      -- Re-validate capacity per occurrence, excluding this booking's own items/holds.
      for v_occ_id in
        select distinct session_occurrence_id from booking_items where booking_id = v_payment.booking_id
      loop
        perform 1 from session_occurrences where id = v_occ_id for update;
        select coalesce(sum(quantity), 0) into v_needed
        from booking_items where booking_id = v_payment.booking_id and session_occurrence_id = v_occ_id;
        select capacity into v_cap from session_occurrences where id = v_occ_id;
        select coalesce(sum(bi.quantity), 0) into v_used_conf
        from booking_items bi join bookings b on b.id = bi.booking_id
        where bi.session_occurrence_id = v_occ_id
          and b.status in ('confirmed', 'completed')
          and b.id <> v_payment.booking_id;
        select coalesce(sum(h.quantity), 0) into v_used_hold
        from booking_holds h
        where h.session_occurrence_id = v_occ_id
          and h.status = 'active' and h.expires_at > now()
          and (h.booking_id is null or h.booking_id <> v_payment.booking_id);
        if v_needed > v_cap - v_used_conf - v_used_hold then
          v_oversold := true;
        end if;
      end loop;

      if v_oversold then
        update bookings set status = 'refund_pending', updated_at = now() where id = v_payment.booking_id;
      else
        update bookings set status = 'confirmed', updated_at = now() where id = v_payment.booking_id;
        update booking_holds set status = 'consumed'
        where booking_id = v_payment.booking_id and status = 'active';
      end if;
    elsif v_booking_status not in ('confirmed', 'completed') then
      -- Money captured on an expired/cancelled booking: must be refunded, not confirmed.
      update bookings set status = 'refund_pending', updated_at = now() where id = v_payment.booking_id;
    end if;
  elsif v_state = 'refunded' then
    update bookings set status = 'refunded', updated_at = now()
    where id = v_payment.booking_id and status <> 'cancelled';
    update booking_holds set status = 'released'
    where booking_id = v_payment.booking_id and status = 'active';
  end if;

  return v_payment;
end;
$$;

create or replace function api_record_payment_checkout(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_checkout: paymentId required';
  end if;

  -- IDOR guard: SECURITY DEFINER bypasses payments RLS, so authorize here. Only staff or the booking's
  -- owner may record a charge. auth.uid() must be non-null, else `null = null` is NULL (not false).
  if not (is_staff() or exists (
    select 1 from payments pay
    join bookings b on b.id = pay.booking_id
    where pay.id = v_payment_id and auth.uid() is not null and b.user_id = auth.uid()
  )) then
    raise exception 'forbidden';
  end if;

  -- OVERWRITE (latest checkout wins): a re-pay opens a new checkout the sweep must query, so the most
  -- recent checkout id replaces any prior one — no record-once guard here.
  update payments
  set prev_provider_checkout_id = case
        when provider_checkout_id is not null
             and provider_checkout_id is distinct from left(btrim(p ->> 'checkoutId'), 128)
        then provider_checkout_id
        else prev_provider_checkout_id
      end,
      provider_checkout_id = left(btrim(p ->> 'checkoutId'), 128)
  where id = v_payment_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function api_pending_payment_checkouts(p jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('ref', t.ref, 'paymentId', t.payment_id, 'checkoutId', t.provider_checkout_id)
      order by t.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    -- latest payment per booking (a re-pay opens a fresh checkout the sweep must query), then the
    -- most-recent stuck bookings up to the batch cap. The two orderings need separate query levels:
    -- distinct-on requires its leading sort be (b.id, pay.created_at), so recency + limit wrap it.
    -- LATERAL over (current, previous) checkout ids: a customer can complete a checkout minted
    -- before a re-pay overwrote the pointer (Peach sessions stay completable ~30 min) -- sweeping
    -- both ids means that capture is ingested instead of stranded.
    select c.ref, c.payment_id, v.checkout_id as provider_checkout_id, c.created_at
    from (
      select distinct on (b.id)
             b.id, b.ref, b.created_at, pay.id as payment_id, pay.provider_checkout_id, pay.prev_provider_checkout_id
        from bookings b
        join payments pay on pay.booking_id = b.id
       where b.status = 'payment_pending'
         and b.payment_state = 'pending'
         and b.created_at > now() - make_interval(
               mins => least(greatest(coalesce((p ->> 'graceMinutes')::int, 240), 1), 10080)
             )
         and pay.provider_checkout_id is not null
         and not exists (
               select 1 from payment_events pe
                where pe.payment_id = pay.id and pe.type in ('paid', 'refunded')
             )
       order by b.id, pay.created_at desc
    ) c
    cross join lateral (values (c.provider_checkout_id), (c.prev_provider_checkout_id)) as v(checkout_id)
    where v.checkout_id is not null
    -- recency-ordered batch, capped (default 100, hard ceiling 1000) to bound Peach API calls per run
    order by c.created_at desc
    limit least(greatest(coalesce((p ->> 'limit')::int, 100), 1), 1000)
  ) t;
$$;

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
  -- Surface rows stranded by claim-then-crash cycles: attempts reached the cap while status stayed
  -- 'pending' -- invisible to both the claim filter (attempts < 5) and failed-row queries. Flip them
  -- to a queryable terminal 'failed'.
  update notification_outbox
     set status = 'failed', last_error = coalesce(last_error, 'attempts_exhausted')
   where status = 'pending' and attempts >= 5 and (locked_until is null or locked_until < now());

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
    returning o.id, o.channel, o.recipient, o.template, o.payload, o.booking_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'channel', channel, 'recipient', recipient, 'template', template,
    'payload', payload, 'bookingId', booking_id
  )), '[]'::jsonb)
  into v_rows
  from upd;
  return v_rows;
end;
$$;

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

create or replace function api_cancel_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(p ->> 'ref', '');
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_starts_at timestamptz;
begin
  if v_ref is null then
    raise exception 'invalid_request' using detail = 'cancel: ref required';
  end if;

  select * into v_booking from bookings where ref = v_ref;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Ownership: the booking's own customer, or staff. (A definer function bypasses RLS — check here.)
  if not (is_staff() or (v_uid is not null and v_booking.user_id = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: already cancelled / refund in flight / refunded → return current state, no re-enqueue.
  if v_booking.status in ('refund_pending', 'cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', v_booking.status, 'alreadyCancelled', true);
  end if;

  -- Only a confirmed, paid booking can be self-cancelled for a refund.
  if not (v_booking.status = 'confirmed' and v_booking.payment_state = 'paid') then
    raise exception 'not_cancellable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- The 24-hour window: the EARLIEST occurrence on this booking must start more than 24h from now.
  select min(so.starts_at) into v_starts_at
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_booking.id;
  if v_starts_at is null or v_starts_at <= now() + interval '24 hours' then
    raise exception 'cancellation_window_passed'
      using detail = 'self-service cancellation closes 24 hours before the activity';
  end if;

  -- Cancel → refund_pending (refund_pending frees used_capacity, so the seat is resellable at once). The
  -- actual money movement is recorded later through api_mark_refunded → append_payment_event.
  update bookings set status = 'refund_pending', updated_at = now() where id = v_booking.id;

  -- Heads-up to the owner to process the refund (best-effort; the admin refund_pending queue is the
  -- authoritative work-list). The idempotency key stops a double-cancel enqueuing twice.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'booking_cancellation',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'booking_cancellation:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', 'refund_pending');
end;
$$;

create or replace function api_erase_user(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := nullif(p ->> 'userId', '')::uuid;
  v_email text := lower(nullif(btrim(p ->> 'email'), ''));
  -- Non-paid booking statuses that are safe to hard-delete (only ever combined with payment_state pending).
  v_del_states text[] := array['draft', 'held', 'payment_pending', 'expired', 'cancelled', 'failed'];
  -- Paid / terminal statuses that must be retained (financial records) and only anonymized.
  v_anon_states text[] := array['confirmed', 'completed', 'refund_pending', 'refunded'];
  v_del_ids uuid[];
  v_del_bookings int := 0;
  v_anon_bookings int := 0;
  v_del_leads int := 0;
begin
  -- Guard: staff, or the signed-in user erasing their own account.
  if not (is_staff() or (auth.uid() is not null and v_uid is not null and auth.uid() = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Bind the email scope to the CALLER'S identity for a non-staff self-erase. The caller-supplied email
  -- is untrusted: a signed-in user could pass a stranger's address and, because the row scope matches on
  -- lower(customer_email) = v_email, sweep that stranger's GUEST bookings/leads (user_id null) — broken
  -- access control. So for non-staff we IGNORE the supplied email and force v_email to the caller's own
  -- JWT identity, read from auth.users (the SECURITY DEFINER owner can see it; auth.email() is not
  -- relied on here). This still catches the user's own pre-account guest bookings (made under their own
  -- email before they had an account), while making a stranger's email unreachable. Staff keep the
  -- supplied email — they legitimately erase a pure-guest record by its address.
  if not is_staff() then
    select lower(email) into v_email from auth.users where id = auth.uid();
  end if;

  if v_uid is null and v_email is null then
    raise exception 'invalid_request' using detail = 'erase_user: userId or email required';
  end if;

  -- ---- Hard-delete the non-retained (unpaid/abandoned) bookings + their children -------------------
  -- Identify them first; a booking matches by ownership OR guest email, must be in a deletable status
  -- AND have never carried money (payment_state pending). Anything paid is excluded here on purpose.
  select array_agg(id) into v_del_ids
    from bookings
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_del_states::booking_status[])
     and payment_state = 'pending';

  if v_del_ids is not null then
    -- FK order: holds (FK on delete set null, so delete explicitly) + items (cascades, but be explicit),
    -- then the parent bookings. payments cannot exist on a pending booking, so none to clear here.
    delete from booking_holds where booking_id = any(v_del_ids);
    delete from booking_items where booking_id = any(v_del_ids);
    delete from bookings where id = any(v_del_ids);
    get diagnostics v_del_bookings = row_count;
  end if;

  -- ---- Anonymize the retained (paid/terminal) bookings --------------------------------------------
  -- Keep the row + every financial column (total_minor, payouts, payment_state, status); strip the PII.
  -- customer_name + customer_email are NOT NULL in the schema, so they are redacted to placeholders
  -- (a routed-nowhere .invalid sentinel) rather than nulled. customer_phone + notes are nullable → null.
  -- This is an UPDATE that does NOT touch status, so the status-only enqueue trigger never re-fires.
  update bookings
     set customer_name = '(Deleted user)',
         customer_email = 'deleted@privacy.invalid',
         customer_phone = null,
         notes = null,
         traveller_gender = null,
         traveller_company = null,
         traveller_country = null,
         special_notes = null,
         room_or_cabin = null,
         luggage_details = null,
         child_seat_age = null,
         flight_number = null,
         arrival_time = null,
         return_date = null,
         return_time = null,
         departure_flight_number = null
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_anon_states::booking_status[])
     -- idempotent: skip rows already anonymized (so a second call updates 0 rows, never re-counts).
     and customer_name is distinct from '(Deleted user)';
  get diagnostics v_anon_bookings = row_count;

  -- ---- Redact the notification outbox -------------------------------------------------------------
  -- Strip recipient (the email) + the customerName key from any queued/sent message for this person,
  -- matched by the recipient address OR by linkage to one of their (still-existing, anonymized) bookings.
  -- recipient is NOT NULL in the schema, so it is redacted to the sentinel rather than nulled. Removing
  -- customerName from the payload (jsonb - key) is a no-op when the key is already absent → idempotent.
  update notification_outbox
     set recipient = 'deleted@privacy.invalid',
         payload = payload - 'customerName'
   where v_email is not null and lower(recipient) = v_email;
  -- Booking-linked rows keep their RECIPIENT -- they may address the OWNER (the 'owner' sentinel or
  -- the ops inbox), and severing that address would silently kill a pending owner alert for a real
  -- paid booking. Only the person's name leaves the payload.
  update notification_outbox
     set payload = payload - 'customerName'
   where booking_id in (
        select id from bookings
         where (v_uid is not null and user_id = v_uid)
            or (v_email is not null and lower(customer_email) = v_email)
      );
  -- Staff bell rows (admin_new_booking / admin_refund_pending) embed the customer's name in `body` --
  -- rebuild them anonymously so no feed retains PII after erasure.
  update notifications n
     set body = '(Deleted user) -- booking ' || coalesce(n.data ->> 'ref', '') || '.'
   where n.type in ('admin_new_booking', 'admin_refund_pending')
     and n.data ->> 'bookingId' in (
        select id::text from bookings
         where (v_uid is not null and user_id = v_uid)
            or (v_email is not null and lower(customer_email) = v_email)
      );

  -- ---- Redact audit_logs diffs that captured this person's PII ------------------------------------
  -- Older admin actions may have snapshotted customer fields into diff. Null the diff on rows whose
  -- entity is one of their bookings (the anonymized financial rows). Counts only; we keep the action row.
  update audit_logs
     set diff = null
   where diff is not null
     and entity_type = 'booking'
     and entity_id in (
       select id from bookings
        where (v_uid is not null and user_id = v_uid)
           or (v_email is not null and lower(customer_email) = v_email)
     );

  -- ---- Hard-delete the remaining personal data ----------------------------------------------------
  -- leads: PII lives in (name, contact); contact holds the email/phone. Delete by email match.
  if v_email is not null then
    delete from leads where lower(contact) = v_email;
    get diagnostics v_del_leads = row_count;
  end if;

  -- chat: messages cascade from sessions, but delete explicitly for clarity. By user only (no email link).
  if v_uid is not null then
    delete from chat_messages where session_id in (select id from chat_sessions where user_id = v_uid);
    delete from chat_sessions where user_id = v_uid;
    -- profile last (auth.users row itself is removed by the caller's service-role admin.deleteUser).
    delete from profiles where id = v_uid;
  end if;

  -- ---- One audit row, counts only (NO PII) -------------------------------------------------------
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    case when is_staff() then 'staff' else 'user' end,
    'erase_user',
    'user',
    v_uid,
    'gdpr erasure: deleted ' || v_del_bookings || ' booking(s), ' || v_del_leads
      || ' lead(s); anonymized ' || v_anon_bookings || ' retained booking(s)'
  );

  return jsonb_build_object(
    'ok', true,
    'deletedBookings', v_del_bookings,
    'anonymizedBookings', v_anon_bookings,
    'deletedLeads', v_del_leads
  );
end;
$$;


-- ===========================================================================
-- 20260806000000_security_lockdown: public-mutation lockdown + cancel/erase ordering fixes.
-- (Appended verbatim from the migration; the two functions win as the last create-or-replace.)
-- ===========================================================================

-- api_cancel_booking: queue the tailored owner cancellation alert BEFORE flipping the status. The
-- status flip fires enqueue_booking_notification's refund_pending branch, whose skip-guard only
-- suppresses the generic refund trio when a 'booking_cancellation' outbox row already exists -- so the
-- insert must precede the update, otherwise every customer self-cancel double-alerts the owner (generic
-- refund trio + this tailored mail). Body otherwise unchanged.
create or replace function api_cancel_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(p ->> 'ref', '');
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_starts_at timestamptz;
begin
  if v_ref is null then
    raise exception 'invalid_request' using detail = 'cancel: ref required';
  end if;

  select * into v_booking from bookings where ref = v_ref;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Ownership: the booking's own customer, or staff. (A definer function bypasses RLS -- check here.)
  if not (is_staff() or (v_uid is not null and v_booking.user_id = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: already cancelled / refund in flight / refunded -> return current state, no re-enqueue.
  if v_booking.status in ('refund_pending', 'cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', v_booking.status, 'alreadyCancelled', true);
  end if;

  -- Only a confirmed, paid booking can be self-cancelled for a refund.
  if not (v_booking.status = 'confirmed' and v_booking.payment_state = 'paid') then
    raise exception 'not_cancellable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- The 24-hour window: the EARLIEST occurrence on this booking must start more than 24h from now.
  select min(so.starts_at) into v_starts_at
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_booking.id;
  if v_starts_at is null or v_starts_at <= now() + interval '24 hours' then
    raise exception 'cancellation_window_passed'
      using detail = 'self-service cancellation closes 24 hours before the activity';
  end if;

  -- Heads-up to the owner to process the refund (best-effort; the admin refund_pending queue is the
  -- authoritative work-list). Enqueued BEFORE the status flip so the refund_pending trigger sees this
  -- row and skips its generic trio (no double-alert). The idempotency key stops a double-cancel
  -- enqueuing twice.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'booking_cancellation',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'booking_cancellation:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;

  -- Cancel -> refund_pending (refund_pending frees used_capacity, so the seat is resellable at once). The
  -- actual money movement is recorded later through api_mark_refunded -> append_payment_event.
  update bookings set status = 'refund_pending', updated_at = now() where id = v_booking.id;

  return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', 'refund_pending');
end;
$$;

-- api_erase_user: capture the person's booking ids BEFORE the anonymize rewrites customer_email to the
-- sentinel. The outbox/bell/audit scrubs that follow match "this person's bookings"; if they re-derived
-- that set AFTER the rewrite, a guest booking matched only by email (user_id null) would fall out of
-- scope and retain the customer's name in queued payloads, staff bell rows, and audit diffs. Fix: match
-- those three scrubs against the pre-captured id array instead of re-selecting by the now-sentinel email.
create or replace function api_erase_user(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := nullif(p ->> 'userId', '')::uuid;
  v_email text := lower(nullif(btrim(p ->> 'email'), ''));
  -- Non-paid booking statuses that are safe to hard-delete (only ever combined with payment_state pending).
  v_del_states text[] := array['draft', 'held', 'payment_pending', 'expired', 'cancelled', 'failed'];
  -- Paid / terminal statuses that must be retained (financial records) and only anonymized.
  v_anon_states text[] := array['confirmed', 'completed', 'refund_pending', 'refunded'];
  v_del_ids uuid[];
  v_anon_ids uuid[];
  v_del_bookings int := 0;
  v_anon_bookings int := 0;
  v_del_leads int := 0;
begin
  -- Guard: staff, or the signed-in user erasing their own account.
  if not (is_staff() or (auth.uid() is not null and v_uid is not null and auth.uid() = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Bind the email scope to the CALLER'S identity for a non-staff self-erase. The caller-supplied email
  -- is untrusted: a signed-in user could pass a stranger's address and, because the row scope matches on
  -- lower(customer_email) = v_email, sweep that stranger's GUEST bookings/leads (user_id null) -- broken
  -- access control. So for non-staff we IGNORE the supplied email and force v_email to the caller's own
  -- JWT identity, read from auth.users (the SECURITY DEFINER owner can see it; auth.email() is not
  -- relied on here). This still catches the user's own pre-account guest bookings (made under their own
  -- email before they had an account), while making a stranger's email unreachable. Staff keep the
  -- supplied email -- they legitimately erase a pure-guest record by its address.
  if not is_staff() then
    select lower(email) into v_email from auth.users where id = auth.uid();
  end if;

  if v_uid is null and v_email is null then
    raise exception 'invalid_request' using detail = 'erase_user: userId or email required';
  end if;

  -- ---- Hard-delete the non-retained (unpaid/abandoned) bookings + their children -------------------
  -- Identify them first; a booking matches by ownership OR guest email, must be in a deletable status
  -- AND have never carried money (payment_state pending). Anything paid is excluded here on purpose.
  select array_agg(id) into v_del_ids
    from bookings
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_del_states::booking_status[])
     and payment_state = 'pending';

  if v_del_ids is not null then
    -- FK order: holds (FK on delete set null, so delete explicitly) + items (cascades, but be explicit),
    -- then the parent bookings. payments cannot exist on a pending booking, so none to clear here.
    delete from booking_holds where booking_id = any(v_del_ids);
    delete from booking_items where booking_id = any(v_del_ids);
    delete from bookings where id = any(v_del_ids);
    get diagnostics v_del_bookings = row_count;
  end if;

  -- Snapshot the person's REMAINING booking ids now, before the anonymize below overwrites
  -- customer_email. The unpaid rows are already gone, so this is exactly the retained set; the
  -- outbox/bell/audit scrubs downstream target it by id so an email-only (guest) match is not lost.
  select coalesce(array_agg(id), '{}') into v_anon_ids
    from bookings
   where (v_uid is not null and user_id = v_uid)
      or (v_email is not null and lower(customer_email) = v_email);

  -- ---- Anonymize the retained (paid/terminal) bookings --------------------------------------------
  -- Keep the row + every financial column (total_minor, payouts, payment_state, status); strip the PII.
  -- customer_name + customer_email are NOT NULL in the schema, so they are redacted to placeholders
  -- (a routed-nowhere .invalid sentinel) rather than nulled. customer_phone + notes are nullable -> null.
  -- This is an UPDATE that does NOT touch status, so the status-only enqueue trigger never re-fires.
  update bookings
     set customer_name = '(Deleted user)',
         customer_email = 'deleted@privacy.invalid',
         customer_phone = null,
         notes = null,
         traveller_gender = null,
         traveller_company = null,
         traveller_country = null,
         special_notes = null,
         room_or_cabin = null,
         luggage_details = null,
         child_seat_age = null,
         flight_number = null,
         arrival_time = null,
         return_date = null,
         return_time = null,
         departure_flight_number = null
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_anon_states::booking_status[])
     -- idempotent: skip rows already anonymized (so a second call updates 0 rows, never re-counts).
     and customer_name is distinct from '(Deleted user)';
  get diagnostics v_anon_bookings = row_count;

  -- ---- Redact the notification outbox -------------------------------------------------------------
  -- Strip recipient (the email) + the customerName key from any queued/sent message for this person,
  -- matched by the recipient address OR by linkage to one of their (still-existing, anonymized) bookings.
  -- recipient is NOT NULL in the schema, so it is redacted to the sentinel rather than nulled. Removing
  -- customerName from the payload (jsonb - key) is a no-op when the key is already absent -> idempotent.
  update notification_outbox
     set recipient = 'deleted@privacy.invalid',
         payload = payload - 'customerName'
   where v_email is not null and lower(recipient) = v_email;
  -- Booking-linked rows keep their RECIPIENT -- they may address the OWNER (the 'owner' sentinel or
  -- the ops inbox), and severing that address would silently kill a pending owner alert for a real
  -- paid booking. Only the person's name leaves the payload. Matched by the pre-captured id set.
  update notification_outbox
     set payload = payload - 'customerName'
   where booking_id = any(v_anon_ids);
  -- Staff bell rows (admin_new_booking / admin_refund_pending) embed the customer's name in `body` --
  -- rebuild them anonymously so no feed retains PII after erasure.
  update notifications n
     set body = '(Deleted user) -- booking ' || coalesce(n.data ->> 'ref', '') || '.'
   where n.type in ('admin_new_booking', 'admin_refund_pending')
     and n.data ->> 'bookingId' = any(v_anon_ids::text[]);

  -- ---- Redact audit_logs diffs that captured this person's PII ------------------------------------
  -- Older admin actions may have snapshotted customer fields into diff. Null the diff on rows whose
  -- entity is one of their bookings (the anonymized financial rows). Counts only; we keep the action row.
  update audit_logs
     set diff = null
   where diff is not null
     and entity_type = 'booking'
     and entity_id = any(v_anon_ids);

  -- ---- Hard-delete the remaining personal data ----------------------------------------------------
  -- leads: PII lives in (name, contact); contact holds the email/phone. Delete by email match.
  if v_email is not null then
    delete from leads where lower(contact) = v_email;
    get diagnostics v_del_leads = row_count;
  end if;

  -- chat: messages cascade from sessions, but delete explicitly for clarity. By user only (no email link).
  if v_uid is not null then
    delete from chat_messages where session_id in (select id from chat_sessions where user_id = v_uid);
    delete from chat_sessions where user_id = v_uid;
    -- profile last (auth.users row itself is removed by the caller's service-role admin.deleteUser).
    delete from profiles where id = v_uid;
  end if;

  -- ---- One audit row, counts only (NO PII) -------------------------------------------------------
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    case when is_staff() then 'staff' else 'user' end,
    'erase_user',
    'user',
    v_uid,
    'gdpr erasure: deleted ' || v_del_bookings || ' booking(s), ' || v_del_leads
      || ' lead(s); anonymized ' || v_anon_bookings || ' retained booking(s)'
  );

  return jsonb_build_object(
    'ok', true,
    'deletedBookings', v_del_bookings,
    'anonymizedBookings', v_anon_bookings,
    'deletedLeads', v_del_leads
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public mutation lockdown. The Next API routes are the intended throttle / anti-bot boundary, but
-- Supabase's default privileges hand every public-schema function a DIRECT execute grant to `anon`, so a
-- bot with the public anon key could call these mutation RPCs straight through PostgREST and bypass the
-- per-IP route limiter (seat-squatting, abandoned-booking / lead floods). Revoke anon/authenticated on
-- the spam-prone mutations; the server now calls them through a service-role client (see
-- src/lib/http/context.ts serviceRoleRpcContext, the holds + leads routes, and enforceRateLimit).
-- NOTE: `revoke ... from public` is NOT sufficient on stock Supabase -- the ALTER DEFAULT PRIVILEGES
-- direct anon grant survives it -- so anon/authenticated are named explicitly.
-- ---------------------------------------------------------------------------

-- Identity-free, now called by the server via a service-role client -> service_role only.
revoke execute on function api_rate_limit(jsonb) from anon, authenticated;
revoke execute on function api_create_hold(jsonb) from anon, authenticated;
revoke execute on function create_hold(uuid, int, text) from anon, authenticated;
revoke execute on function api_capture_lead(jsonb) from anon, authenticated;
-- create_booking is internal: only api_book calls it (as its definer owner), so no external role needs it.
revoke execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  from anon, authenticated;

-- api_book + api_create_payment stay callable by AUTHENTICATED (the checkout forces sign-in before
-- booking or pay, and both re-check booking ownership in-body), but never by anon.
revoke execute on function api_book(jsonb) from anon;
revoke execute on function api_create_payment(jsonb) from anon;

-- Defence in depth on the owner/staff-guarded writers flagged as relying on body checks alone. They keep
-- `authenticated` for the staff browser client; the in-body is_staff()/owner guard is the real gate --
-- this just strips the stray anon/PUBLIC grant.
revoke execute on function api_record_payment_charge(jsonb) from anon, public;
revoke execute on function api_reorder_activities(jsonb) from anon, public;

-- Direct lead spam: a baseline `leads_insert ... with check (true)` policy let the anon key INSERT into
-- `leads` straight past api_capture_lead's honeypot + per-IP limit. Every legitimate write goes through
-- the SECURITY DEFINER api_capture_lead (which runs as the table owner, unaffected by this), so drop the
-- open policy and revoke the table grant.
drop policy if exists leads_insert on leads;
revoke insert on leads from anon, authenticated;


-- ===========================================================================
-- 20260807000000_lockdown_public_revoke: PUBLIC-inclusive grant lockdown + hold ownership
-- stamping + service-role-only payment recording. (Appended verbatim from the migration.)
-- ===========================================================================

-- api_create_hold: re-applied (winning body from 20260801000000_private_option) + ownership stamping.
-- The holds route now calls this through a SERVICE-ROLE client (the anon/authenticated grants are
-- revoked below), so auth.uid() inside create_hold is null and every hold landed OWNERLESS
-- (created_by null) -- breaking the signed-in customer's pending list and release, because
-- api_release_hold requires created_by = auth.uid(). The route passes the JWKS-verified user id as
-- p.userId; it is trustworthy because only the server (service_role) can execute this function. An
-- existing owner is never overwritten, so a replayed idempotency key cannot re-assign someone's hold.
create or replace function api_create_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_people bigint := coalesce((p ->> 'people')::bigint, 0);
  v_mode text := 'per_person';
  v_is_private boolean := false;
  v_qty int;
  v_hold booking_holds;
  v_uid uuid;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;
  if v_people <= 0 or v_people > 1000000 then
    raise exception 'invalid_party';
  end if;
  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  select a.pricing_mode, (o.private_base_minor is not null)
    into v_mode, v_is_private
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_qty := case when coalesce(v_mode, 'per_person') in ('vehicle', 'vehicle_custom')
                  or coalesce(v_is_private, false) then 1 else v_people::int end;

  v_hold := create_hold(v_occ, v_qty, v_key);

  -- Stamp ownership for the server-mediated path (see the function comment). Prefer a real JWT
  -- identity when one exists; only ever fill a NULL created_by (idempotent replays keep the original).
  v_uid := coalesce(auth.uid(), nullif(p ->> 'userId', '')::uuid);
  if v_uid is not null and v_hold.created_by is null then
    update booking_holds set created_by = v_uid where id = v_hold.id and created_by is null;
    select * into v_hold from booking_holds where id = v_hold.id;
  end if;

  return jsonb_build_object('holdId', v_hold.id, 'quantity', v_hold.quantity, 'expiresAt', v_hold.expires_at);
end;
$$;

-- api_record_payment_charge: service-role only. The recorded charge feeds the customer's VAT
-- invoice/receipt; the amount/currency arrive as caller input, so an authenticated booking owner could
-- previously falsify their own invoice's charge figures (the old guard checked WHO, never WHAT). The
-- only legitimate writer is the server (createPaymentLink), which derives the values from the
-- provider charge it just created -- so the grants below lock execution to service_role and the body
-- keeps a defence-in-depth role check. Record-once (FX drift) semantics unchanged.
create or replace function api_record_payment_charge(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
  v_minor int := (p ->> 'chargedAmountMinor')::int;
  v_currency text := nullif(p ->> 'chargedCurrency', '');
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_charge: paymentId required';
  end if;

  -- Grants are the primary gate (service_role only). Defence in depth against a future accidental
  -- re-grant: refuse any PostgREST caller that is not the service role (or staff). A direct DB session
  -- (the owner in psql / the SQL editor / test seeding) carries no JWT claims and stays allowed.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;

  -- Record the charge ONCE (FX-drift fix): a later re-pay at a different rate must not overwrite it.
  update payments
  set charged_amount_minor = v_minor,
      charged_currency = v_currency
  where id = v_payment_id and charged_amount_minor is null;

  return jsonb_build_object('ok', true);
end;
$$;

-- api_record_payment_checkout: service-role only, same reasoning -- the stored checkout id drives the
-- reconcile sweep's Peach status queries, so only the server (which just created the checkout) may
-- write it. Latest-checkout-wins overwrite semantics unchanged.
create or replace function api_record_payment_checkout(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_checkout: paymentId required';
  end if;

  -- Grants are the primary gate (service_role only); defence in depth as in api_record_payment_charge.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;

  -- OVERWRITE (latest checkout wins): a re-pay opens a new checkout the sweep must query, so the most
  -- recent checkout id replaces any prior one -- no record-once guard here.
  update payments
  set prev_provider_checkout_id = case
        when provider_checkout_id is not null
             and provider_checkout_id is distinct from left(btrim(p ->> 'checkoutId'), 128)
        then provider_checkout_id
        else prev_provider_checkout_id
      end,
      provider_checkout_id = left(btrim(p ->> 'checkoutId'), 128)
  where id = v_payment_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grant lockdown, take 2. The 20260806000000 revokes named anon/authenticated but NOT public -- and
-- Postgres privileges are ADDITIVE: `create function` implicitly grants EXECUTE to PUBLIC, and anon /
-- authenticated are members of PUBLIC, so they kept executing straight through the implicit grant.
-- Every revoke below therefore names public AND the member roles; the paired grants restore exactly
-- the callers each function is supposed to have. (Verified against the live catalog: pg_proc.proacl
-- showed `=X/postgres` -- the PUBLIC entry -- on every one of these functions.)
-- ---------------------------------------------------------------------------

-- Server-only mutations (the Next routes call these through a service-role client).
revoke execute on function api_rate_limit(jsonb) from public, anon, authenticated;
revoke execute on function api_create_hold(jsonb) from public, anon, authenticated;
revoke execute on function create_hold(uuid, int, text) from public, anon, authenticated;
revoke execute on function api_capture_lead(jsonb) from public, anon, authenticated;
revoke execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  from public, anon, authenticated;
revoke execute on function api_record_payment_charge(jsonb) from public, anon, authenticated;
revoke execute on function api_record_payment_checkout(jsonb) from public, anon, authenticated;
grant execute on function api_rate_limit(jsonb) to service_role;
grant execute on function api_create_hold(jsonb) to service_role;
grant execute on function create_hold(uuid, int, text) to service_role;
grant execute on function api_capture_lead(jsonb) to service_role;
grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to service_role;
grant execute on function api_record_payment_charge(jsonb) to service_role;
grant execute on function api_record_payment_checkout(jsonb) to service_role;

-- Signed-in customer mutations (checkout forces sign-in; ownership is re-checked in-body).
revoke execute on function api_book(jsonb) from public, anon;
revoke execute on function api_create_payment(jsonb) from public, anon;
grant execute on function api_book(jsonb) to authenticated, service_role;
grant execute on function api_create_payment(jsonb) to authenticated, service_role;

-- Strip the stray PUBLIC grant from the remaining guarded writers (their earlier revokes named only
-- anon); authenticated stays -- the staff browser client and the self-serve privacy flow use them.
revoke execute on function api_erase_user(jsonb) from public;
revoke execute on function api_reorder_activities(jsonb) from public;


-- ===========================================================================
-- 20260808000000_api_book_server_only: api_book -> service_role only + trusted p.actorUserId.
-- (Appended verbatim from the migration; wins as the last create-or-replace of api_book.)
-- ===========================================================================

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
  v_mode text := 'per_person';
  v_is_private boolean := false;
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
  v_is_airport boolean := false;
  v_is_hotel boolean := false;
  v_dropoff_zone text;
  v_trip_type text;
  v_trip_direction text;
  v_ret_pct int;
  v_fare bigint;
  v_hotel_pickup_region text;
  v_hotel_dropoff_region text;
  v_band text;
  v_actor uuid;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false),
         coalesce(a.is_hotel_transfer, false),
         (o.private_base_minor is not null)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel, v_is_private
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom')
                       or coalesce(v_is_private, false) then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- Actor identity for the ownership guard + linkage below. api_book is service-role-only, so
  -- auth.uid() is null; the JWKS-verified caller id arrives as p.actorUserId (trustworthy BECAUSE
  -- only the server can execute this function). auth.uid() stays first as belt-and-suspenders.
  v_actor := coalesce(auth.uid(), nullif(p ->> 'actorUserId', '')::uuid);

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from v_actor)
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if v_actor is not null then
    update bookings set user_id = v_actor where id = v_booking.id and user_id is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  -- Airport transfer (server-authoritative, zero-trust): the destination ZONE comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent zone. When the guest's hotel isn't listed
  -- (no dropoffSlug), classify the zone from the supplied AREA instead (Zone 2 = the near-airport
  -- south-east areas), still never trusting a client price. The whole fare is the zone × vehicle matrix
  -- (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    v_trip_direction := case
      when (p ->> 'tripDirection') in ('arrival', 'departure', 'return') then p ->> 'tripDirection'
      when (p ->> 'tripType') = 'return' then 'return'
      else 'arrival'
    end;
    v_trip_type := case when v_trip_direction = 'return' then 'return' else 'one_way' end;
    if nullif(p ->> 'dropoffSlug', '') is not null then
      select zone into v_dropoff_zone from airport_transfer_hotels
        where slug = nullif(p ->> 'dropoffSlug', '');
    end if;
    if v_dropoff_zone is null then
      v_dropoff_zone := airport_transfer_area_zone(p ->> 'dropoffArea');
    end if;
    v_fare := airport_transfer_fare_minor(v_dropoff_zone, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        trip_direction = v_trip_direction,
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        child_seat_age = nullif(p ->> 'childSeatAge', '')::int,
        traveller_gender = left(nullif(btrim(p ->> 'travellerGender'), ''), 20),
        traveller_company = left(nullif(btrim(p ->> 'travellerCompany'), ''), 120),
        traveller_country = left(nullif(btrim(p ->> 'travellerCountry'), ''), 80),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  -- Hotel-to-hotel transfer (server-authoritative, zero-trust): derive BOTH endpoints' regions from the
  -- hotel SLUGS via airport_transfer_hotels (or area_region() for a free-text end), reject a same-hotel
  -- trip, classify the distance band (region_distance_band), and price band × vehicle (× return discount).
  -- OVERRIDE the booking total + payout + line item. Mirrors hotelTransferQuoteMinor() in pricing.ts.
  if v_is_hotel then
    if nullif(p ->> 'pickupSlug', '') is not null
       and nullif(p ->> 'pickupSlug', '') = nullif(p ->> 'dropoffSlug', '') then
      raise exception 'same_hotel';
    end if;
    v_trip_type := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
    v_hotel_pickup_region := hotel_end_region(
      p ->> 'pickupSlug',
      nullif(p ->> 'pickupLat', '')::double precision,
      nullif(p ->> 'pickupLng', '')::double precision,
      p ->> 'pickupArea');
    v_hotel_dropoff_region := hotel_end_region(
      p ->> 'dropoffSlug',
      nullif(p ->> 'dropoffLat', '')::double precision,
      nullif(p ->> 'dropoffLng', '')::double precision,
      p ->> 'dropoffArea');
    v_band := region_distance_band(v_hotel_pickup_region, v_hotel_dropoff_region);
    v_fare := hotel_transfer_fare_minor(v_band, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        pickup_hotel_slug = left(nullif(btrim(p ->> 'pickupSlug'), ''), 120),
        pickup_region = v_hotel_pickup_region,
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- api_book is now SERVER-ONLY. It was executable by `authenticated`, so any registered user could POST
-- /rest/v1/rpc/api_book straight through PostgREST and bypass the Next route's per-IP limiter, minting
-- capacity-consuming payment_pending bookings. The booking route already forces sign-in and calls the
-- RPC through a service-role client, passing the JWKS-verified user id as p.actorUserId (which the
-- function stamps as the booking owner + checks in the F23 replay guard, exactly as auth.uid() did).
-- So revoke it from anon/authenticated/public and grant service_role only.
-- ---------------------------------------------------------------------------
revoke execute on function api_book(jsonb) from public, anon, authenticated;
grant execute on function api_book(jsonb) to service_role;


-- ===========================================================================
-- 20260809000000_api_book_fallback_hold_owner: stamp the fallback hold's created_by from the
-- actor (was ownerless under service_role). (Appended verbatim from the migration.)
-- ===========================================================================

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
  v_mode text := 'per_person';
  v_is_private boolean := false;
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
  v_is_airport boolean := false;
  v_is_hotel boolean := false;
  v_dropoff_zone text;
  v_trip_type text;
  v_trip_direction text;
  v_ret_pct int;
  v_fare bigint;
  v_hotel_pickup_region text;
  v_hotel_dropoff_region text;
  v_band text;
  v_actor uuid;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false),
         coalesce(a.is_hotel_transfer, false),
         (o.private_base_minor is not null)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel, v_is_private
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom')
                       or coalesce(v_is_private, false) then 1 else v_total_qty::int end;

  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- Actor identity for the ownership guard + linkage below. api_book is service-role-only, so
  -- auth.uid() is null; the JWKS-verified caller id arrives as p.actorUserId (trustworthy BECAUSE
  -- only the server can execute this function). auth.uid() stays first as belt-and-suspenders.
  v_actor := coalesce(auth.uid(), nullif(p ->> 'actorUserId', '')::uuid);

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from v_actor)
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if v_actor is not null then
    update bookings set user_id = v_actor where id = v_booking.id and user_id is null;
  end if;

  -- Ownership for the FALLBACK hold: when no reusable holdId was supplied, api_book mints its own
  -- hold above via create_hold, which runs under service_role here (server-only RPC) and so wrote
  -- created_by = auth.uid() = NULL. Stamp the actor onto it so the customer's owner-scoped hold
  -- status/release endpoints work. A REUSED hold already carries its owner (created_by not null),
  -- so the guard leaves it alone; a guest booking (v_actor null) leaves the hold ownerless as before.
  if v_actor is not null then
    update booking_holds set created_by = v_actor where id = v_hold.id and created_by is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  -- Airport transfer (server-authoritative, zero-trust): the destination ZONE comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent zone. When the guest's hotel isn't listed
  -- (no dropoffSlug), classify the zone from the supplied AREA instead (Zone 2 = the near-airport
  -- south-east areas), still never trusting a client price. The whole fare is the zone × vehicle matrix
  -- (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    v_trip_direction := case
      when (p ->> 'tripDirection') in ('arrival', 'departure', 'return') then p ->> 'tripDirection'
      when (p ->> 'tripType') = 'return' then 'return'
      else 'arrival'
    end;
    v_trip_type := case when v_trip_direction = 'return' then 'return' else 'one_way' end;
    if nullif(p ->> 'dropoffSlug', '') is not null then
      select zone into v_dropoff_zone from airport_transfer_hotels
        where slug = nullif(p ->> 'dropoffSlug', '');
    end if;
    if v_dropoff_zone is null then
      v_dropoff_zone := airport_transfer_area_zone(p ->> 'dropoffArea');
    end if;
    v_fare := airport_transfer_fare_minor(v_dropoff_zone, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        trip_direction = v_trip_direction,
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        child_seat_age = nullif(p ->> 'childSeatAge', '')::int,
        traveller_gender = left(nullif(btrim(p ->> 'travellerGender'), ''), 20),
        traveller_company = left(nullif(btrim(p ->> 'travellerCompany'), ''), 120),
        traveller_country = left(nullif(btrim(p ->> 'travellerCountry'), ''), 80),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  -- Hotel-to-hotel transfer (server-authoritative, zero-trust): derive BOTH endpoints' regions from the
  -- hotel SLUGS via airport_transfer_hotels (or area_region() for a free-text end), reject a same-hotel
  -- trip, classify the distance band (region_distance_band), and price band × vehicle (× return discount).
  -- OVERRIDE the booking total + payout + line item. Mirrors hotelTransferQuoteMinor() in pricing.ts.
  if v_is_hotel then
    if nullif(p ->> 'pickupSlug', '') is not null
       and nullif(p ->> 'pickupSlug', '') = nullif(p ->> 'dropoffSlug', '') then
      raise exception 'same_hotel';
    end if;
    v_trip_type := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
    v_hotel_pickup_region := hotel_end_region(
      p ->> 'pickupSlug',
      nullif(p ->> 'pickupLat', '')::double precision,
      nullif(p ->> 'pickupLng', '')::double precision,
      p ->> 'pickupArea');
    v_hotel_dropoff_region := hotel_end_region(
      p ->> 'dropoffSlug',
      nullif(p ->> 'dropoffLat', '')::double precision,
      nullif(p ->> 'dropoffLng', '')::double precision,
      p ->> 'dropoffArea');
    v_band := region_distance_band(v_hotel_pickup_region, v_hotel_dropoff_region);
    v_fare := hotel_transfer_fare_minor(v_band, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        pickup_hotel_slug = left(nullif(btrim(p ->> 'pickupSlug'), ''), 120),
        pickup_region = v_hotel_pickup_region,
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- api_book stays service_role-only (grants unchanged from 20260808000000); this migration only
-- re-applies the body to stamp the fallback hold's owner. Re-grant defensively so a fresh apply is
-- self-contained.
revoke execute on function api_book(jsonb) from public, anon, authenticated;
grant execute on function api_book(jsonb) to service_role;

-- 20260810000000_seo_module
-- SEO module: a restricted 'seo' role for the hired SEO specialist + database-backed SEO surfaces
-- (page-meta overrides, blog posts, runtime redirects) editable from the admin without a deploy.
--
--  * The 'seo' role sees ONLY content: is_staff() is UNTOUCHED, so bookings, payments, leads,
--    pricing and GDPR tooling stay staff/admin-only — RLS keeps an seo login out server-side even
--    via raw API calls (external contractor => customer PII off-limits).
--  * is_content_editor() compares role::text (NOT the enum literal): Postgres forbids USING a
--    just-added enum value in the same transaction that added it, and catch-up.sql applies as one
--    transaction. Text comparison sidesteps that while staying index-friendly on this tiny table.
--  * Blog posts: DB rows override the code-generated seed posts by slug (merge happens in the app);
--    anon sees published only. Redirects apply at the edge ONLY on otherwise-404 paths.

-- 1) Role value ----------------------------------------------------------------------------------
alter type user_role add value if not exists 'seo';

-- 2) Content-editor guard (parallel to is_staff(); SECURITY DEFINER to avoid policy recursion) ----
create or replace function is_content_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role::text in ('staff', 'admin', 'seo')
  );
$$;

-- 3) seo_meta: per-path title/description/OG overrides for the static public pages ---------------
create table if not exists seo_meta (
  path         text primary key check (path like '/%'),
  title        text check (char_length(title) <= 120),
  description  text check (char_length(description) <= 320),
  og_image_url text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);
alter table seo_meta enable row level security;
grant select on seo_meta to anon, authenticated, service_role;
grant insert, update, delete on seo_meta to authenticated;
drop policy if exists seo_meta_read on seo_meta;
create policy seo_meta_read on seo_meta for select using (true);
drop policy if exists seo_meta_editor on seo_meta;
create policy seo_meta_editor on seo_meta for all
  using (is_content_editor()) with check (is_content_editor());

-- 4) posts: database-backed blog articles (same shape as the generated seed posts) ----------------
create table if not exists posts (
  slug             text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text not null check (char_length(title) between 1 and 200),
  meta_title       text check (char_length(meta_title) <= 120),
  meta_description text check (char_length(meta_description) <= 320),
  excerpt          text,
  read_mins        int not null default 5 check (read_mins between 1 and 60),
  -- [{ heading, paragraphs: [string] }] — matches PostContent.sections in src/lib/content/blog.ts
  sections         jsonb not null default '[]'::jsonb,
  -- [{ q, a }] — matches PostContent.faq
  faq              jsonb not null default '[]'::jsonb,
  hero_image_url   text,
  status           text not null default 'draft' check (status in ('draft', 'published')),
  published_at     date,
  updated_at       timestamptz not null default now(),
  updated_by       uuid default auth.uid()
);
alter table posts enable row level security;
grant select on posts to anon, authenticated, service_role;
grant insert, update, delete on posts to authenticated;
drop policy if exists posts_read on posts;
create policy posts_read on posts for select
  using (status = 'published' or is_content_editor());
drop policy if exists posts_editor on posts;
create policy posts_editor on posts for all
  using (is_content_editor()) with check (is_content_editor());

-- 5) seo_redirects: runtime 301s, applied only on otherwise-404 paths ------------------------------
create table if not exists seo_redirects (
  from_path  text primary key
    check (from_path like '/%' and from_path not like '%?%' and from_path not like '%#%'),
  to_path    text not null check (to_path like '/%'),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (from_path <> to_path)
);
alter table seo_redirects enable row level security;
grant select on seo_redirects to anon, authenticated, service_role;
grant insert, update, delete on seo_redirects to authenticated;
drop policy if exists seo_redirects_read on seo_redirects;
create policy seo_redirects_read on seo_redirects for select using (true);
drop policy if exists seo_redirects_editor on seo_redirects;
create policy seo_redirects_editor on seo_redirects for all
  using (is_content_editor()) with check (is_content_editor());

-- 6) RPCs (repo pattern: jsonb in/out, SECURITY DEFINER, camelCase DTO) ----------------------------

-- Per-path meta override, or null when the page has none.
create or replace function api_seo_meta(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'path', path, 'title', title, 'description', description, 'ogImageUrl', og_image_url
  )
  from seo_meta
  where path = p ->> 'path';
$$;
grant execute on function api_seo_meta(jsonb) to anon, authenticated, service_role;

-- Published post summaries, newest first (for /blog + the sitemap).
create or replace function api_list_posts(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', slug, 'title', title, 'metaTitle', meta_title, 'metaDescription', meta_description,
    'excerpt', excerpt, 'readMins', read_mins, 'heroImageUrl', hero_image_url,
    'datePublished', to_char(coalesce(published_at, updated_at::date), 'YYYY-MM-DD')
  ) order by coalesce(published_at, updated_at::date) desc, slug), '[]'::jsonb)
  from posts
  where status = 'published';
$$;
grant execute on function api_list_posts(jsonb) to anon, authenticated, service_role;

-- One full post. SECURITY DEFINER bypasses RLS, so the published-or-editor gate is re-checked here.
create or replace function api_get_post(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'slug', slug, 'title', title, 'metaTitle', meta_title, 'metaDescription', meta_description,
    'excerpt', excerpt, 'readMins', read_mins, 'sections', sections, 'faq', faq,
    'heroImageUrl', hero_image_url, 'status', status,
    'datePublished', to_char(coalesce(published_at, updated_at::date), 'YYYY-MM-DD')
  )
  from posts
  where slug = p ->> 'slug'
    and (status = 'published' or is_content_editor());
$$;
grant execute on function api_get_post(jsonb) to anon, authenticated, service_role;

-- Redirect target for a missed path, or null. Called only from the 404 catch-all.
create or replace function api_lookup_redirect(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(to_path)
  from seo_redirects
  where from_path = p ->> 'path';
$$;
grant execute on function api_lookup_redirect(jsonb) to anon, authenticated, service_role;

-- 7) Content-editing grants for the seo role -------------------------------------------------------
-- ADDITIVE policies (permissive OR with the existing is_staff() ones) on CONTENT tables only.
-- Deliberately NOT granted: activity_options / activity_option_prices (pricing), categories,
-- session_occurrences (availability), and every booking/payment/lead/profile table.
drop policy if exists activities_content_editor on activities;
create policy activities_content_editor on activities for all
  using (is_content_editor()) with check (is_content_editor());
drop policy if exists activity_translations_content_editor on activity_translations;
create policy activity_translations_content_editor on activity_translations for all
  using (is_content_editor()) with check (is_content_editor());
drop policy if exists activity_images_content_editor on activity_images;
create policy activity_images_content_editor on activity_images for all
  using (is_content_editor()) with check (is_content_editor());
drop policy if exists planner_places_content_editor on planner_places;
create policy planner_places_content_editor on planner_places for all
  using (is_content_editor()) with check (is_content_editor());

-- ============================================================================
-- Telegram owner alerts (migration 20260810000000). The OWNER chat alert now goes
-- over Telegram instead of WhatsApp (Meta Cloud API onboarding was too painful).
-- Adds the 'telegram' channel and re-applies enqueue_booking_notification (last
-- create-or-replace wins) with the two owner rows moved to the 'telegram' channel.
-- Runs after catch-up's commit (line 6221) so ADD VALUE auto-commits before the
-- function that references it — no same-transaction enum hazard here.
-- ============================================================================
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

-- Per-category standard content (spec: docs/superpowers/specs/2026-07-16-activity-content-defaults-design.md).
-- Replaces the two HARDCODED shared-content files (src/lib/content/sightseeing.ts, catamaran.ts) with an
-- admin-editable table, and extends standard content to includes/not-included which never had defaults.
--
-- Scope moves from pricing_mode to CATEGORY. 'Taxi Sightseeing tours' is already its own category (13
-- activities, 12 vehicle-priced), so a per-category set covers it without inferring "is this sightseeing?"
-- from a pricing field. That old rule also swept in Airport transfers (pricing_mode='vehicle') and missed
-- Custom Road Trip (pricing_mode='vehicle_custom'); both are corrected by this change — see the spec's
-- "Scope change: the exact delta".
--
-- Highlights REPLACE the activity's own (unchanged from today); the other four lists MERGE shared-first
-- and dedupe. The seed below reproduces today's live text verbatim, so no page changes by accident.

create table if not exists activity_content_defaults (
  category       text primary key,
  highlights     text[] not null default '{}',
  inclusions     text[] not null default '{}',
  exclusions     text[] not null default '{}',
  what_to_bring  text[] not null default '{}',
  important_info text[] not null default '{}',
  updated_at     timestamptz not null default now()
);

-- RLS copied verbatim from rental_vehicles: public read (the activity page renders it), staff edit.
alter table activity_content_defaults enable row level security;
grant select on activity_content_defaults to anon, authenticated, service_role;
grant insert, update, delete on activity_content_defaults to authenticated;
drop policy if exists activity_content_defaults_read on activity_content_defaults;
create policy activity_content_defaults_read on activity_content_defaults for select using (true);
drop policy if exists activity_content_defaults_staff on activity_content_defaults;
create policy activity_content_defaults_staff on activity_content_defaults for all
  using (is_staff()) with check (is_staff());

-- Seed today's hardcoded content so the live site is unchanged on day one. `do nothing` keeps this
-- idempotent AND never stomps content the owner has since edited in /admin.
insert into activity_content_defaults (category, highlights, important_info) values (
  'Taxi Sightseeing tours',
  ARRAY[
    'Private, air-conditioned vehicle with a professional English-speaking driver-guide — exclusively for your group, never shared.',
    'Door-to-door hotel or port pickup and drop-off anywhere in Mauritius, included in the price.',
    'Flexible morning departure — start your day any time between 7:30 and 9:30 am.',
    'A fully flexible route — add, swap or skip stops on the day to match your pace and interests.',
    'Free first child seat and complimentary bottled water on board.',
    'One fixed, all-in price with no hidden fees — pay securely online and get instant confirmation.'
  ]::text[],
  ARRAY[
    'Entrance fees to attractions, museums, gardens and nature parks are not included in the tour price. Please carry some cash (Mauritian rupees) to pay these on the day — many sites do not accept cards.',
    'Lunch and personal expenses are not included unless stated; your driver-guide is happy to recommend good local spots and stop wherever you like.',
    'Bring sun protection, comfortable walking shoes and swimwear if your route includes a beach or waterfall stop.',
    'Travel times between stops are approximate and depend on traffic and how long you choose to spend at each place.',
    'Modest dress (shoulders and knees covered) is required to enter temples and other places of worship, such as Grand Bassin.'
  ]::text[]
)
on conflict (category) do nothing;

insert into activity_content_defaults (category, what_to_bring, important_info) values (
  'Catamaran cruises',
  ARRAY[
    'Comfortable shoes',
    'Sunglasses',
    'Hat',
    'Swimwear',
    'Change of clothes',
    'Towel',
    'Camera',
    'Sunscreen',
    'Snorkeling gear'
  ]::text[],
  ARRAY[
    'Infants aged 1 to 4 go free of charge.',
    'All food is halal. Vegetarian meals must be requested in advance.',
    'Pickup and drop-off is available if the applicable option is selected.',
    'Public parking is available 60m from the meeting point. Please arrive early to secure a space. Contact our team on WhatsApp for the location.',
    'The itinerary may be adjusted due to weather, sea conditions, tides, or operational requirements for guest safety.',
    'The captain’s decisions regarding navigation, timing, and itinerary adjustments are final and made in the interest of guest safety.',
    'Guests using wheelchairs need to stand briefly to get on and off the shuttle boat, with our crew assisting, to access the catamaran.',
    'For their own comfort and security, guests are kindly requested to keep personal belongings with them at all times. The company cannot be held responsible for any loss, theft, damage, or misplacement of personal items during the tour.'
  ]::text[]
)
on conflict (category) do nothing;

-- Public read for the activity page. Deliberately NOT folded into api_get_activity: that function is
-- huge and re-applied by many migrations, and re-applying it is the documented revert-drift hazard.
-- Returns every row (<=10) keyed by category, so a caller merges client-agnostically.
create or replace function api_content_defaults(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(d.category, jsonb_build_object(
    'highlights', to_jsonb(d.highlights),
    'inclusions', to_jsonb(d.inclusions),
    'exclusions', to_jsonb(d.exclusions),
    'whatToBring', to_jsonb(d.what_to_bring),
    'importantInfo', to_jsonb(d.important_info)
  )), '{}'::jsonb)
  from activity_content_defaults d;
$$;
grant execute on function api_content_defaults(jsonb) to anon, authenticated, service_role;

-- ===== Payment + hold hardening (mirrors 20260812000000_payment_hold_hardening.sql) =====

-- Payment + hold hardening (external review 2026-07-17, items 1 and 2).
--
-- (1) Single-flight Peach checkout. api_create_payment's existing reuse guard was check-then-act:
--     the checkout id is only recorded AFTER the Peach call, so two concurrent requests (two tabs, a
--     double-click, a retry racing a slow first call) both saw "no existing checkout" and both minted
--     independently payable sessions. Peach's nonce is unique per request — it never dedupes. Now the
--     booking row is locked FOR UPDATE and a 90-second lease (payments.checkout_claimed_until) admits
--     exactly one caller to Peach at a time; everyone else gets checkoutPending and retries into the
--     recorded session.
--
-- (2) Hold binding. A booking_holds row was attachable to a second booking: attach never changed the
--     hold's status, create_booking checked only status/expiry under its lock, and the attach UPDATE
--     was unconditional — so two bookings could share one capacity unit until the paid-time capacity
--     re-check bounced one to refund_pending. The reuse path in api_book also never checked the
--     hold's owner and took no row lock, and api_release_hold would free a hold its booking was
--     standing on. All four seams are closed below.
--
-- Re-applied winning bodies (revert-drift rule): api_create_payment, create_booking, api_book,
-- api_release_hold, api_record_payment_checkout — each verbatim from its current winning definition
-- plus only the deltas described above.

alter table payments add column if not exists checkout_claimed_until timestamptz;

-- Releases the single-flight checkout lease after a FAILED Peach create-checkout call, so the next
-- attempt does not have to sit out the remainder of the 90-second lease. Success clears the lease via
-- api_record_payment_checkout; a crash between claim and release is covered by the lease expiry.
create or replace function api_release_checkout_claim(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'release_checkout_claim: paymentId required';
  end if;

  -- Grants are the primary gate (service_role only); defence in depth as in api_record_payment_checkout.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;

  update payments set checkout_claimed_until = null where id = v_payment_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_release_checkout_claim(jsonb) from public, anon, authenticated;
grant execute on function api_release_checkout_claim(jsonb) to service_role;

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
  -- FOR UPDATE: every concurrent create-payment call for one booking serialises on this row for the
  -- rest of the transaction. That closes two races at once: two callers both inserting a payments row
  -- below, and — via the checkout lease — two callers both getting a green light to mint a Peach
  -- session. Peach's nonce is unique per REQUEST (it never dedupes), so without this lease two tabs
  -- or a retry could create two independently payable sessions for the same booking.
  select * into v_booking from bookings where ref = p ->> 'bookingRef' for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
     or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'booking_not_payable' using detail = v_booking.status::text;
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  select * into v_payment from payments
  where booking_id = v_booking.id and status <> 'failed'
  order by created_at desc
  limit 1;

  if not found then
    -- Scoped to THIS booking: an unscoped key lookup let a caller echo another payment's key and
    -- receive that payment's id/amount back.
    select * into v_payment from payments
    where idempotency_key = p ->> 'idempotencyKey' and booking_id = v_booking.id;
  end if;

  if not found then
    insert into payments (booking_id, idempotency_key, amount_minor)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor)
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
  end if;

  -- Checkout lease (single-flight): exactly one caller may be out creating a Peach session at any
  -- moment. Order matters — reuse beats pending beats claim:
  --   1. a still-fresh recorded checkout        -> hand the SAME session back (reuse; no Peach call);
  --   2. someone else holds an unexpired lease  -> checkoutPending (caller retries shortly);
  --   3. otherwise                              -> stamp the lease and let THIS caller call Peach.
  -- api_record_payment_checkout clears the lease when the session id is recorded; a Peach failure
  -- releases it via api_release_checkout_claim, and the 90-second expiry is the crash backstop.
  if v_payment.provider_checkout_id is not null
     and v_payment.updated_at > now() - interval '25 minutes' then
    return jsonb_build_object(
      'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
      'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
      'existingCheckoutId', v_payment.provider_checkout_id
    );
  end if;

  if v_payment.checkout_claimed_until is not null and v_payment.checkout_claimed_until > now() then
    return jsonb_build_object(
      'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
      'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
      'existingCheckoutId', null,
      'checkoutPending', true
    );
  end if;

  update payments set checkout_claimed_until = now() + interval '90 seconds'
  where id = v_payment.id;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
    'existingCheckoutId', null
  );
end;
$$;

revoke execute on function api_create_payment(jsonb) from public, anon;
grant execute on function api_create_payment(jsonb) to authenticated, service_role;

create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb,
  p_suv boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_vehicle text;
  v_sedan bigint;
  v_suv_price bigint;
  v_family bigint;
  v_van bigint;
  v_coaster bigint;
  v_pl_standard bigint;
  v_pl_suv bigint;
  v_pl_six bigint;
  v_pl_van bigint;
  v_pl_coach bigint;
  v_pl_max int;
  v_pb bigint;
  v_pi int;
  v_pe bigint;
  v_pm int;
  v_opt_name text;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;
  -- Re-checked HERE, under the FOR UPDATE taken above: attaching to a booking does not change the
  -- hold's status, so the active check alone would let a second booking (different idempotency key)
  -- adopt a hold that booking A already consumed — two payable bookings sharing one capacity unit.
  -- The idempotency-replay path returned earlier, so any booking_id at this point is a conflict.
  if v_hold.booking_id is not null then
    raise exception 'hold_already_used';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  select a.pricing_mode into v_mode
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  select private_base_minor, private_included, private_extra_minor, private_max_guests, name
    into v_pb, v_pi, v_pe, v_pm, v_opt_name
  from activity_options
  where id = v_option_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_pb is not null then
    -- Private option (option-level flag): a flat base covers the first v_pi guests, v_pe per extra
    -- head. Counted like a vehicle: ONE capacity unit per booking (the pool is trips/day), with the
    -- real headcount recorded in pax on the single line item below.
    if v_qty_total < 1 or v_qty_total > v_pm then
      raise exception 'exceeds_max_guests' using detail = format('private: %s > %s', v_qty_total, v_pm);
    end if;
    v_total := v_pb + v_pe * greatest(0, v_qty_total - v_pi);
    v_vehicle := coalesce(nullif(v_opt_name, ''), 'Private');
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('private hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle' then
    -- One flat price for the bracket that fits P = v_qty_total (people on board). (Unchanged.)
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select sedan_minor, suv_minor, family_minor, van_minor, coaster_minor
      into v_sedan, v_suv_price, v_family, v_van, v_coaster
      from sightseeing_pricing limit 1;
    if v_sedan is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_suv_price;
        v_vehicle := 'SUV';
      else
        v_total := v_sedan;
        v_vehicle := 'Sedan';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_family;
      v_vehicle := 'Family car';
    elsif v_qty_total <= 14 then
      v_total := v_van;
      v_vehicle := 'Van';
    else
      v_total := v_coaster;
      v_vehicle := 'Coaster';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle_custom' then
    -- Parallel planner path: same bracket shape, the planner's own prices/names + cap.
    select standard_minor, suv_minor, six_minor, van_minor, coach_minor, max_party
      into v_pl_standard, v_pl_suv, v_pl_six, v_pl_van, v_pl_coach, v_pl_max
      from planner_pricing limit 1;
    if v_pl_standard is null then
      raise exception 'planner_pricing_unset';
    end if;
    if v_qty_total < 1 or v_qty_total > v_pl_max then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_pl_suv;
        v_vehicle := 'SUV';
      else
        v_total := v_pl_standard;
        v_vehicle := 'Standard car';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_pl_six;
      v_vehicle := '6-seater';
    elsif v_qty_total <= 14 then
      v_total := v_pl_van;
      v_vehicle := 'Van';
    else
      v_total := v_pl_coach;
      v_vehicle := 'Coach';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: price each aggregated tier from the DB. (Unchanged.)
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch'
        using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  -- A EUR 0 booking must never exist: an all-free party (infants only) would otherwise mint a
  -- zero-amount payment that flips 'paid' on any event. The client blocks free-only parties;
  -- enforce it zero-trust here too.
  if v_total <= 0 then
    raise exception 'zero_total';
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_pb is not null or v_mode in ('vehicle', 'vehicle_custom') then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (
      v_booking.id, v_hold.session_occurrence_id, v_option_id, v_vehicle,
      1, v_total, v_total, v_qty_total
    );
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case
          when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
          else v_unit * v_qty
        end
      );
    end loop;
  end if;

  -- Conditional attach, belt-and-braces with the guard above: if anything ever attaches this hold
  -- between our check and here, refuse rather than silently overwrite the other booking's claim.
  update booking_holds set booking_id = v_booking.id where id = v_hold.id and booking_id is null;
  if not found then
    raise exception 'hold_already_used';
  end if;
  return v_booking;
end;
$$;

revoke execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to service_role;

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
  v_mode text := 'per_person';
  v_is_private boolean := false;
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
  v_is_airport boolean := false;
  v_is_hotel boolean := false;
  v_dropoff_zone text;
  v_trip_type text;
  v_trip_direction text;
  v_ret_pct int;
  v_fare bigint;
  v_hotel_pickup_region text;
  v_hotel_dropoff_region text;
  v_band text;
  v_actor uuid;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false),
         coalesce(a.is_hotel_transfer, false),
         (o.private_base_minor is not null)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel, v_is_private
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom')
                       or coalesce(v_is_private, false) then 1 else v_total_qty::int end;

  -- Actor identity, resolved BEFORE the hold-reuse gate so ownership can bind reuse. api_book is
  -- service-role-only, so auth.uid() is null; the JWKS-verified caller id arrives as p.actorUserId
  -- (trustworthy BECAUSE only the server can execute this function). auth.uid() stays first as
  -- belt-and-suspenders.
  v_actor := coalesce(auth.uid(), nullif(p ->> 'actorUserId', '')::uuid);

  if v_hold_id is not null then
    -- FOR UPDATE: two concurrent api_book calls quoting the same holdId must serialise here, or both
    -- read booking_id IS NULL and both proceed (create_booking's own lock cannot save the second one
    -- on its own — it re-checks under the lock, but only because of the guard added alongside this).
    -- Ownership: an OWNED hold (created_by set) is only reusable by its owner; an ownerless hold
    -- (guest checkout, or created before sign-in) stays reusable by whoever holds the unguessable id,
    -- which keeps the guest → sign-in-mid-checkout flow working.
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty
      and (created_by is null or created_by = v_actor)
    for update;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from v_actor)
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if v_actor is not null then
    update bookings set user_id = v_actor where id = v_booking.id and user_id is null;
  end if;

  -- Ownership for the FALLBACK hold: when no reusable holdId was supplied, api_book mints its own
  -- hold above via create_hold, which runs under service_role here (server-only RPC) and so wrote
  -- created_by = auth.uid() = NULL. Stamp the actor onto it so the customer's owner-scoped hold
  -- status/release endpoints work. A REUSED hold already carries its owner (created_by not null),
  -- so the guard leaves it alone; a guest booking (v_actor null) leaves the hold ownerless as before.
  if v_actor is not null then
    update booking_holds set created_by = v_actor where id = v_hold.id and created_by is null;
  end if;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  -- Airport transfer (server-authoritative, zero-trust): the destination ZONE comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent zone. When the guest's hotel isn't listed
  -- (no dropoffSlug), classify the zone from the supplied AREA instead (Zone 2 = the near-airport
  -- south-east areas), still never trusting a client price. The whole fare is the zone × vehicle matrix
  -- (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    v_trip_direction := case
      when (p ->> 'tripDirection') in ('arrival', 'departure', 'return') then p ->> 'tripDirection'
      when (p ->> 'tripType') = 'return' then 'return'
      else 'arrival'
    end;
    v_trip_type := case when v_trip_direction = 'return' then 'return' else 'one_way' end;
    if nullif(p ->> 'dropoffSlug', '') is not null then
      select zone into v_dropoff_zone from airport_transfer_hotels
        where slug = nullif(p ->> 'dropoffSlug', '');
    end if;
    if v_dropoff_zone is null then
      v_dropoff_zone := airport_transfer_area_zone(p ->> 'dropoffArea');
    end if;
    v_fare := airport_transfer_fare_minor(v_dropoff_zone, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        trip_direction = v_trip_direction,
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        child_seat_age = nullif(p ->> 'childSeatAge', '')::int,
        traveller_gender = left(nullif(btrim(p ->> 'travellerGender'), ''), 20),
        traveller_company = left(nullif(btrim(p ->> 'travellerCompany'), ''), 120),
        traveller_country = left(nullif(btrim(p ->> 'travellerCountry'), ''), 80),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  -- Hotel-to-hotel transfer (server-authoritative, zero-trust): derive BOTH endpoints' regions from the
  -- hotel SLUGS via airport_transfer_hotels (or area_region() for a free-text end), reject a same-hotel
  -- trip, classify the distance band (region_distance_band), and price band × vehicle (× return discount).
  -- OVERRIDE the booking total + payout + line item. Mirrors hotelTransferQuoteMinor() in pricing.ts.
  if v_is_hotel then
    if nullif(p ->> 'pickupSlug', '') is not null
       and nullif(p ->> 'pickupSlug', '') = nullif(p ->> 'dropoffSlug', '') then
      raise exception 'same_hotel';
    end if;
    v_trip_type := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
    v_hotel_pickup_region := hotel_end_region(
      p ->> 'pickupSlug',
      nullif(p ->> 'pickupLat', '')::double precision,
      nullif(p ->> 'pickupLng', '')::double precision,
      p ->> 'pickupArea');
    v_hotel_dropoff_region := hotel_end_region(
      p ->> 'dropoffSlug',
      nullif(p ->> 'dropoffLat', '')::double precision,
      nullif(p ->> 'dropoffLng', '')::double precision,
      p ->> 'dropoffArea');
    v_band := region_distance_band(v_hotel_pickup_region, v_hotel_dropoff_region);
    v_fare := hotel_transfer_fare_minor(v_band, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    if v_fare > 0 then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        pickup_hotel_slug = left(nullif(btrim(p ->> 'pickupSlug'), ''), 120),
        pickup_region = v_hotel_pickup_region,
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

revoke execute on function api_book(jsonb) from public, anon, authenticated;
grant execute on function api_book(jsonb) to service_role;

create or replace function api_release_hold(p_hold_id uuid)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold booking_holds;
begin
  select * into v_hold from booking_holds where id = p_hold_id;
  if not found then
    raise exception 'hold_not_found';
  end if;

  if not (is_staff() or (auth.uid() is not null and v_hold.created_by = auth.uid())) then
    raise exception 'forbidden';
  end if;

  -- A hold a booking stands on is CONSUMED, not releasable: freeing it would hand the seat to
  -- someone else while the original booking is mid-payment, forcing the paid-time capacity re-check
  -- to bounce a legitimately paid booking into refund_pending. The checkout flow never releases an
  -- attached hold (it uses remove, not removeHeld, after booking) — only a hostile or buggy caller
  -- gets here.
  if v_hold.booking_id is not null then
    raise exception 'hold_attached';
  end if;

  -- Idempotent: only an active hold is flipped; an already-released hold is a no-op.
  update booking_holds set status = 'released'
  where id = p_hold_id and status = 'active' and booking_id is null
  returning * into v_hold;
  if not found then
    select * into v_hold from booking_holds where id = p_hold_id;
  end if;

  return v_hold;
end;
$$;

revoke execute on function api_release_hold(uuid) from public;
grant execute on function api_release_hold(uuid) to authenticated, service_role;

create or replace function api_record_payment_checkout(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_checkout: paymentId required';
  end if;

  -- Grants are the primary gate (service_role only); defence in depth as in api_record_payment_charge.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;

  -- OVERWRITE (latest checkout wins): a re-pay opens a new checkout the sweep must query, so the most
  -- recent checkout id replaces any prior one -- no record-once guard here. Recording also RELEASES
  -- the single-flight checkout lease api_create_payment stamped, and touches updated_at so the
  -- 25-minute reuse window in api_create_payment anchors to when this session was actually minted
  -- (before this, updated_at only moved on payment events, so freshness was anchored to creation).
  update payments
  set prev_provider_checkout_id = case
        when provider_checkout_id is not null
             and provider_checkout_id is distinct from left(btrim(p ->> 'checkoutId'), 128)
        then provider_checkout_id
        else prev_provider_checkout_id
      end,
      provider_checkout_id = left(btrim(p ->> 'checkoutId'), 128),
      checkout_claimed_until = null,
      updated_at = now()
  where id = v_payment_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_record_payment_checkout(jsonb) from public, anon, authenticated;
grant execute on function api_record_payment_checkout(jsonb) to service_role;

-- Lock SECURITY DEFINER functions that leaked EXECUTE to anon + authenticated (a `revoke from public`
-- does not remove Supabase's default anon/authenticated grants). append_payment_event had NO caller
-- guard → an authenticated user could forge a 'paid' event and self-confirm a booking (payment bypass).
-- The rest are server/service_role-only or performed inside other definer functions / a trigger, never
-- called by the browser client. (used_capacity is intentionally left — it's read-only and called by the
-- SECURITY INVOKER api_get_activity/booking_json, so anon/authenticated must keep EXECUTE on it.)
revoke execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) to service_role;

revoke execute on function release_hold(uuid) from public, anon, authenticated;
grant execute on function release_hold(uuid) to service_role;

revoke execute on function run_booking_maintenance(jsonb) from public, anon, authenticated;
grant execute on function run_booking_maintenance(jsonb) to service_role;

revoke execute on function expire_holds() from public, anon, authenticated;
grant execute on function expire_holds() to service_role;

revoke execute on function enqueue_booking_notification() from public, anon, authenticated;
grant execute on function enqueue_booking_notification() to service_role;

revoke execute on function claim_notifications(jsonb) from public, anon, authenticated;
grant execute on function claim_notifications(jsonb) to service_role;

revoke execute on function mark_notification(jsonb) from public, anon, authenticated;
grant execute on function mark_notification(jsonb) to service_role;

-- Fleet photo for the Nissan Note (public asset public/rental/nissan-note.webp). Idempotent + fills only
-- an empty slot so an admin Image URL change is never clobbered by re-running this script.
update rental_vehicles
set image_url = '/rental/nissan-note.webp'
where slug = 'nissan-note' and (image_url is null or image_url = '');
