-- 20261006000000_booking_change_option
-- Staff change-of-tour with the price difference collected.
--
-- A guest who has paid for one tour asks to move to a DIFFERENT one and pay the difference. Nothing
-- could do this: api_reschedule_booking pins the move to the SAME option on purpose ("same option =
-- same price, so no money moves"), and the only post-booking charge in the schema is the late-pickup
-- supplement, whose fee is re-derived from coordinates and cannot carry an arbitrary difference.
--
-- Design: docs/superpowers/specs/2026-08-30-booking-change-option-design.md
--
-- THREE FLOWS, ONE REQUEST TABLE. The commit rule differs by sign, and conflating them is the bug
-- this header exists to prevent:
--   difference > 0  hold the target seat, commit ONLY when the difference settles (the pickup add-on
--                   shape: park the intent, let a settlement trigger apply it).
--   difference = 0  commit immediately, no payments row at all.
--   difference < 0  commit immediately and then OWE money back. There is nothing to wait for, and
--                   withholding the move would strand the guest on a tour they have told us they do
--                   not want while a hand-performed refund catches up.
--
-- WHAT IS REUSED RATHER THAN REBUILT:
--   * booking_holds — expires_at is a per-row column (the 15-minute value is only a DEFAULT), and
--     both expire_holds() and used_capacity() key off that timestamp alone. A 48-hour proposal hold
--     is an ordinary hold row with an explicit expiry: no new column, no change to the sweeper.
--   * payments.purpose — a fourth value, scoped exactly as 'pickup_addon' is, so a booking re-pay can
--     never pick up the change row and vice versa.
--   * append_payment_event — the refund of a cheaper move is an ordinary refund event with its own
--     synthesised id, so refunded_minor and the booking roll-up need no special case.
--
-- Keep this file identical to the copy appended to supabase/catch-up.sql.
-- Re-run supabase/catch-up.sql after applying (idempotent).

-- ---------------------------------------------------------------------------
-- 1) payments.purpose — a fourth kind of money.
--    Named in THREE places that must stay in step: this constraint, the `purpose` union in
--    src/lib/supabase/types.ts, and the Zod enum in src/lib/validation/booking.ts. A DB label Zod
--    lacks fails every READ of a row carrying it, not just writes.
-- ---------------------------------------------------------------------------
alter table payments drop constraint if exists payments_purpose_check;
alter table payments add constraint payments_purpose_check
  check (purpose in ('booking', 'pickup_addon', 'balance', 'change_addon'));

-- ---------------------------------------------------------------------------
-- 2) booking_change_requests — the parked intent.
-- ---------------------------------------------------------------------------
create table if not exists booking_change_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  from_option_id uuid not null references activity_options (id) on delete restrict,
  to_option_id uuid not null references activity_options (id) on delete restrict,
  to_occurrence_id uuid not null references session_occurrences (id) on delete restrict,
  old_total_minor bigint not null,
  new_total_minor bigint not null,
  difference_minor bigint not null,
  payment_id uuid references payments (id) on delete set null,
  hold_id uuid references booking_holds (id) on delete set null,
  expires_at timestamptz,
  applied_at timestamptz,
  refunded_at timestamptz,
  withdrawn_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- WHAT "BEFORE" AND "AFTER" ACTUALLY WERE (added once real testing showed the confirmation email and
-- the booking page could only ever describe the booking's CURRENT state — apply_booking_change
-- overwrites booking_items in place, so nothing else in the schema remembers the old tour).
--
-- from_occurrence_id is `on delete set null`, NOT `restrict` like its to_occurrence_id sibling: a
-- session_occurrences row genuinely gets hard-deleted by discontinue_option / option_closed_weekdays
-- (both `delete ... where not exists (booking_items referencing it)`), and the moment a change
-- repoints booking_items away, the OLD occurrence has zero references and becomes exactly the "empty
-- future slot" that cleanup targets. A restrict FK here would make that unrelated cleanup abort the
-- day someone discontinues an option a guest was once moved off. to_occurrence_id (already shipped,
-- load-bearing for the repoint) carries the identical latent hazard; left alone deliberately -- fixing
-- it touches tested code this migration doesn't own.
--
-- from_*/to_* activity title, option name and starts_at are SNAPSHOTS, not live joins -- matching how
-- booking_items.price_label is already denormalized at booking time rather than read live. Both sides
-- are captured, not just "from": if a booking changes tour twice, change #1's "to" tour becomes
-- change #2's "from" tour, and it can itself be renamed or archived later.
--
-- from_items/to_items snapshot {id, priceLabel, quantity, unitAmountMinor, subtotalMinor}[] immediately
-- before/after the move. price_label and quantity are already invariant across a change (the UPDATE
-- below never touches them) -- captured anyway so nothing downstream has to assume that stays true.
-- Note: neither array foots exactly to old_total_minor/new_total_minor when a transport add-on is
-- attached (change_request_quote folds transport_fare_minor into both totals so it nets to zero in
-- differenceMinor, but the item snapshot only captures booking_items columns) -- matches how the
-- invoice itself already separates tour lines from a transport line; not a bug.
alter table booking_change_requests add column if not exists from_occurrence_id uuid
  references session_occurrences (id) on delete set null;
alter table booking_change_requests add column if not exists from_activity_title text;
alter table booking_change_requests add column if not exists from_option_name text;
alter table booking_change_requests add column if not exists from_starts_at timestamptz;
alter table booking_change_requests add column if not exists to_activity_title text;
alter table booking_change_requests add column if not exists to_option_name text;
alter table booking_change_requests add column if not exists to_starts_at timestamptz;
alter table booking_change_requests add column if not exists from_items jsonb;
alter table booking_change_requests add column if not exists to_items jsonb;

create index if not exists bcr_booking_idx on booking_change_requests (booking_id);
create index if not exists bcr_payment_idx on booking_change_requests (payment_id);
-- The open-request lookup every path does: one partial index serves create_payment's payability
-- check, the supersede branch and the admin drawer.
create index if not exists bcr_open_idx on booking_change_requests (booking_id)
  where applied_at is null and withdrawn_at is null;

comment on table booking_change_requests is
  'A staff proposal to move a paid booking onto a different activity option. applied_at is the '
  'idempotency guard for the settlement path (the webhook, the reconcile sweep and the guest sync '
  'poll all reach apply_booking_change). difference_minor is SIGNED: positive = the guest owes, '
  'negative = we owe. Prices are re-derived in SQL, never sent by the browser.';

alter table booking_change_requests enable row level security;

-- GRANTS ARE SEPARATE FROM RLS, and both directions bite here.
--
-- Too few: a new table's policies are unreachable without a grant, and it answers "permission denied"
-- rather than "no rows" — which is how the guest-surface test first failed.
--
-- Too many: Supabase's default privileges on `public` hand anon AND authenticated the full
-- insert/update/delete set on every new table, so "I only granted select" is not what the database
-- ends up believing. `booking_pickup_requests` revokes anon outright and this table matches it.
-- Verified with has_table_privilege(), never information_schema.role_table_grants, which has
-- previously reported a live anon grant as absent.
--
-- Anon needs nothing: booking_open_change_json is only ever evaluated for a row api_get_booking
-- already returned, and bookings_select is `user_id = auth.uid() or is_staff()`, which no anonymous
-- caller can satisfy. Authenticated needs SELECT only — every write goes through a SECURITY DEFINER
-- RPC that runs as the owner, so revoking writes here costs staff nothing and leaves the table with
-- no direct write path at all.
revoke all on booking_change_requests from public, anon, authenticated;
grant select on booking_change_requests to authenticated;
grant select, insert, update, delete on booking_change_requests to service_role;

-- Staff see and manage everything; the owning customer may READ their own (the booking page shows a
-- pending upgrade and its pay link). No customer write path exists — proposing is staff-only.
drop policy if exists bcr_staff_all on booking_change_requests;
create policy bcr_staff_all on booking_change_requests for all
  using (is_staff()) with check (is_staff());

drop policy if exists bcr_owner_select on booking_change_requests;
create policy bcr_owner_select on booking_change_requests for select
  using (
    exists (
      select 1 from bookings b
       where b.id = booking_change_requests.booking_id
         and b.user_id is not null
         and b.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3) change_request_quote — the priced preview, shared by the propose path and the admin UI.
--
--    ONE definition of what a move costs, called by both api_booking_change_quote (read-only, drives
--    the admin panel's live figure) and api_propose_booking_change (the write). Two spellings of this
--    arithmetic would be a live money bug the first time one of them drifted.
--
--    Pricing rule: each existing booking_items row is re-priced against the TARGET option using the
--    SAME price_label. A target that does not sell that label is refused rather than guessed at — an
--    "Adult" line silently re-priced as the target's cheapest tier is a wrong charge, and a wrong
--    charge on a VAT invoice is worse than a refusal a human can act on.
-- ---------------------------------------------------------------------------
create or replace function change_request_quote(p_booking_id uuid, p_occurrence_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_target session_occurrences;
  v_to_option activity_options;
  v_to_activity activities;
  v_from_option uuid;
  v_option_count int;
  v_old bigint;
  v_new bigint := 0;
  v_units int;
  v_missing text;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Same gate as api_reschedule_booking: a draft/held/payment_pending booking has no seat to move,
  -- and a cancelled/refunded one is finished.
  if not (v_booking.status = 'confirmed' and v_booking.payment_state = 'paid') then
    raise exception 'not_changeable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- One option per booking is the only shape this can honour, mirroring api_reschedule_booking's
  -- v_option_count guard. booking_items has no per-item status, so a partial move has no
  -- representation; fail loudly rather than silently moving half a booking.
  select count(distinct bi.activity_option_id) into v_option_count
    from booking_items bi where bi.booking_id = v_booking.id;
  if v_option_count <> 1 then
    raise exception 'not_changeable'
      using detail = format('booking spans %s options', v_option_count);
  end if;

  select bi.activity_option_id into v_from_option
    from booking_items bi where bi.booking_id = v_booking.id order by bi.id limit 1;

  select * into v_target from session_occurrences where id = p_occurrence_id;
  if not found then
    raise exception 'occurrence_not_found';
  end if;

  select * into v_to_option from activity_options where id = v_target.activity_option_id;
  select * into v_to_activity from activities where id = v_to_option.activity_id;

  if v_to_activity.status <> 'published' or coalesce(v_to_option.status, 'active') <> 'active' then
    raise exception 'target_not_bookable' using detail = 'activity or option not live';
  end if;

  -- THE DEPARTURE MUST STILL BE AHEAD OF US, the same guard api_reschedule_booking applies to its
  -- target. Without it a September booking could be moved onto a departure that left this morning:
  -- the admin picker defaults to a date, and "the only departure listed" is a very easy thing to
  -- select by accident. Checked HERE as well as in the write path so the priced preview refuses it
  -- too, rather than showing a happy figure the propose call then rejects.
  if v_target.status <> 'open' or v_target.starts_at <= now() then
    raise exception 'target_not_bookable' using detail = v_target.status;
  end if;

  -- THE UNIT-SEMANTICS REFUSAL, on both sides of the move. A private or vehicle option counts the
  -- pool in TRIPS, not heads: create_booking writes quantity 1 with the real party in `pax`. Moving a
  -- per-person booking onto such an option (or off one) would either reserve N departures for one
  -- party or charge for N while reserving one. Neither is a guess worth making on the money path, and
  -- api_convert_quote refuses the same shape for the same reason.
  if v_to_option.private_base_minor is not null
     or coalesce(v_to_activity.pricing_mode::text, 'per_person') in ('vehicle', 'vehicle_custom') then
    raise exception 'not_changeable' using detail = 'target is a private/vehicle option';
  end if;
  if exists (
    select 1
      from activity_options o
      join activities a on a.id = o.activity_id
     where o.id = v_from_option
       and (o.private_base_minor is not null
            or coalesce(a.pricing_mode::text, 'per_person') in ('vehicle', 'vehicle_custom'))
  ) then
    raise exception 'not_changeable' using detail = 'source is a private/vehicle option';
  end if;

  -- The booking's own current itemised total, and its UNIT count (sum(quantity)) — the same unit
  -- occurrence.capacity and used_capacity() are denominated in. Gating capacity on the PEOPLE count
  -- would demand six free vans for a six-guest transfer.
  select coalesce(sum(bi.subtotal_minor), 0), coalesce(sum(bi.quantity), 0)
    into v_old, v_units
    from booking_items bi where bi.booking_id = v_booking.id;

  -- Re-price every line against the target option by label. No unique constraint exists on
  -- (activity_option_id, label), so the lowest-position row wins deterministically.
  select string_agg(distinct bi.price_label, ', ') into v_missing
    from booking_items bi
   where bi.booking_id = v_booking.id
     and not exists (
       select 1 from activity_option_prices pr
        where pr.activity_option_id = v_to_option.id and pr.label = bi.price_label
     );
  if v_missing is not null then
    raise exception 'change_price_unavailable' using detail = v_missing;
  end if;

  select coalesce(sum(
           bi.quantity * (
             select pr.amount_minor from activity_option_prices pr
              where pr.activity_option_id = v_to_option.id and pr.label = bi.price_label
              order by pr.position, pr.id limit 1
           )
         ), 0)
    into v_new
    from booking_items bi where bi.booking_id = v_booking.id;

  -- The attached transport add-on rides across untouched: it is a transfer fare, priced off the
  -- pickup region, not off the tour. It sits in both totals so the difference nets to zero for it.
  select v_old + coalesce(sum(bi.transport_fare_minor), 0),
         v_new + coalesce(sum(bi.transport_fare_minor), 0)
    into v_old, v_new
    from booking_items bi where bi.booking_id = v_booking.id;

  return jsonb_build_object(
    'bookingId', v_booking.id,
    'fromOptionId', v_from_option,
    'toOptionId', v_to_option.id,
    'toOccurrenceId', v_target.id,
    'toActivityTitle', v_to_activity.title,
    'toOptionName', v_to_option.name,
    'startsAt', v_target.starts_at,
    'units', v_units,
    'oldTotalMinor', v_old,
    'newTotalMinor', v_new,
    'differenceMinor', v_new - v_old,
    'capacityLeft', greatest(v_target.capacity - used_capacity(v_target.id), 0)
  );
end;
$$;

revoke execute on function change_request_quote(uuid, uuid) from public, anon, authenticated;
grant execute on function change_request_quote(uuid, uuid) to service_role;

-- Staff-facing read-only wrapper: drives the live figure in the admin panel before anything is
-- written. is_staff() is checked HERE because the inner function is a definer helper.
create or replace function api_booking_change_quote(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  return change_request_quote(
    nullif(p ->> 'bookingId', '')::uuid,
    nullif(p ->> 'occurrenceId', '')::uuid
  );
end;
$$;

revoke execute on function api_booking_change_quote(jsonb) from public, anon;
grant execute on function api_booking_change_quote(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Notifications.
--
--    Owner alerts are EMAIL ONLY, deliberately: resolveOwnerRecipient() throws for an unset Telegram
--    chat id or WhatsApp number and both are unset in production, so enqueuing those rows would
--    create permanently-failing outbox rows rather than delivering anything.
-- ---------------------------------------------------------------------------
create or replace function notify_booking_change_applied(p_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req booking_change_requests;
  v_booking bookings;
  v_change_payment payments;
  v_booking_payment payments;
  v_charged_amount_minor bigint;
  v_charged_currency text;
  v_charged_is_estimate boolean := false;
  v_guest_template text;
begin
  -- v_req already carries every from_*/to_* field apply_booking_change just wrote -- no join needed
  -- here at all (this function used to run its own redundant title/starts_at lookup off
  -- to_option_id/to_occurrence_id; deleted, since the row now IS the source of truth).
  select * into v_req from booking_change_requests where id = p_request_id;
  if not found then
    return;
  end if;
  select * into v_booking from bookings where id = v_req.booking_id;
  if not found then
    return;
  end if;

  -- OWNER SIDE: fires for all three signs -- this is the "run sheet changed" alert, distinct from
  -- the invoice question the guest-side branch below answers. The MUR figure is exact for an
  -- upgrade (read off the payment that actually settled) and a pro-rata ESTIMATE for a downgrade
  -- (no change_addon payment exists yet to read an exact figure off -- the refund hasn't happened).
  if v_req.difference_minor > 0 then
    select * into v_change_payment from payments where id = v_req.payment_id;
    v_charged_amount_minor := v_change_payment.charged_amount_minor;
    v_charged_currency := v_change_payment.charged_currency;
  elsif v_req.difference_minor < 0 then
    -- The same row api_record_change_refund will later reverse against.
    select * into v_booking_payment from payments
     where booking_id = v_req.booking_id and purpose = 'booking'
     order by created_at limit 1;
    if v_booking_payment.charged_amount_minor is not null and coalesce(v_booking_payment.paid_minor, 0) > 0 then
      v_charged_amount_minor := round(
        v_booking_payment.charged_amount_minor * abs(v_req.difference_minor)::numeric
        / v_booking_payment.paid_minor
      );
      v_charged_currency := v_booking_payment.charged_currency;
      v_charged_is_estimate := true;
    end if;
  end if;

  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'owner_booking_changed',
    jsonb_build_object(
      'ref', v_booking.ref,
      'customerName', v_booking.customer_name,
      'customerPhone', v_booking.customer_phone,
      'activityTitle', v_req.to_activity_title,
      'startsAt', v_req.to_starts_at,
      'differenceEur', v_req.difference_minor::float / 100,
      'newTotalEur', v_req.new_total_minor::float / 100,
      'chargedAmountMinor', v_charged_amount_minor,
      'chargedCurrency', v_charged_currency,
      'chargedIsEstimate', v_charged_is_estimate
    ),
    v_req.booking_id,
    'booking_changed_owner:' || p_request_id::text
  )
  on conflict (idempotency_key) do nothing;

  -- GUEST SIDE: the template itself branches on sign, not just the copy inside one template --
  -- money-timing correctness demands it. paid_minor still reflects the OLD, higher amount until
  -- api_record_change_refund actually runs, so a downgrade must NOT route through the invoice-with-
  -- PDF pipeline yet (it would show paid > total, a nonsensical negative-balance document); it gets
  -- a lightweight, PDF-less notice instead. Upgrade-settled and level moves are both safe to invoice
  -- immediately -- for an upgrade, balance_due_minor is already correct by this point (fixed
  -- upstream in append_payment_event); a level move never touched payment state at all.
  v_guest_template := case when v_req.difference_minor < 0
                           then 'booking_change_refund_pending'
                           else 'booking_changed' end;

  if v_booking.customer_email is not null then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_booking.customer_email, v_guest_template,
      jsonb_build_object(
        'ref', v_booking.ref,
        'customerName', v_booking.customer_name,
        'fromActivityTitle', v_req.from_activity_title,
        'fromOptionName', v_req.from_option_name,
        'fromStartsAt', v_req.from_starts_at,
        'fromTotalEur', v_req.old_total_minor::float / 100,
        'toActivityTitle', v_req.to_activity_title,
        'toOptionName', v_req.to_option_name,
        'toStartsAt', v_req.to_starts_at,
        'toTotalEur', v_req.new_total_minor::float / 100,
        'differenceEur', v_req.difference_minor::float / 100,
        'locale', v_booking.locale::text
      ),
      v_req.booking_id,
      'booking_changed_guest:' || p_request_id::text
    )
    on conflict (idempotency_key) do nothing;
  end if;
end;
$$;

revoke execute on function notify_booking_change_applied(uuid) from public, anon, authenticated;
grant execute on function notify_booking_change_applied(uuid) to service_role;

-- THE OFFER MAIL — sent when staff PROPOSE an upgrade, not when it completes.
--
-- Without this the flow has no way to reach the guest: staff park a proposal, a seat is held, and the
-- only surface that can pay it is a block on the guest's own booking page which they have no reason
-- to revisit. The operator would have to chase by hand, which is the work this feature exists to
-- remove. Upgrades only — a level or cheaper move is applied on the spot and owes nothing.
create or replace function notify_booking_change_offer(p_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req booking_change_requests;
  v_booking bookings;
  v_title text;
  v_starts_at timestamptz;
begin
  select * into v_req from booking_change_requests where id = p_request_id;
  if not found or v_req.difference_minor <= 0 or v_req.applied_at is not null then
    return;
  end if;
  select * into v_booking from bookings where id = v_req.booking_id;
  if not found or v_booking.customer_email is null then
    return;
  end if;

  select a.title, so.starts_at
    into v_title, v_starts_at
    from activity_options o
    join activities a on a.id = o.activity_id
    join session_occurrences so on so.id = v_req.to_occurrence_id
   where o.id = v_req.to_option_id;

  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', v_booking.customer_email, 'booking_change_offer',
    jsonb_build_object(
      'ref', v_booking.ref,
      'customerName', v_booking.customer_name,
      'activityTitle', v_title,
      'startsAt', v_starts_at,
      'differenceEur', v_req.difference_minor::float / 100,
      'newTotalEur', v_req.new_total_minor::float / 100,
      'expiresAt', v_req.expires_at,
      'locale', v_booking.locale::text
    ),
    v_req.booking_id,
    'change_offer_guest:' || p_request_id::text
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke execute on function notify_booking_change_offer(uuid) from public, anon, authenticated;
grant execute on function notify_booking_change_offer(uuid) to service_role;

-- A settled change payment that could NOT be applied. EVERY branch that refuses to move the booking
-- routes here, because the alternative is keeping a guest's money with no record anyone will ever
-- look at. Email only, idempotent per payment: the reconcile sweep re-queries the same capture for
-- hours. Silent for the one normal case, a replay of a request already applied.
create or replace function notify_change_orphan_payment(p_payment_id uuid)
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
  if not found or v_payment.purpose <> 'change_addon' or v_payment.paid_minor <= 0 then
    return;
  end if;

  -- Applied in full already => this is a replay, not an orphan.
  if exists (
    select 1 from booking_change_requests r
     where r.payment_id = p_payment_id and r.applied_at is not null
  ) then
    return;
  end if;

  select * into v_booking from bookings where id = v_payment.booking_id;
  -- A booking already cancelled/expired/refunded had this capture routed to refund_pending by
  -- append_payment_event, which raises its own owner alert. Do not send a second one for it.
  if v_booking.status not in ('confirmed', 'completed') then
    return;
  end if;

  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'owner_change_orphan_payment',
    jsonb_build_object(
      'ref', v_booking.ref,
      'customerName', v_booking.customer_name,
      'differenceEur', v_payment.amount_minor::float / 100,
      'chargedAmountMinor', v_payment.charged_amount_minor,
      'chargedCurrency', v_payment.charged_currency
    ),
    v_booking.id,
    'change_orphan:' || p_payment_id::text
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke execute on function notify_change_orphan_payment(uuid) from public, anon, authenticated;
grant execute on function notify_change_orphan_payment(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5) apply_booking_change - the ONLY thing that actually moves a booking.
-- ---------------------------------------------------------------------------
create or replace function apply_booking_change(p_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req booking_change_requests;
  v_booking bookings;
  v_target session_occurrences;
  v_units int;
  v_available int;
  v_called_off boolean;
  v_from_occurrence_id uuid;
  v_from_starts_at timestamptz;
  v_from_activity_title text;
  v_from_option_name text;
  v_to_activity_title text;
  v_to_option_name text;
  v_from_items jsonb;
  v_to_items jsonb;
  v_settled_sum bigint;
begin
  -- `applied_at is null` is the whole idempotency story: a replayed webhook, the reconcile sweep and
  -- the guest's own sync poll all land here, and only the first one moves anything.
  select * into v_req from booking_change_requests
   where id = p_request_id and applied_at is null and withdrawn_at is null
   for update;
  if not found then
    return;
  end if;

  select * into v_booking from bookings where id = v_req.booking_id for update;
  if not found then
    return;
  end if;

  -- The booking must still be live. A capture on a session minted before the guest cancelled (Peach
  -- sessions stay completable ~30 min) would otherwise upgrade a cancelled booking.
  --
  -- 'completed' counts as live, exactly as it does in append_payment_event, api_mark_refunded and the
  -- capacity count. Excluding it is how the pickup supplement once silently KEPT money on a trip the
  -- owner had already marked complete: that branch routes nothing to refund_pending either.
  if v_booking.status not in ('confirmed', 'completed') then
    if v_req.payment_id is not null then
      perform notify_change_orphan_payment(v_req.payment_id);
    end if;
    return;
  end if;

  -- ...and the target departure must still be running, and the booking must not be awaiting a
  -- disruption choice. api_weather_cancel_occurrence leaves a booking 'confirmed' with its items on a
  -- cancelled occurrence, so the status check above sails straight past a called-off trip.
  -- `starts_at <= now()` matters MOST here: a proposal is payable for hours, so the guest can settle
  -- it after the departure they were being moved onto has already left. Moving them onto a departed
  -- trip and keeping the money is the worst available outcome, so this routes to the orphan alert.
  select * into v_target from session_occurrences where id = v_req.to_occurrence_id for update;
  if not found
     or v_target.status <> 'open'
     or v_target.starts_at <= now()
     or booking_awaiting_choice(v_booking.disruption) then
    if v_req.payment_id is not null then
      perform notify_change_orphan_payment(v_req.payment_id);
    end if;
    return;
  end if;

  select exists (
    select 1
      from booking_items bi
      join session_occurrences so on so.id = bi.session_occurrence_id
     where bi.booking_id = v_req.booking_id and so.status = 'cancelled'
  ) into v_called_off;
  if v_called_off then
    if v_req.payment_id is not null then
      perform notify_change_orphan_payment(v_req.payment_id);
    end if;
    return;
  end if;

  -- CAPACITY, RE-CHECKED AT THE MOMENT OF THE MOVE. The proposal's hold reserves the seat, but a
  -- level/cheaper move takes no hold at all, and an upgrade's hold can have lapsed while the guest sat
  -- on the payment page. used_capacity() counts this booking's OWN hold, so it is discounted here:
  -- otherwise the guest's own reservation would block their own move.
  select coalesce(sum(bi.quantity), 0) into v_units
    from booking_items bi where bi.booking_id = v_req.booking_id;

  v_available := v_target.capacity - used_capacity(v_target.id)
    + coalesce((
        select h.quantity from booking_holds h
         where h.id = v_req.hold_id and h.status = 'active' and h.expires_at > now()
      ), 0);
  if v_available < v_units then
    if v_req.payment_id is not null then
      perform notify_change_orphan_payment(v_req.payment_id);
    end if;
    return;
  end if;

  -- SNAPSHOT THE "BEFORE" STATE, one query each, before anything is overwritten. Read straight off
  -- the booking's current lines/occurrence -- the same shape change_request_quote and
  -- api_propose_booking_change already read when this move was priced, just captured now instead of
  -- discarded, since apply_booking_change is the last moment this data is still live.
  select bi.session_occurrence_id, so.starts_at
    into v_from_occurrence_id, v_from_starts_at
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_req.booking_id
   order by bi.id limit 1;

  select a.title, o.name into v_from_activity_title, v_from_option_name
    from activity_options o join activities a on a.id = o.activity_id
   where o.id = v_req.from_option_id;

  select a.title, o.name into v_to_activity_title, v_to_option_name
    from activity_options o join activities a on a.id = o.activity_id
   where o.id = v_req.to_option_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', bi.id, 'priceLabel', bi.price_label, 'quantity', bi.quantity,
           'unitAmountMinor', bi.unit_amount_minor, 'subtotalMinor', bi.subtotal_minor
         )), '[]'::jsonb)
    into v_from_items
    from booking_items bi where bi.booking_id = v_req.booking_id;

  -- THE MOVE. Every line is re-pointed and re-priced against the target option, by label - the same
  -- rule change_request_quote costed. subtotal is recomputed from the fresh unit price rather than
  -- scaled, so a rounding difference can never accumulate across repeated changes.
  update booking_items bi
     set session_occurrence_id = v_req.to_occurrence_id,
         activity_option_id = v_req.to_option_id,
         unit_amount_minor = (
           select p2.amount_minor from activity_option_prices p2
            where p2.activity_option_id = v_req.to_option_id and p2.label = bi.price_label
            order by p2.position, p2.id limit 1
         ),
         subtotal_minor = bi.quantity * (
           select p2.amount_minor from activity_option_prices p2
            where p2.activity_option_id = v_req.to_option_id and p2.label = bi.price_label
            order by p2.position, p2.id limit 1
         )
   where bi.booking_id = v_req.booking_id;

  -- THE "AFTER" SNAPSHOT, same shape as "before" -- same row ids (only price/occurrence/option
  -- columns changed), taken as its own read rather than assumed from the update, so this stays
  -- correct even if a future edit widens what the UPDATE touches.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', bi.id, 'priceLabel', bi.price_label, 'quantity', bi.quantity,
           'unitAmountMinor', bi.unit_amount_minor, 'subtotalMinor', bi.subtotal_minor
         )), '[]'::jsonb)
    into v_to_items
    from booking_items bi where bi.booking_id = v_req.booking_id;

  -- The booking total follows its lines. operator_payout moves by the same delta the pickup add-on
  -- moves it by, so the payout view stays consistent with what was actually sold.
  --
  -- balance_due_minor is recomputed here too, not left alone: for an upgrade/level move it is a
  -- no-op (append_payment_event's own recompute on the settling change_addon payment -- or, for a
  -- level move, no payment event at all -- already leaves it correct). For a DOWNGRADE applied
  -- against a still-open-balance booking (change_request_quote's gate only checks
  -- payment_state = 'paid', which a settled deposit satisfies even with balance_due_minor > 0), this
  -- function runs standalone with no payment event to fix it up, and total_minor dropping while
  -- balance_due_minor stayed at its pre-change figure would overstate what the guest still owes by
  -- the size of the price cut. Mirrors append_payment_event's own projection exactly (same purpose/
  -- applied-add-on scoping), so a booking that was never in this state recomputes to the same figure
  -- it already had.
  select coalesce(sum(pay.paid_minor - pay.refunded_minor), 0)
    into v_settled_sum
    from payments pay
   where pay.booking_id = v_req.booking_id
     and (
       pay.purpose in ('booking', 'balance')
       or exists (
         select 1 from booking_pickup_requests r
          where r.payment_id = pay.id and r.applied_at is not null and r.fee_minor > 0
       )
       or exists (
         select 1 from booking_change_requests r
          where r.payment_id = pay.id and r.applied_at is not null
       )
     );

  update bookings
     set total_minor = v_req.new_total_minor,
         operator_payout_minor = operator_payout_minor + v_req.difference_minor,
         balance_due_minor = greatest(0, v_req.new_total_minor - v_settled_sum),
         updated_at = now()
   where id = v_req.booking_id;

  -- The hold has done its job; mark it consumed so it stops counting against the pool immediately
  -- rather than lingering until expire_holds() sweeps it.
  if v_req.hold_id is not null then
    update booking_holds set status = 'consumed' where id = v_req.hold_id and status = 'active';
  end if;

  update booking_change_requests
     set applied_at = now(), updated_at = now(),
         from_occurrence_id = v_from_occurrence_id,
         from_activity_title = v_from_activity_title,
         from_option_name = v_from_option_name,
         from_starts_at = v_from_starts_at,
         to_activity_title = v_to_activity_title,
         to_option_name = v_to_option_name,
         to_starts_at = v_target.starts_at,
         from_items = v_from_items,
         to_items = v_to_items
   where id = v_req.id;

  perform notify_booking_change_applied(v_req.id);
end;
$$;

revoke execute on function apply_booking_change(uuid) from public, anon, authenticated;
grant execute on function apply_booking_change(uuid) to service_role;

create or replace function trg_apply_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req_id uuid;
begin
  select id into v_req_id from booking_change_requests
   where payment_id = new.id and applied_at is null and withdrawn_at is null
   limit 1;
  if v_req_id is not null then
    perform apply_booking_change(v_req_id);
  else
    -- Money with nothing to apply it to.
    perform notify_change_orphan_payment(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists payments_apply_booking_change on payments;
create trigger payments_apply_booking_change
after update of status on payments
for each row
when (new.purpose = 'change_addon' and new.status = 'paid' and old.status is distinct from 'paid')
execute function trg_apply_booking_change();

-- ---------------------------------------------------------------------------
-- 6) api_propose_booking_change - the staff entry point. p = { ref, occurrenceId, expiresInHours? }
--
--    There is NO customer-facing entry point. Proposing a change re-prices a paid booking, and a
--    customer who could aim that at their own booking could move themselves onto a cheaper tour and
--    trigger a refund. Staff only, checked here, and the underlying helpers are service_role-only.
-- ---------------------------------------------------------------------------
create or replace function api_propose_booking_change(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(p ->> 'ref', '');
  v_occ_id uuid := nullif(p ->> 'occurrenceId', '')::uuid;
  v_hours int := least(greatest(coalesce((p ->> 'expiresInHours')::int, 48), 1), 336);
  v_booking bookings;
  v_target session_occurrences;
  v_quote jsonb;
  v_diff bigint;
  v_units int;
  v_available int;
  v_existing booking_change_requests;
  v_hold booking_holds;
  v_payment payments;
  v_req booking_change_requests;
  v_live boolean;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_ref is null or v_occ_id is null then
    raise exception 'invalid_request' using detail = 'propose_change: ref and occurrenceId required';
  end if;

  -- FOR UPDATE for the rest of the transaction: two staff proposing at once must serialise, or both
  -- would mint a hold and a payments row for the same booking.
  select * into v_booking from bookings where ref = v_ref for update;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Everything the move costs and every eligibility rule, in one place. Raises on its own for a
  -- non-changeable booking, a dead target, a private/vehicle option or a missing price tier.
  v_quote := change_request_quote(v_booking.id, v_occ_id);
  v_diff := (v_quote ->> 'differenceMinor')::bigint;
  v_units := (v_quote ->> 'units')::int;

  -- Refuse a no-op rather than minting an empty request: the booking is already on this departure.
  if exists (
    select 1 from booking_items bi
     where bi.booking_id = v_booking.id and bi.session_occurrence_id = v_occ_id
  ) and (v_quote ->> 'toOptionId')::uuid = (
    select bi.activity_option_id from booking_items bi
     where bi.booking_id = v_booking.id order by bi.id limit 1
  ) then
    raise exception 'change_is_noop';
  end if;

  -- Lock the TARGET before reading its capacity, mirroring create_hold and api_reschedule_booking:
  -- two parties racing for the last seat must serialise here, not both pass the check.
  select * into v_target from session_occurrences where id = v_occ_id for update;
  if not found then
    raise exception 'occurrence_not_found';
  end if;
  -- Open AND still ahead of us — see the same guard in change_request_quote.
  if v_target.status <> 'open' or v_target.starts_at <= now() then
    raise exception 'target_not_bookable' using detail = v_target.status;
  end if;

  -- SUPERSEDE any open proposal for this booking. Its hold is released so the seat it was reserving
  -- returns to the pool immediately rather than lingering for the expiry sweep.
  select * into v_existing from booking_change_requests
   where booking_id = v_booking.id and applied_at is null and withdrawn_at is null
   order by created_at desc limit 1;
  if found then
    -- Re-pricing under a LIVE checkout session is the refusal case: that session is still payable at
    -- the OLD figure, and moving amount_minor underneath it would make the guest's real settlement
    -- fail reconcile's pinned-expectation check and quarantine. Same rule api_request_pickup enforces.
    select (pay.provider_checkout_id is not null
            and coalesce(pay.checkout_claimed_until, now()) > now())
      into v_live
      from payments pay where pay.id = v_existing.payment_id;
    if coalesce(v_live, false) then
      raise exception 'change_payment_in_flight';
    end if;
    if v_existing.hold_id is not null then
      update booking_holds set status = 'released'
       where id = v_existing.hold_id and status = 'active';
    end if;
    update booking_change_requests
       set withdrawn_at = now(), updated_at = now()
     where id = v_existing.id;
  end if;

  -- Capacity in UNITS, never pax. A superseded hold has just been released above, so it is already
  -- out of used_capacity() by the time this reads.
  v_available := v_target.capacity - used_capacity(v_target.id);
  if v_available < v_units then
    raise exception 'insufficient_capacity'
      using detail = format('%s left, %s needed', v_available, v_units);
  end if;

  if v_diff > 0 then
    -- THE UPGRADE. Hold the seat, mint the payments row, park the request. Nothing on the booking
    -- moves until trg_apply_booking_change fires.
    insert into booking_holds (session_occurrence_id, booking_id, quantity, idempotency_key, expires_at)
    values (v_occ_id, v_booking.id, v_units,
            'change:' || v_booking.id::text || ':' || gen_random_uuid()::text,
            now() + make_interval(hours => v_hours))
    returning * into v_hold;

    insert into payments (booking_id, idempotency_key, amount_minor, purpose)
    values (v_booking.id, 'change:' || v_booking.id::text || ':' || gen_random_uuid()::text,
            v_diff, 'change_addon')
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_diff);
  end if;

  insert into booking_change_requests (
    booking_id, from_option_id, to_option_id, to_occurrence_id,
    old_total_minor, new_total_minor, difference_minor,
    payment_id, hold_id, expires_at, created_by
  ) values (
    v_booking.id,
    (v_quote ->> 'fromOptionId')::uuid,
    (v_quote ->> 'toOptionId')::uuid,
    v_occ_id,
    (v_quote ->> 'oldTotalMinor')::bigint,
    (v_quote ->> 'newTotalMinor')::bigint,
    v_diff,
    v_payment.id,
    v_hold.id,
    case when v_diff > 0 then now() + make_interval(hours => v_hours) end,
    auth.uid()
  )
  returning * into v_req;

  -- A level or cheaper move has nothing to wait for: commit it now. A cheaper one then owes money
  -- back, which api_record_change_refund settles once the owner has refunded in Peach. An UPGRADE
  -- instead emails the guest the offer — the held seat is worthless if nobody tells them it exists.
  if v_diff <= 0 then
    perform apply_booking_change(v_req.id);
    select * into v_req from booking_change_requests where id = v_req.id;
  else
    perform notify_booking_change_offer(v_req.id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'requestId', v_req.id,
    'applied', v_req.applied_at is not null,
    'differenceMinor', v_diff,
    'oldTotalMinor', v_req.old_total_minor,
    'newTotalMinor', v_req.new_total_minor,
    'paymentId', v_req.payment_id,
    'expiresAt', v_req.expires_at,
    'refundDueMinor', case when v_diff < 0 then -v_diff else 0 end
  );
end;
$$;

revoke execute on function api_propose_booking_change(jsonb) from public, anon;
grant execute on function api_propose_booking_change(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) api_withdraw_booking_change - staff cancel an unpaid proposal, returning the held seat.
-- ---------------------------------------------------------------------------
create or replace function api_withdraw_booking_change(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req_id uuid := nullif(p ->> 'requestId', '')::uuid;
  v_req booking_change_requests;
  v_live boolean;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_req_id is null then
    raise exception 'invalid_request' using detail = 'withdraw_change: requestId required';
  end if;

  select * into v_req from booking_change_requests where id = v_req_id for update;
  if not found then
    raise exception 'change_request_not_found';
  end if;
  -- Idempotent: withdrawing an already-withdrawn proposal reports, it does not error.
  if v_req.withdrawn_at is not null then
    return jsonb_build_object('ok', true, 'alreadyWithdrawn', true);
  end if;
  if v_req.applied_at is not null then
    raise exception 'change_already_applied';
  end if;

  -- Never pull the seat out from under a guest who is mid-payment: that session is live and could
  -- settle seconds later, and the capture would then land on a withdrawn request as an orphan.
  select (pay.provider_checkout_id is not null
          and coalesce(pay.checkout_claimed_until, now()) > now())
    into v_live
    from payments pay where pay.id = v_req.payment_id;
  if coalesce(v_live, false) then
    raise exception 'change_payment_in_flight';
  end if;

  if v_req.hold_id is not null then
    update booking_holds set status = 'released' where id = v_req.hold_id and status = 'active';
  end if;
  update booking_change_requests set withdrawn_at = now(), updated_at = now() where id = v_req.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_withdraw_booking_change(jsonb) from public, anon;
grant execute on function api_withdraw_booking_change(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) api_record_change_refund - the owner has refunded a cheaper move by hand in Peach; record it.
--
--    THE EVENT ID IS DELIBERATELY DISTINCT from api_mark_refunded's 'manual:refund:<payment_id>'.
--    Sharing it would make one path a silent no-op for the other: append_payment_event is idempotent
--    on (payment_id, provider_event_id, type), so a later full cancellation would find this id already
--    present and reverse NOTHING.
--
--    The arithmetic that has to hold afterwards: api_mark_refunded reverses
--    greatest(paid_minor - refunded_minor, 0) per row, oldest first. This leaves refunded_minor > 0 on
--    the 'booking' row, so a later cancellation reverses only the remainder and still lands the
--    booking at 'refunded' rather than stranding it at 'partially_refunded'. Covered by a test.
-- ---------------------------------------------------------------------------
create or replace function api_record_change_refund(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req_id uuid := nullif(p ->> 'requestId', '')::uuid;
  v_req booking_change_requests;
  v_payment payments;
  v_amount bigint;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_req_id is null then
    raise exception 'invalid_request' using detail = 'record_change_refund: requestId required';
  end if;

  select * into v_req from booking_change_requests where id = v_req_id for update;
  if not found then
    raise exception 'change_request_not_found';
  end if;
  if v_req.applied_at is null then
    raise exception 'change_not_applied';
  end if;
  if v_req.difference_minor >= 0 then
    raise exception 'no_refund_due';
  end if;
  -- Idempotent: a repeat click must not error or reverse a second time.
  if v_req.refunded_at is not null then
    return jsonb_build_object('ok', true, 'alreadyRecorded', true);
  end if;

  v_amount := -v_req.difference_minor;

  -- Reverse against the row that actually holds the guest's money for the booking itself. Scoped to
  -- purpose 'booking' on purpose: an unscoped "newest payment" would pick the change/pickup add-on row
  -- and reverse the wrong money, which is the exact shape of an earlier bug in this schema.
  select * into v_payment from payments
   where booking_id = v_req.booking_id and purpose = 'booking'
     and paid_minor > refunded_minor
   order by created_at
   limit 1;
  if not found then
    raise exception 'payment_not_found';
  end if;

  v_amount := least(v_amount, v_payment.paid_minor - v_payment.refunded_minor);
  if v_amount <= 0 then
    raise exception 'no_refund_due';
  end if;

  perform append_payment_event(
    v_payment.id,
    'refunded',
    'change:refund:' || v_req.id::text,
    v_amount,
    now(),
    jsonb_build_object('source', 'admin_change_refund', 'requestId', v_req.id)
  );

  update booking_change_requests set refunded_at = now(), updated_at = now() where id = v_req.id;

  perform notify_booking_change_refunded(v_req.id);

  return jsonb_build_object('ok', true, 'refundedMinor', v_amount);
end;
$$;

revoke execute on function api_record_change_refund(jsonb) from public, anon;
grant execute on function api_record_change_refund(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- notify_booking_change_refunded — the follow-up the guest is owed once the refund actually lands.
--
-- booking_changed (the immediate apply-time notice for a downgrade, routed to the PDF-less
-- 'booking_change_refund_pending' template) tells the guest a refund is coming; nothing until now
-- confirmed it arrived. THIN payload deliberately: unlike deposit_receipt, there is no race to
-- defend against here (no balance that could clear mid-flight before the row drains) -- by the time
-- this fires the booking is fully reconciled, so the enrich step's live re-fetch is strictly more
-- accurate than anything pinned at enqueue time.
--
-- No owner-facing copy of this. The owner just clicked the button themselves, after refunding in
-- Peach by hand -- they don't need telling about their own action, and they already saw the
-- estimated MUR figure in the apply-time owner_booking_changed alert.
-- ---------------------------------------------------------------------------
create or replace function notify_booking_change_refunded(p_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req booking_change_requests;
  v_booking bookings;
begin
  select * into v_req from booking_change_requests where id = p_request_id;
  if not found or v_req.refunded_at is null then
    return;
  end if;
  select * into v_booking from bookings where id = v_req.booking_id;
  if not found or v_booking.customer_email is null then
    return;
  end if;

  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', v_booking.customer_email, 'booking_change_refunded',
    jsonb_build_object(
      'ref', v_booking.ref,
      'customerName', v_booking.customer_name,
      'locale', v_booking.locale::text
    ),
    v_req.booking_id,
    'booking_change_refunded_guest:' || p_request_id::text
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke execute on function notify_booking_change_refunded(uuid) from public, anon, authenticated;
grant execute on function notify_booking_change_refunded(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9) create_payment - the WINNING body (20260930000000 lineage) VERBATIM plus the change_addon
--    branch. Re-applied in full rather than patched in place because this repo resolves "the last
--    migration to define a function wins": a later file carrying a stale body silently reverts an
--    earlier fix, which has already happened here more than once.
--    tests/integration/resolved-function-bodies.test.ts reads pg_proc.prosrc and fails if a future
--    re-definition drops either contract.
-- ---------------------------------------------------------------------------
create or replace function create_payment(p jsonb, p_enforce_caller_identity boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_payment payments;
  v_rate numeric;
  v_src text;
  v_at timestamptz;
  v_charged bigint;
  v_purpose text := coalesce(nullif(p ->> 'purpose', ''), 'booking');
  v_req booking_pickup_requests;
  v_chg booking_change_requests;
  -- The installment a 'balance' link names (null = the plain whole-balance link, unchanged). Its charge
  -- brings settlement up to that installment's running total; scopes the checkout lease so each dated
  -- link is its own single-flight session, not a fork of the previous installment's.
  v_installment_seq int := nullif(p ->> 'installmentSeq', '')::int;
  v_charge bigint;
begin
  if v_purpose not in ('booking', 'pickup_addon', 'balance', 'change_addon') then
    raise exception 'invalid_payment_purpose' using detail = v_purpose;
  end if;

  -- FOR UPDATE: every concurrent create-payment call for one booking serialises on this row for the
  -- rest of the transaction. That closes two races at once: two callers both inserting a payments row
  -- below, and — via the checkout lease — two callers both getting a green light to mint a Peach
  -- session. Peach's nonce is unique per REQUEST (it never dedupes), so without this lease two tabs
  -- or a retry could create two independently payable sessions for the same booking.
  -- (It also makes the charge pin race-free: one caller pins, the loser re-reads the pinned row.)
  --
  -- It is also what serialises the two ENTRY POINTS against each other: a staff member opening the
  -- checkout for a quote booking through api_create_payment and the guest clicking Pay through
  -- api_create_quote_payment reach this same lock, this same payments row and this same lease.
  select * into v_booking from bookings where ref = p ->> 'bookingRef' for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_purpose = 'booking' then
    if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
       or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
      raise exception 'booking_not_payable' using detail = v_booking.status::text;
    end if;
  elsif v_purpose = 'balance' then
    -- THE BALANCE'S OWN PAYABILITY. The deposit has already CONFIRMED the booking, so a 'booking' row
    -- here would trip the guard above (booking_not_payable) — which is exactly why the balance is a
    -- separate purpose, the same reason the pickup add-on is. What is left to collect is the booking's
    -- balance_due_minor, the projection append_payment_event maintains (add-on-immune, the true amount
    -- still owed). Payable only on a confirmed booking that still owes something; a fully-paid booking
    -- (balance_due_minor = 0) has nothing to charge, so it is refused with a readable code of its own —
    -- distinct from booking_not_payable, which the balance row could never itself provoke.
    if v_booking.status <> 'confirmed' then
      raise exception 'booking_not_payable' using detail = 'balance:' || v_booking.status::text;
    end if;
    if coalesce(v_booking.balance_due_minor, 0) <= 0 then
      raise exception 'balance_already_paid';
    end if;
    -- A DATED INSTALLMENT LINK. It charges the amount that brings this booking's settlement up to the
    -- installment's RUNNING total (Σ amounts of it and every earlier installment) — so paying a later
    -- date also clears any earlier unpaid one, which is correct because activities are chronological and
    -- an earlier date is already overdue by then. settled = total − balance_due (the projection). Nothing
    -- to charge means it, and everything before it, is already covered. All server-derived from the
    -- booking row + the schedule, never caller input — exactly like the deposit and the FX pin. The plain
    -- balance link (no installmentSeq) skips all of this and pays the whole balance, unchanged.
    if v_installment_seq is not null then
      if not exists (
        select 1 from booking_installments bi
         where bi.booking_id = v_booking.id and bi.seq = v_installment_seq
      ) then
        raise exception 'installment_not_found' using detail = v_installment_seq::text;
      end if;
      v_charge := greatest(0, least(
        v_booking.balance_due_minor,
        (select coalesce(sum(bi.amount_minor), 0)
           from booking_installments bi
          where bi.booking_id = v_booking.id and bi.seq <= v_installment_seq)
          - (v_booking.total_minor - v_booking.balance_due_minor)
      ));
      if v_charge <= 0 then
        raise exception 'installment_already_paid' using detail = v_installment_seq::text;
      end if;
    end if;
  elsif v_purpose = 'pickup_addon' then
    -- The add-on's own payability: an open request must exist, and the trip must not have left.
    select * into v_req from booking_pickup_requests
     where booking_id = v_booking.id and applied_at is null and payment_id is not null;
    if not found then
      raise exception 'pickup_request_not_found';
    end if;
    -- …and it must not ALREADY hold the guest's money. A request refused at settlement (the departure
    -- was called off) stays open behind a payments row that is already 'paid'. If the trip is then
    -- rescheduled onto a live date the eligibility ladder goes green again, and without this guard
    -- the booking page's "Complete payment" button minted a SECOND Peach session on that same row —
    -- charging the card twice for one supplement, invisibly: the apply trigger cannot fire again
    -- (its WHEN clause needs old.status distinct from 'paid'), so no second alert is raised either.
    if exists (
      select 1 from payments pay
       where pay.id = v_req.payment_id and pay.paid_minor >= pay.amount_minor and pay.amount_minor > 0
    ) then
      raise exception 'pickup_already_paid';
    end if;
    if not coalesce((pickup_addon_quote(v_booking.id, v_req.pickup_lat, v_req.pickup_lng) ->> 'eligible')::boolean, false) then
      raise exception 'booking_not_payable' using detail = 'pickup_addon';
    end if;
  else
    -- THE CHANGE ADD-ON's own payability. An open, unapplied proposal must exist behind a payments
    -- row, and its hold must not have lapsed -- a guest paying against an expired proposal would send
    -- money at a seat that has already returned to the pool, and apply_booking_change would refuse it
    -- as an orphan. Refusing at the SELL side is the cheaper failure.
    select * into v_chg from booking_change_requests
     where booking_id = v_booking.id and applied_at is null and withdrawn_at is null
       and payment_id is not null
     order by created_at desc limit 1;
    if not found then
      raise exception 'change_request_not_found';
    end if;
    if v_chg.expires_at is not null and v_chg.expires_at <= now() then
      raise exception 'change_request_expired';
    end if;
    -- ...and it must not ALREADY hold the guest's money. Exactly the double-charge guard the pickup
    -- add-on carries: the apply trigger cannot fire twice (its WHEN clause needs old.status distinct
    -- from 'paid'), so a second session on a settled row would charge the card again and raise no
    -- alert at all.
    if exists (
      select 1 from payments pay
       where pay.id = v_chg.payment_id and pay.paid_minor >= pay.amount_minor and pay.amount_minor > 0
    ) then
      raise exception 'change_already_paid';
    end if;
  end if;
  -- THE CALLER-IDENTITY CHECK — unchanged, and still what api_create_payment enforces. It is skipped
  -- ONLY for a caller that has already proved a stronger, non-session credential: see the header, and
  -- api_create_quote_payment, which is the only function in the schema that passes `false`.
  if p_enforce_caller_identity
     and not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  -- No `and status <> 'failed'`: that skipped the row a declined attempt had latched to 'failed' and
  -- minted a SECOND payments row, orphaning the checkout-reuse window and the single-flight lease
  -- (both columns on the skipped row) and leaving two independently payable Peach sessions.
  if v_purpose = 'booking' then
    select * into v_payment from payments
    where booking_id = v_booking.id and purpose = 'booking'
    order by created_at desc
    limit 1;

    if not found then
      -- Scoped to THIS booking: an unscoped key lookup let a caller echo another payment's key and
      -- receive that payment's id/amount back.
      select * into v_payment from payments
      where idempotency_key = p ->> 'idempotencyKey' and booking_id = v_booking.id and purpose = 'booking';
    end if;
  elsif v_purpose = 'balance' then
    -- The newest STILL-OPEN 'balance' row for this booking — never a 'booking' row (that is the deposit,
    -- a distinct purpose). Under the booking-row FOR UPDATE above this is the single-open-session guard,
    -- and it is scoped to the BOOKING, NOT to installment_seq: a booking has at most ONE payable balance
    -- session at a time, whichever installment (or the plain whole-balance link) opened it. This is
    -- load-bearing because each installment charge is CUMULATIVE (seq k collects the running total up to
    -- it, minus what is settled) — so two installment links, or an installment link and the plain balance
    -- link, size to OVERLAPPING amounts. If each minted its own live Peach session (the per-seq scoping
    -- this replaces), completing both would settle the overlap twice and overcharge the guest. One open
    -- session per booking makes that unrepresentable: the second open reuses the first's row + checkout
    -- lease, and only once it settles (and balance_due drops) does the next open mint a fresh, correctly
    -- re-sized row.
    --
    -- "Still open" = paid_minor < amount_minor, so a DECLINED or PENDING row (paid_minor 0) is reused
    -- rather than orphaned by a second row — the original plain-balance behaviour, which for the plain
    -- link the balance_already_paid guard above already made equivalent (a fully-paid plain balance
    -- leaves balance_due = 0 and never reaches here). An installment booking DOES reach here with a
    -- fully-paid earlier row while balance_due is still > 0, and the filter is what lets seq k+1 mint its
    -- own session instead of re-minting on the settled seq k row. No `and status <> 'failed'`, exactly as
    -- the deposit path.
    select * into v_payment from payments
    where booking_id = v_booking.id and purpose = 'balance'
      and coalesce(paid_minor, 0) < amount_minor
    order by created_at desc
    limit 1;

    if not found then
      select * into v_payment from payments
      where idempotency_key = p ->> 'idempotencyKey' and booking_id = v_booking.id and purpose = 'balance';
    end if;
  elsif v_purpose = 'pickup_addon' then
    -- Exactly the row the open request points at — never "the newest add-on row", which after a
    -- superseded request could be a different, abandoned one.
    select * into v_payment from payments where id = v_req.payment_id and purpose = 'pickup_addon';
  else
    -- Same rule for the change add-on: the row the OPEN proposal points at, never "the newest change
    -- row", which after a superseded proposal is a different, abandoned one.
    select * into v_payment from payments where id = v_chg.payment_id and purpose = 'change_addon';
  end if;

  if not found then
    if v_purpose = 'pickup_addon' then
      -- api_request_pickup owns the add-on row (it is the only place that knows the fare). Never
      -- invent one here, or the amount would come from nowhere.
      raise exception 'pickup_request_not_found';
    elsif v_purpose = 'change_addon' then
      -- api_propose_booking_change owns the change row (it is the only place that knows the priced
      -- difference). Never invent one here, or the amount would come from nowhere.
      raise exception 'change_request_not_found';
    elsif v_purpose = 'balance' then
      -- Mint the balance row. Its amount is the booking's CURRENT balance_due_minor — the SERVER's figure
      -- for what is still owed, read off the booking row (never caller input, exactly like the deposit
      -- and the FX pin) and snapshotted onto this row, so charging it drives balance_due_minor to 0. The
      -- balance-payability branch above has already proved it is > 0. From here everything is per-payment-
      -- row: this row takes its own FX pin, its own checkout lease and its own provider_checkout_id.
      -- Sized to the named installment's charge (v_charge, computed + proved > 0 above) when this is a
      -- dated link, else the WHOLE balance — the unchanged plain-balance path. installment_seq is RECORDED
      -- (which installment first opened this session), not used to scope the lease: the reuse lookup above
      -- is booking-wide, so this is the booking's one open balance session until it settles.
      insert into payments (booking_id, idempotency_key, amount_minor, purpose, installment_seq)
      values (v_booking.id, p ->> 'idempotencyKey',
              coalesce(v_charge, v_booking.balance_due_minor), 'balance', v_installment_seq)
      returning * into v_payment;
      insert into payment_events (payment_id, type, amount_minor)
      values (v_payment.id, 'intent', coalesce(v_charge, v_booking.balance_due_minor));
    else
      -- The first `booking` row is sized to the DEPOSIT when the booking carries one. A quote booking
      -- carries a positive deposit_minor (api_convert_quote sized it from deposit_bps), and a pay-in-full
      -- quote's is the whole total; an ordinary customer booking has none — deposit_minor DEFAULTS to 0,
      -- so nullif() falls the charge back to total_minor and the customer path is bit-for-bit what it was.
      -- Sized off the BOOKING ROW, never caller input, exactly like the FX pin below: what a card is
      -- charged is a server figure. append_payment_event then confirms the booking when THIS row is paid
      -- in full, so paying the deposit confirms it and reserves the seat with no change to that gate.
      -- installment_seq: 0 on a scheduled booking (the deposit IS installment 0), null otherwise — so the
      -- schedule's first row is settled by this payment, and an ordinary booking is bit-for-bit unchanged.
      -- The deposit SIZING (the pinned coalesce) is untouched.
      insert into payments (booking_id, idempotency_key, amount_minor, purpose, installment_seq)
      values (v_booking.id, p ->> 'idempotencyKey',
              coalesce(nullif(v_booking.deposit_minor, 0), v_booking.total_minor), 'booking',
              (select min(bi.seq) from booking_installments bi where bi.booking_id = v_booking.id))
      returning * into v_payment;
      insert into payment_events (payment_id, type, amount_minor)
      values (v_payment.id, 'intent', coalesce(nullif(v_booking.deposit_minor, 0), v_booking.total_minor));
    end if;
  end if;

  -- ── Pin the charge (once per payment row) ────────────────────────────────────────────────────
  -- The EUR ledger total converted to WHOLE MUR RUPEES at the server-controlled rate. Derived here,
  -- in SQL, from fx_rates — NEVER from caller input (this function is granted to authenticated; a
  -- caller-supplied rate would let a booking owner pin their own MUR 0.05 charge). First-write-wins:
  -- every later call — every re-minted checkout session, the pay page, reconcile — reads THIS figure,
  -- so a moved FX rate between sessions can never make the charge and the expected settlement drift.
  if v_payment.charged_amount_minor is null and v_payment.amount_minor > 0 then
    select r.rate, r.source, r.fetched_at into v_rate, v_src, v_at
      from fx_rates r where r.base = 'EUR' and r.quote = 'MUR';
    -- Band-clamped on READ as well as write: an inverted or foreign payload that somehow reached the
    -- table (0.0185 would bill MUR 1.85 for a EUR 100 booking — and, because settled == charged,
    -- CONFIRM it) falls back to the floor instead of being trusted.
    if v_rate is null or v_rate < 40 or v_rate > 70 then
      v_rate := 53.00; -- cold-start floor; see the fx_rates seed comment (kept below mid on purpose)
      v_src := 'fallback';
      v_at := now();
    end if;
    -- Whole rupees: kills every sub-unit disagreement between what we send Peach and what Peach
    -- reports back. Costs at most MUR 0.50 (~EUR 0.01) per booking.
    v_charged := (round(v_payment.amount_minor * v_rate / 100.0) * 100)::bigint;
    update payments
       set charged_amount_minor = v_charged,
           charged_currency = 'MUR',
           charged_fx_rate = v_rate,
           charged_fx_source = v_src,
           charged_fx_at = v_at,
           updated_at = now()
     where id = v_payment.id and charged_amount_minor is null
     returning * into v_payment;
    if not found then
      -- Another transaction pinned first (or a legacy row already carried a charge): read the truth.
      select * into v_payment from payments where id = v_payment.id;
    end if;
  end if;

  -- Checkout lease (single-flight): exactly one caller may be out creating a Peach session at any
  -- moment. Order matters — reuse beats pending beats claim:
  --   1. a still-fresh recorded checkout        -> hand the SAME session back (reuse; no Peach call);
  --   2. someone else holds an unexpired lease  -> checkoutPending (caller retries shortly);
  --   3. otherwise                              -> stamp the lease and let THIS caller call Peach.
  -- api_record_payment_checkout clears the lease when the session id is recorded; a Peach failure
  -- releases it via api_release_checkout_claim, and the 90-second expiry is the crash backstop.
  --
  -- Freshness is measured from checkout_created_at (when the session was MINTED), never from
  -- updated_at: the reconcile sweep touches updated_at on every pass, which used to re-arm this
  -- window forever and trap the customer on a dead session. The caller still verifies liveness with
  -- the provider before actually reusing what this returns.
  if v_payment.provider_checkout_id is not null
     and coalesce(v_payment.checkout_created_at, v_payment.updated_at) > now() - interval '25 minutes' then
    return jsonb_build_object(
      'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
      'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
      'existingCheckoutId', v_payment.provider_checkout_id,
      'chargedAmountMinor', v_payment.charged_amount_minor,
      'chargedCurrency', v_payment.charged_currency,
      'chargedFxRate', v_payment.charged_fx_rate
    );
  end if;

  if v_payment.checkout_claimed_until is not null and v_payment.checkout_claimed_until > now() then
    return jsonb_build_object(
      'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
      'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
      'existingCheckoutId', null,
      'checkoutPending', true,
      'chargedAmountMinor', v_payment.charged_amount_minor,
      'chargedCurrency', v_payment.charged_currency,
      'chargedFxRate', v_payment.charged_fx_rate
    );
  end if;

  update payments set checkout_claimed_until = now() + interval '90 seconds'
  where id = v_payment.id;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
    'existingCheckoutId', null,
    'chargedAmountMinor', v_payment.charged_amount_minor,
    'chargedCurrency', v_payment.charged_currency,
    'chargedFxRate', v_payment.charged_fx_rate
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) api_booking_receipt - the WINNING body VERBATIM plus the change_addon fold, same discipline.
--     Taken from the winning MIGRATION (20260926000000), not from catch-up.sql: that copy had
--     drifted by one comment, and catch-up-parity normalises comments away so it never saw it.
-- ---------------------------------------------------------------------------
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
  v_change_charged bigint := 0;
  v_items jsonb;
  v_custom jsonb;
begin
  if v_booking_id is null then
    raise exception 'invalid_request' using detail = 'booking_receipt: bookingId required';
  end if;

  v_base := booking_json(v_booking_id);
  if v_base is null then
    return null;
  end if;

  -- The booking-wide "headline" activity title (the FIRST tour) + earliest trip date, for the header.
  select a.title, o.starts_at
    into v_title, v_when
    from booking_items bi
    join session_occurrences o on o.id = bi.session_occurrence_id
    join activity_options ao on ao.id = bi.activity_option_id
    join activities a on a.id = ao.activity_id
   where bi.booking_id = v_booking_id
   order by o.starts_at asc, bi.created_at asc
   limit 1;

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

  if v_payment is not null then
    select coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor)), 0)
      into v_addon_charged
      from payments pay
     where pay.booking_id = v_booking_id
       and pay.purpose = 'pickup_addon'
       and pay.paid_minor > 0
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

    -- THE CHANGE ADD-ON, folded the same way and for the same reason: the guest paid the difference
    -- on its own payments row, so an invoice that reported only the original charge would understate
    -- what was actually taken from the card. Gated on applied_at because a settled-but-unapplied
    -- change is an ORPHAN -- it never moved the booking, the owner has been alerted to refund it, and
    -- it must not appear as part of this booking's charge.
    --
    -- The currency guard is load-bearing, not defensive: chargedAmountMinor is a single scalar in one
    -- currency, so adding a row charged in a different one would produce a number that is not money in
    -- any currency. Dropping it out is the correct, conservative answer.
    select coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor)), 0)
      into v_change_charged
      from payments pay
     where pay.booking_id = v_booking_id
       and pay.purpose = 'change_addon'
       and pay.paid_minor > 0
       and exists (
         select 1 from booking_change_requests r
          where r.payment_id = pay.id and r.applied_at is not null
       )
       and coalesce(pay.charged_currency, pay.currency)
             is not distinct from (v_payment ->> 'chargedCurrency');
    if v_change_charged > 0 then
      v_payment := v_payment || jsonb_build_object(
        'chargedAmountMinor', (v_payment ->> 'chargedAmountMinor')::bigint + v_change_charged
      );
    end if;
  end if;

  select b.customer_phone, b.locale::text, b.balance_due_minor
    into v_phone, v_locale, v_bal
    from bookings b where b.id = v_booking_id;

  -- Catalogue lines, each with its OWN activity title, per-line date, AND its attached transport add-on.
  -- Same FROM/WHERE as booking_json's items and NO order by, so item order stays byte-identical (the
  -- owner-alert party mix + voucher lines[0] read it positionally). `transportFareMinor`/
  -- `transportPickupLabel` are the attached round-trip transfer; buildInvoice renders a nested line from
  -- them. A JOIN/order by here reordered the age bands and broke the owner alert — do not reintroduce.
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', (select a.title
                       from activity_options ao
                       join activities a on a.id = ao.activity_id
                      where ao.id = bi.activity_option_id),
           'when', (select o.starts_at from session_occurrences o where o.id = bi.session_occurrence_id),
           'priceLabel', bi.price_label,
           'quantity', bi.quantity,
           'pax', bi.pax,
           'unitAmountEur', bi.unit_amount_minor::float / 100,
           'subtotalEur', bi.subtotal_minor::float / 100,
           'occurrenceId', bi.session_occurrence_id,
           'transportFareMinor', bi.transport_fare_minor,
           'transportPickupLabel', bi.transport_pickup_label
         )), '[]'::jsonb)
    into v_items
    from booking_items bi
   where bi.booking_id = v_booking_id;

  -- The priced lines that have no session_occurrence (a converted quote's custom/transfer lines, and
  -- rentals). title = null so buildInvoice adds no prefix — `booking_custom_items.description` already
  -- names the line. The transport add-on rides along exactly as it does for a catalogue line.
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', null::text,
           'when', ci.starts_at,
           'priceLabel', ci.description,
           'quantity', ci.quantity,
           'pax', null::int,
           'unitAmountEur', ci.unit_amount_minor::float / 100,
           'subtotalEur', ci.subtotal_minor::float / 100,
           'transportFareMinor', ci.transport_fare_minor,
           'transportPickupLabel', ci.transport_pickup_label
         ) order by ci.position), '[]'::jsonb)
    into v_custom
    from booking_custom_items ci
   where ci.booking_id = v_booking_id;

  -- Catalogue lines FIRST (voucher-pdf.ts reads lines[0]), custom lines after by position.
  return v_base
    || jsonb_build_object('items', v_items || v_custom)
    || jsonb_build_object('activityTitle', v_title, 'when', v_when)
    || jsonb_build_object('payment', coalesce(v_payment, 'null'::jsonb))
    || jsonb_build_object('customerPhone', v_phone)
    || jsonb_build_object('balanceDueMinor', coalesce(v_bal, 0))
    || jsonb_build_object('locale', v_locale);
end;
$$;

revoke execute on function api_booking_receipt(jsonb) from public, anon, authenticated;
grant execute on function api_booking_receipt(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 11) The GUEST-FACING surface for an open upgrade.
--
--     Without this the upgrade leg is unfinishable: every pay button on the booking page is gated on
--     `awaitingPayment`, which is false for a confirmed + paid booking — exactly the state a change
--     proposal is raised against. Staff could park a proposal and hold a seat that the guest had no
--     way to pay for.
--
--     SECURITY INVOKER + RLS, deliberately, exactly as booking_json is: the bcr_owner_select policy
--     already scopes a change request to its booking's owner, and bcr_staff_all to staff. Making this
--     a definer would hand any caller another guest's pending change, and the ownership rule would
--     then have to be re-stated here — a second spelling of a rule that already exists.
--
--     Positive differences only. A level or cheaper move is applied the moment it is proposed, so it
--     has nothing to pay and must not raise a "you owe us" block on the guest's page.
-- ---------------------------------------------------------------------------
create or replace function booking_open_change_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
           'requestId', r.id,
           'differenceMinor', r.difference_minor,
           'newTotalMinor', r.new_total_minor,
           'expiresAt', r.expires_at,
           'activityTitle', a.title,
           'optionName', o.name,
           'startsAt', so.starts_at
         )
    from booking_change_requests r
    join session_occurrences so on so.id = r.to_occurrence_id
    join activity_options o on o.id = r.to_option_id
    join activities a on a.id = o.activity_id
   where r.booking_id = p_booking_id
     and r.applied_at is null
     and r.withdrawn_at is null
     and r.difference_minor > 0
     and (r.expires_at is null or r.expires_at > now())
   order by r.created_at desc
   limit 1;
$$;

grant execute on function booking_open_change_json(uuid) to anon, authenticated, service_role;

-- booking_change_history_json — the APPLIED sibling of booking_open_change_json above. Same
-- `security invoker` reasoning: RLS (bcr_owner_select / bcr_staff_all) does the scoping, so this
-- opens no new privacy surface. Needs ZERO joins, unlike its sibling — every field it returns now
-- lives directly on booking_change_requests after apply_booking_change's snapshot capture, so this
-- is a flat read. Returns an ARRAY (not a single object): a booking can accumulate more than one
-- applied change over time, and every entry is worth keeping.
create or replace function booking_change_history_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'requestId', r.id,
           'appliedAt', r.applied_at,
           'refundedAt', r.refunded_at,
           'differenceMinor', r.difference_minor,
           'fromActivityTitle', r.from_activity_title,
           'fromOptionName', r.from_option_name,
           'fromStartsAt', r.from_starts_at,
           'fromTotalMinor', r.old_total_minor,
           'fromItems', r.from_items,
           'toActivityTitle', r.to_activity_title,
           'toOptionName', r.to_option_name,
           'toStartsAt', r.to_starts_at,
           'toTotalMinor', r.new_total_minor,
           'toItems', r.to_items
         ) order by r.applied_at asc), '[]'::jsonb)
    from booking_change_requests r
   where r.booking_id = p_booking_id
     and r.applied_at is not null;
$$;

grant execute on function booking_change_history_json(uuid) to anon, authenticated, service_role;

-- api_booking_change_history — a thin `p jsonb` wrapper, since every RPC the TS drain calls directly
-- takes one jsonb argument (the convention api_booking_receipt already follows). No is_staff() gate:
-- its only caller is the service-role notification drain, which has no auth.uid() to check and
-- already runs elevated — same grant shape as api_booking_receipt.
create or replace function api_booking_change_history(p jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select booking_change_history_json(nullif(p ->> 'bookingId', '')::uuid);
$$;

revoke execute on function api_booking_change_history(jsonb) from public, anon, authenticated;
grant execute on function api_booking_change_history(jsonb) to service_role;

-- api_get_booking re-applied from its winning body VERBATIM plus `pendingChange` and, now,
-- `changeHistory`. Kept `security invoker` — booking_json relies on that (definer-grants-lockdown.
-- test.ts pins used_capacity staying anon-executable BECAUSE booking_json is invoker), and both
-- change-flow helpers below depend on it for their RLS scoping too.
create or replace function api_get_booking(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select booking_json(b.id)
         || jsonb_build_object('isOwn', coalesce(b.user_id = auth.uid(), false))
         || jsonb_build_object('pendingChange', booking_open_change_json(b.id))
         || jsonb_build_object('changeHistory', booking_change_history_json(b.id))
  from bookings b
  where b.ref = p ->> 'ref';
$$;

-- ---------------------------------------------------------------------------
-- append_payment_event — the WINNING body (20260912000000_quote_deposit.sql lineage) VERBATIM plus
-- one disjunct, fixing the phantom-balance bug real testing surfaced: a fully-settled upgrade showed
-- balance_due_minor equal to the difference just paid. See the header comment above the change inside
-- the body below for the full mechanism (the settlement trigger firing synchronously inside this same
-- statement, before this function's own balance recompute runs).
-- ---------------------------------------------------------------------------
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
  v_booking_state payment_state;
  v_booking_status booking_status;
  v_occ_id uuid;
  v_needed bigint;
  v_cap bigint;
  v_used_conf bigint;
  v_used_hold bigint;
  v_oversold boolean := false;
  v_called_off boolean := false;
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
  on conflict (payment_id, provider_event_id, type) do nothing;

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

  -- MORE money than we asked for, on one payments row. Nothing else in this system can see that: the
  -- reducer's own branches all read `>= amount_minor`, so a second capture on an already-paid row is
  -- indistinguishable from the first, and the late-pickup apply trigger cannot re-fire on it. It
  -- should be impossible — but "impossible" is what the double-charge guards keep discovering it is
  -- not, and the only honest response to money we did not ask for is to tell someone who can return it.
  if v_payment.amount_minor > 0 and v_paid > v_payment.amount_minor then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    select 'email', 'owner', 'owner_overpayment',
           jsonb_build_object(
             'ref', b.ref,
             'customerName', b.customer_name,
             'expectedEur', v_payment.amount_minor::float / 100,
             'paidEur', v_paid::float / 100,
             'purpose', v_payment.purpose
           ),
           b.id,
           'overpaid:' || v_payment.id::text
      from bookings b where b.id = v_payment.booking_id
    on conflict (idempotency_key) do nothing;
  end if;

  -- BOOKING-level projection, rolled up across every payment row of this booking -- best row wins,
  -- and 'failed' only when EVERY row failed. Written from the single touched row it was a latch: one
  -- declined attempt stamped the booking 'failed' forever (nothing else writes this column), which
  -- silently removed it from api_pending_payment_checkouts and run_booking_maintenance. Ranking
  -- rather than re-summing the ledger keeps this a pure widening: a booking with one payment row --
  -- every booking that never hit the fork -- projects exactly what it projected before.
  -- Ordered paid > partially_refunded > refunded > pending > failed: with two rows after a double
  -- charge, one refunded and one not, money is still held and 'paid' is the honest answer.
  select case min(
           case pay.status
             when 'paid' then 1
             when 'partially_refunded' then 2
             when 'refunded' then 3
             when 'pending' then 4
             when 'failed' then 5
           end
         )
         when 1 then 'paid'
         when 2 then 'partially_refunded'
         when 3 then 'refunded'
         when 5 then 'failed'
         else 'pending'
         end::payment_state
    into v_booking_state
    from payments pay
   where pay.booking_id = v_payment.booking_id;

  update bookings set payment_state = coalesce(v_booking_state, v_state), updated_at = now()
  where id = v_payment.booking_id;

  -- AMOUNT STILL OWED, maintained here as a projection over the payment ROWS — never latched from the
  -- single row this event touched (that is precisely the sticky-failed class of bug: a booking-level
  -- figure derived from one child row). total_minor is the running order total — the FULL quoted price,
  -- GROWN by an applied late-pickup fee (apply_pickup_request, the AFTER-UPDATE-of-status trigger that
  -- fires from inside the `update payments` above) — so "owed" is that total minus everything settled.
  -- A row counts only to the extent its money actually REACHED total_minor:
  --   * the deposit ('booking') and the balance ('balance'), which ARE the total; and
  --   * a 'pickup_addon' ONLY once its request was APPLIED (a booking_pickup_requests row with
  --     applied_at set and fee_minor > 0 points at it) — an applied add-on grew total_minor, so its
  --     capture must count here to net that growth back out.
  -- A pickup captured but NOT applied never reached total_minor, so it must NOT count: the zero-fee
  -- revision cuts its payment_id loose (api_request_pickup) and a called-off departure returns before
  -- growing total (apply_pickup_request), and both leave the capture ORPHANED (notify_pickup_orphan_
  -- payment). Summing that gross capture in — the original all-purposes shape — silently REDUCED the
  -- amount owed by money that never paid down the order: a real, permanent under-collection on a booking
  -- that still owes its balance. (paid_minor - refunded_minor) so a later refund of a counted row stops
  -- it counting; greatest(0, …) so an overpayment, a refund event, or an unapplied pickup can never
  -- drive balance_due_minor negative. A legacy/customer booking whose single 'booking' row covers
  -- total_minor still recomputes to 0 unchanged.
  update bookings b
     set balance_due_minor = greatest(
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
                  -- A settled change_addon payment (20261006000000). No amount guard needed, unlike
                  -- the pickup clause above: a change_addon payments row only ever exists when
                  -- difference_minor > 0 (api_propose_booking_change only inserts one in that
                  -- branch), so there is no zero-fee case to exclude. Without this disjunct, the
                  -- moment payments_apply_booking_change (an AFTER trigger on THIS SAME update
                  -- statement, fired via the caller's earlier UPDATE payments SET status=...) has
                  -- already bumped bookings.total_minor to the new, higher figure, this recompute
                  -- would then subtract a sum that excludes the very payment that just made the
                  -- booking whole -- leaving a fully-settled upgrade with a phantom balance_due_minor
                  -- equal to the difference just paid. Verified live on the sandbox before this fix:
                  -- a paid, upgraded booking carried balance_due_minor = its difference_minor.
                  or exists (
                    select 1 from booking_change_requests r
                     where r.payment_id = pay.id and r.applied_at is not null
                  )
                )
           ), 0)
         ),
         updated_at = now()
   where b.id = v_payment.booking_id;

  -- Confirmation stays driven by THIS row reaching 'paid' (v_state), never by the roll-up: a row
  -- that just captured the full amount is what licenses confirming, and reusing the roll-up here
  -- would re-run the capacity re-check on every later event of an already-paid booking.
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

      -- Was the departure called off while this payment was in flight?
      --
      -- Confirming here would tell the guest they are booked onto a trip that is not running. Worse,
      -- they could never be put right afterwards: api_weather_cancel_occurrence stamps only bookings
      -- that were ALREADY confirmed+paid when it ran, and it refuses to re-run on an occurrence it
      -- has already cancelled — so this booking would never receive a `disruption` stamp, and that
      -- stamp is the ONLY thing that opens the 24h bypass in api_cancel_booking and
      -- api_reschedule_booking (via booking_awaiting_choice). Charged, told "confirmed", and locked
      -- out of both the refund and the free reschedule /refunds promises.
      --
      -- Route the money back instead — the same answer this function already gives when the seats
      -- turn out to be gone (oversold) or the booking is no longer live. refund_pending frees the
      -- capacity immediately and fires enqueue_booking_notification's refund_pending branch, so the
      -- owner gets a work item and the guest is told.
      select exists (
        select 1
          from booking_items bi
          join session_occurrences so on so.id = bi.session_occurrence_id
         where bi.booking_id = v_payment.booking_id
           and so.status = 'cancelled'
      ) into v_called_off;

      if v_oversold or v_called_off then
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
  elsif v_state = 'refunded' and coalesce(v_booking_state, v_state) = 'refunded' then
    update bookings set status = 'refunded', updated_at = now()
    where id = v_payment.booking_id and status <> 'cancelled';
    update booking_holds set status = 'released'
    where booking_id = v_payment.booking_id and status = 'active';
  end if;

  return v_payment;
end;
$$;


revoke execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) to service_role;
