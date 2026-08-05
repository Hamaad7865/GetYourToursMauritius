-- Late pickup: the guest who chose "I don't know yet" finishes the job themselves.
--
-- A booking taken with `pickup_pending = true` has no address and paid no transport supplement (the
-- checkout sends no coordinates, so api_book's region fare never fires). Until now nothing chased it
-- and nobody could fix it: the guest's booking page was read-only, admin had no write path for
-- pickup_location, and the owner ran the pickup for free or phoned around on the morning.
--
-- This migration adds the missing half of that flow:
--   1. the guest picks their address on /bookings/:ref, is quoted the region transport supplement,
--      and pays it through the SAME Peach checkout they already know;
--   2. 48h and 24h before departure a reminder chases a still-missing pickup, and at 24h the owner
--      gets told which bookings are still blind.
--
-- ── WHY A SECOND PAYMENTS ROW ────────────────────────────────────────────────────────────────────
-- api_create_payment refuses a confirmed/paid booking (`booking_not_payable`), and that guard MUST
-- stay: it is what stops a second payable session for money we already hold. The supplement is
-- DIFFERENT money, so it gets its own payments row tagged `purpose = 'pickup_addon'`.
--
-- That is safe by construction on the paths that already exist:
--   * append_payment_event's booking-level projection is already a roll-up across every payments row
--     of a booking (best row wins), so a pending add-on never drags a paid booking backwards;
--   * it only confirms a booking whose status is draft/held/payment_pending, so an add-on settling on
--     an already-confirmed booking is a no-op for status.
-- What was NOT safe, and is fixed below: api_create_payment's "latest row for this booking" lookup
-- would have handed a booking re-pay the add-on row. It is now scoped by purpose.
--
-- ── WHY THE ADDRESS IS NOT WRITTEN UNTIL THE MONEY LANDS ─────────────────────────────────────────
-- Writing pickup_location at request time would let a guest clear their own "pickup to be arranged"
-- badge without paying — the owner would drive to Le Morne for free and only find out on the day. The
-- requested address parks in `booking_pickup_requests` and is applied when, and only when, the
-- supplement settles.
--
-- ── WHY A TRIGGER RATHER THAN A CHANGE TO append_payment_event ───────────────────────────────────
-- landmines.md: "never confirm a booking outside append_payment_event". This does not confirm
-- anything — the booking is already confirmed — and re-declaring 170 lines of the most dangerous
-- function in the codebase to bolt on one call is exactly the migration-revert drift that page warns
-- about twice. The apply step hangs off the payments-row status write that append_payment_event
-- itself performs, so it runs inside the same transaction, under the same authority, and it is
-- idempotent (`applied_at is null`). reconcile.ts credits through the same function, so the
-- webhook-less recovery path is covered too.

begin;

-- ---------------------------------------------------------------------------
-- 1) payments.purpose — which money a row represents.
-- ---------------------------------------------------------------------------
alter table payments add column if not exists purpose text not null default 'booking';
alter table payments drop constraint if exists payments_purpose_check;
alter table payments add constraint payments_purpose_check
  check (purpose in ('booking', 'pickup_addon'));
create index if not exists payments_booking_purpose_idx on payments (booking_id, purpose);

-- ---------------------------------------------------------------------------
-- 2) booking_pickup_requests — the requested address, held until it is paid for.
-- ---------------------------------------------------------------------------
create table if not exists booking_pickup_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  -- Null only for a zero-fee request (same region, no supplement due), which is applied immediately.
  payment_id uuid references payments (id) on delete set null,
  -- Nullable so a GDPR erasure can strip the address WITHOUT deleting the row: api_booking_receipt
  -- reads applied_at as its proof that a settled supplement belongs on the invoice, and the fare
  -- stays inside bookings.total_minor forever. Deleting the row made the retained financial record
  -- contradict itself. api_request_pickup always writes all three.
  pickup_location text,
  pickup_lat double precision,
  pickup_lng double precision,
  pickup_region text,
  dropoff_location text,
  fee_minor int not null default 0 check (fee_minor >= 0),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most ONE open request per booking: the guest may revise the address they are about to pay for,
-- never fork it into two payable supplements.
create unique index if not exists booking_pickup_requests_open_idx
  on booking_pickup_requests (booking_id) where applied_at is null;
create index if not exists booking_pickup_requests_payment_idx
  on booking_pickup_requests (payment_id);

alter table booking_pickup_requests enable row level security;

drop policy if exists booking_pickup_requests_staff on booking_pickup_requests;
create policy booking_pickup_requests_staff on booking_pickup_requests for all to authenticated
  using (is_staff()) with check (is_staff());

-- The guest reads their own open request (booking_json surfaces it so the booking page can say
-- "we're waiting on your supplement"). Read-only: every write goes through the RPCs below.
drop policy if exists booking_pickup_requests_own on booking_pickup_requests;
create policy booking_pickup_requests_own on booking_pickup_requests for select to authenticated
  using (exists (
    select 1 from bookings b where b.id = booking_pickup_requests.booking_id and b.user_id = auth.uid()
  ));

-- Stock Supabase ALTER DEFAULT PRIVILEGES hands every new table to anon + authenticated, so the
-- revoke is what actually closes anon; the grant is explicit because a database built from setup.sql
-- (and the PGlite harness) has no default privileges at all.
revoke all on booking_pickup_requests from public, anon;
grant select on booking_pickup_requests to authenticated;
grant select, insert, update, delete on booking_pickup_requests to service_role;

-- ---------------------------------------------------------------------------
-- 3) pickup_addon_quote — ONE body for "may this booking add a pickup, and what does it cost?".
--
--    Shared by the quote RPC (live, as the guest drags the pin), the request RPC (authoritative, at
--    the moment money is committed) and the tests. A second copy of this eligibility ladder would
--    drift, and the drift would be a wrong price.
--
--    Mirrors api_book's transport block: region re-derived from coordinates server-side, fare from
--    transport_fare_minor, never a client-sent price.
-- ---------------------------------------------------------------------------
create or replace function pickup_addon_quote(
  p_booking_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_mode text;
  v_activity_region text;
  v_pickup_available boolean;
  v_is_airport boolean;
  v_is_hotel boolean;
  v_qty int;
  v_suv boolean;
  v_region text;
  v_starts_at timestamptz;
  v_fee bigint;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if not found then
    return jsonb_build_object('eligible', false, 'reason', 'booking_not_found', 'feeMinor', 0);
  end if;

  -- Only a booking that ASKED for a pickup and never gave an address. A booking with no pickup at all
  -- (the guest makes their own way) is a different intent and is deliberately not upgradable here.
  if not coalesce(v_booking.pickup_pending, false) or v_booking.pickup_location is not null then
    return jsonb_build_object('eligible', false, 'reason', 'pickup_not_pending', 'feeMinor', 0);
  end if;
  if v_booking.status <> 'confirmed' or v_booking.payment_state <> 'paid' then
    return jsonb_build_object('eligible', false, 'reason', 'booking_not_confirmed', 'feeMinor', 0);
  end if;

  select coalesce(a.pricing_mode, 'per_person'),
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false),
         coalesce(a.is_hotel_transfer, false)
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel
  from booking_items bi
  join activity_options o on o.id = bi.activity_option_id
  join activities a on a.id = o.activity_id
  where bi.booking_id = p_booking_id
  order by bi.id
  limit 1;

  if v_mode is null then
    return jsonb_build_object('eligible', false, 'reason', 'no_activity', 'feeMinor', 0);
  end if;
  -- Same gate as api_book's transport block. Both transfer products carry a fixed band/zone fare and
  -- always have a pickup end, so they can never be pickup_pending in the first place.
  if v_is_airport or v_is_hotel or not v_pickup_available or v_mode not in ('per_person', 'per_group') then
    return jsonb_build_object('eligible', false, 'reason', 'transport_not_applicable', 'feeMinor', 0);
  end if;

  -- Past departures cannot be fixed by paying for a pickup.
  select min(so.starts_at) into v_starts_at
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = p_booking_id;
  if v_starts_at is null or v_starts_at <= now() then
    return jsonb_build_object('eligible', false, 'reason', 'departed', 'feeMinor', 0);
  end if;

  -- Nor can a departure WE called off. api_weather_cancel_occurrence leaves the booking 'confirmed'
  -- with its items still pointing at the cancelled occurrence and starts_at unmoved, so every check
  -- above still passes — selling a transport supplement for a trip that is not running, and (via the
  -- reminder sweep, which shares this ladder) chasing the guest for a pickup hours after telling them
  -- the trip was cancelled. A guest still owed a reschedule/refund choice is in the same position.
  if exists (
    select 1
      from booking_items bi
      join session_occurrences so on so.id = bi.session_occurrence_id
     where bi.booking_id = p_booking_id and so.status = 'cancelled'
  ) or booking_awaiting_choice(v_booking.disruption) then
    return jsonb_build_object('eligible', false, 'reason', 'departure_cancelled', 'feeMinor', 0);
  end if;

  -- Party size in the same unit api_book used: the headcount, not the line count.
  select coalesce(sum(coalesce(bi.pax, bi.quantity)), 0)::int into v_qty
    from booking_items bi where bi.booking_id = p_booking_id;

  -- The SUV upgrade is a vehicle-tour concept and the modes eligible here never offer it, so this is
  -- false for every real booking. Read from the booking's own price labels rather than hardcoding
  -- false, so a future per_group SUV line prices honestly instead of silently under-charging.
  select exists (
    select 1 from booking_items bi
     where bi.booking_id = p_booking_id and bi.price_label ilike '%suv%'
  ) into v_suv;

  if p_lat is null or p_lng is null then
    return jsonb_build_object('eligible', true, 'reason', null, 'feeMinor', 0, 'region', null);
  end if;

  v_region := region_from_coords(p_lat, p_lng);
  if v_region is null then
    -- Outside the five Mauritius zones: no band, so no fare. Accept the address, charge nothing.
    return jsonb_build_object('eligible', true, 'reason', null, 'feeMinor', 0, 'region', null);
  end if;

  v_fee := transport_fare_minor(v_region, v_activity_region, v_qty, v_suv);
  return jsonb_build_object(
    'eligible', true,
    'reason', null,
    'feeMinor', coalesce(v_fee, 0),
    'region', v_region,
    'activityRegion', v_activity_region,
    'band', region_distance_band(v_region, v_activity_region),
    'pax', v_qty
  );
end;
$$;

revoke execute on function pickup_addon_quote(uuid, double precision, double precision)
  from public, anon, authenticated;
grant execute on function pickup_addon_quote(uuid, double precision, double precision) to service_role;

-- ---------------------------------------------------------------------------
-- 4) api_quote_pickup_addon — the live quote the booking page shows as the pin moves.
--    Ownership-gated, read-only, no rows written: dragging a map pin must not mint payments.
-- ---------------------------------------------------------------------------
create or replace function api_quote_pickup_addon(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_booking bookings;
begin
  select * into v_booking from bookings where ref = p ->> 'bookingRef';
  if not found then
    raise exception 'booking_not_found';
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;
  return pickup_addon_quote(
    v_booking.id,
    nullif(p ->> 'pickupLat', '')::double precision,
    nullif(p ->> 'pickupLng', '')::double precision
  );
end;
$$;

revoke execute on function api_quote_pickup_addon(jsonb) from public, anon;
grant execute on function api_quote_pickup_addon(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) api_request_pickup — commit to an address.
--
--    Zero fee  -> applied immediately (nothing to pay, so nothing to wait for).
--    Fee due   -> the address parks in booking_pickup_requests behind a 'pickup_addon' payments row;
--                 the caller then mints a checkout for it through api_create_payment.
--
--    Idempotent and revisable: a guest who comes back and picks a different address updates the OPEN
--    request in place. The amount may only move while no live checkout session exists for it —
--    otherwise a session minted for the old figure could still be paid, and the pinned settlement
--    expectation would no longer match what we asked for.
-- ---------------------------------------------------------------------------
create or replace function api_request_pickup(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_quote jsonb;
  v_fee bigint;
  v_region text;
  v_pickup text;
  v_dropoff text;
  v_lat double precision;
  v_lng double precision;
  v_req booking_pickup_requests;
  v_payment payments;
  v_in_flight boolean := false;
begin
  -- FOR UPDATE: two tabs committing an address at once must serialise, or both insert an open request
  -- (the partial unique index would reject the loser with a raw constraint error instead of a merge).
  select * into v_booking from bookings where ref = p ->> 'bookingRef' for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  v_pickup := nullif(btrim(p ->> 'pickupLocation'), '');
  v_dropoff := nullif(btrim(p ->> 'dropoffLocation'), '');
  v_lat := nullif(p ->> 'pickupLat', '')::double precision;
  v_lng := nullif(p ->> 'pickupLng', '')::double precision;
  if v_pickup is null or v_lat is null or v_lng is null then
    raise exception 'pickup_incomplete';
  end if;
  -- Bounded like every other free-text booking field: a tampered payload is a clean error, not a
  -- runaway row.
  v_pickup := left(v_pickup, 200);
  v_dropoff := left(v_dropoff, 200);

  v_quote := pickup_addon_quote(v_booking.id, v_lat, v_lng);
  if not coalesce((v_quote ->> 'eligible')::boolean, false) then
    raise exception 'pickup_not_allowed' using detail = coalesce(v_quote ->> 'reason', 'unknown');
  end if;
  v_fee := coalesce((v_quote ->> 'feeMinor')::bigint, 0);
  v_region := coalesce(v_quote ->> 'region', '');

  select * into v_req from booking_pickup_requests
   where booking_id = v_booking.id and applied_at is null
   for update;
  if v_req.payment_id is not null then
    select * into v_payment from payments where id = v_req.payment_id for update;
  end if;

  -- ── Is a checkout for the CURRENT figure already out in the world? ─────────────────────────────
  -- Two states count as "in flight", and missing either one is a double-charge:
  --   * a recorded session inside the 25-minute reuse window — still payable at Peach;
  --   * a held single-flight lease — api_create_payment has stamped it and the edge worker is at
  --     Peach right now, 1-2s during which provider_checkout_id is STILL NULL. Revising in that
  --     window used to clear the lease and re-price the row underneath the winner, so the loser
  --     minted a second session: two live sessions, both handed to a browser. Peach's nonce is per
  --     REQUEST and never dedupes, which is exactly why that lease exists.
  v_in_flight := v_payment.id is not null
    and (
      (v_payment.provider_checkout_id is not null
        and coalesce(v_payment.checkout_created_at, v_payment.updated_at) > now() - interval '25 minutes')
      or (v_payment.checkout_claimed_until is not null and v_payment.checkout_claimed_until > now())
    );

  -- ── Nothing to pay: apply now ──────────────────────────────────────────────────────────────────
  if v_fee = 0 then
    -- …unless a supplement checkout for the PREVIOUS address is live. Applying here would stamp
    -- applied_at, and the guest could then still complete that session — money taken for a pickup the
    -- trigger would find already applied and silently discard. Same answer as the fee>0 path: finish
    -- it or let it lapse.
    if v_in_flight then
      raise exception 'pickup_payment_in_flight';
    end if;

    update bookings
       set pickup_location = v_pickup,
           dropoff_location = coalesce(v_dropoff, dropoff_location),
           pickup_pending = false,
           pickup_lat = v_lat,
           pickup_lng = v_lng,
           pickup_region = nullif(v_region, ''),
           updated_at = now()
     where id = v_booking.id;

    if v_req.id is not null then
      -- payment_id is CUT LOOSE. This row is being applied at zero, so it is no longer the record of
      -- what that payment bought — and two things read it that way: notify_pickup_orphan_payment
      -- (which must still alert if the old session settles) and api_booking_receipt's fold-in gate
      -- (which would otherwise put a charge on the invoice that never reached the booking total).
      update booking_pickup_requests
         set pickup_location = v_pickup, pickup_lat = v_lat, pickup_lng = v_lng,
             pickup_region = v_region, dropoff_location = v_dropoff, fee_minor = 0,
             payment_id = null, applied_at = now(), updated_at = now()
       where id = v_req.id;
    else
      insert into booking_pickup_requests (
        booking_id, payment_id, pickup_location, pickup_lat, pickup_lng, pickup_region,
        dropoff_location, fee_minor, applied_at
      ) values (
        v_booking.id, null, v_pickup, v_lat, v_lng, v_region, v_dropoff, 0, now()
      ) returning * into v_req;
    end if;

    perform notify_pickup_set(v_booking.id, v_req.id, 0);
    return jsonb_build_object('applied', true, 'feeMinor', 0, 'paymentId', null);
  end if;

  -- ── Supplement due ─────────────────────────────────────────────────────────────────────────────
  if v_req.id is not null then
    -- Re-pricing under a live session is the refusal case: that session is still payable at the OLD
    -- figure, and moving amount_minor + the FX pin underneath it would make the guest's real
    -- settlement fail reconcile's pinned-expectation check and quarantine. Re-pointing the SAME
    -- figure at a new address is harmless, so it stays allowed.
    if v_in_flight and v_payment.amount_minor <> v_fee then
      raise exception 'pickup_payment_in_flight';
    end if;

    update booking_pickup_requests
       set pickup_location = v_pickup, pickup_lat = v_lat, pickup_lng = v_lng,
           pickup_region = v_region, dropoff_location = v_dropoff, fee_minor = v_fee,
           updated_at = now()
     where id = v_req.id
    returning * into v_req;

    if v_payment.id is not null and v_payment.amount_minor <> v_fee then
      -- Re-pin the FX charge from scratch: charged_amount_minor is first-write-wins, so leaving the
      -- old pin would charge the card the old supplement.
      --
      -- The checkout columns are deliberately NOT touched. Clearing provider_checkout_id would hide a
      -- stale session from the recovery sweep (money captured on it would then reach nothing), and
      -- clearing checkout_claimed_until would break another caller's single-flight lease. The guard
      -- above has already established that neither is live; api_create_payment's own liveness
      -- re-query + api_clear_payment_checkout are what retire a dead pointer, under compare-and-clear.
      update payments
         set amount_minor = v_fee,
             charged_amount_minor = null, charged_currency = null, charged_fx_rate = null,
             charged_fx_source = null, charged_fx_at = null,
             updated_at = now()
       where id = v_payment.id
      returning * into v_payment;
      insert into payment_events (payment_id, type, amount_minor)
      values (v_payment.id, 'intent', v_fee);
    end if;

    if v_payment.id is not null then
      return jsonb_build_object('applied', false, 'feeMinor', v_fee, 'paymentId', v_payment.id);
    end if;
  end if;

  -- No usable payment row yet (first request, or a zero-fee request that has now become chargeable).
  insert into payments (booking_id, idempotency_key, amount_minor, purpose)
  values (v_booking.id, 'pickup:' || v_booking.id::text || ':' || gen_random_uuid()::text, v_fee, 'pickup_addon')
  returning * into v_payment;
  insert into payment_events (payment_id, type, amount_minor)
  values (v_payment.id, 'intent', v_fee);

  if v_req.id is not null then
    update booking_pickup_requests set payment_id = v_payment.id, updated_at = now()
     where id = v_req.id;
  else
    insert into booking_pickup_requests (
      booking_id, payment_id, pickup_location, pickup_lat, pickup_lng, pickup_region,
      dropoff_location, fee_minor
    ) values (
      v_booking.id, v_payment.id, v_pickup, v_lat, v_lng, v_region, v_dropoff, v_fee
    );
  end if;

  return jsonb_build_object('applied', false, 'feeMinor', v_fee, 'paymentId', v_payment.id);
end;
$$;

revoke execute on function api_request_pickup(jsonb) from public, anon;
grant execute on function api_request_pickup(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) notify_pickup_set / apply_pickup_request — what happens when the supplement lands.
--
--    Owner alert is EMAIL ONLY on purpose. resolveOwnerRecipient() throws for an unset Telegram chat
--    id or WhatsApp number, and both are unset in production — enqueuing those rows would create
--    permanently-failing outbox rows rather than delivering anything.
-- ---------------------------------------------------------------------------
create or replace function notify_pickup_set(
  p_booking_id uuid,
  p_request_id uuid,
  p_fee_minor bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_title text;
  v_starts_at timestamptz;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if not found then
    return;
  end if;

  select a.title, min(so.starts_at)
    into v_title, v_starts_at
  from booking_items bi
  join session_occurrences so on so.id = bi.session_occurrence_id
  join activity_options o on o.id = bi.activity_option_id
  join activities a on a.id = o.activity_id
  where bi.booking_id = p_booking_id
  group by a.title
  order by min(so.starts_at)
  limit 1;

  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'owner_pickup_set',
    jsonb_build_object(
      'ref', v_booking.ref,
      'customerName', v_booking.customer_name,
      'customerPhone', v_booking.customer_phone,
      'pickupLocation', v_booking.pickup_location,
      'dropoffLocation', v_booking.dropoff_location,
      'activityTitle', v_title,
      'startsAt', v_starts_at,
      'feeEur', p_fee_minor::float / 100
    ),
    p_booking_id,
    'pickup_set_owner:' || p_request_id::text
  )
  on conflict (idempotency_key) do nothing;

  if v_booking.customer_email is not null then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_booking.customer_email, 'pickup_confirmed',
      jsonb_build_object(
        'ref', v_booking.ref,
        'customerName', v_booking.customer_name,
        'pickupLocation', v_booking.pickup_location,
        'activityTitle', v_title,
        'startsAt', v_starts_at,
        'feeEur', p_fee_minor::float / 100,
        'locale', v_booking.locale::text
      ),
      p_booking_id,
      'pickup_set_guest:' || p_request_id::text
    )
    on conflict (idempotency_key) do nothing;
  end if;
end;
$$;

revoke execute on function notify_pickup_set(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function notify_pickup_set(uuid, uuid, bigint) to service_role;

-- A settled supplement that could NOT be applied. Every branch that refuses to write a pickup routes
-- here, because the alternative is keeping a guest's money with no record anyone will ever look at.
-- Email only, and idempotent per payment: the reconcile sweep re-queries the same capture for hours.
create or replace function notify_pickup_orphan_payment(p_payment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_booking bookings;
  v_applied bigint;
begin
  select * into v_payment from payments where id = p_payment_id;
  if not found or v_payment.purpose <> 'pickup_addon' or v_payment.paid_minor <= 0 then
    return;
  end if;

  -- How much of THIS payment actually reached a booking. A normal apply puts exactly amount_minor
  -- there, so the common replay path (request already applied, in full) is silent. A request applied
  -- at a different figure — the zero-fee revision — is not.
  select coalesce(sum(r.fee_minor), 0) into v_applied
    from booking_pickup_requests r
   where r.payment_id = p_payment_id and r.applied_at is not null;
  if v_applied >= v_payment.amount_minor then
    return;
  end if;

  select * into v_booking from bookings where id = v_payment.booking_id;
  -- A booking that is already cancelled/expired/refunded had this capture routed to refund_pending by
  -- append_payment_event, which raises its own owner alert. Don't send a second one for it.
  if v_booking.status not in ('confirmed', 'completed') then
    return;
  end if;

  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'owner_pickup_orphan_payment',
    jsonb_build_object(
      'ref', v_booking.ref,
      'customerName', v_booking.customer_name,
      'feeEur', v_payment.amount_minor::float / 100,
      'chargedAmountMinor', v_payment.charged_amount_minor,
      'chargedCurrency', v_payment.charged_currency
    ),
    v_booking.id,
    'pickup_orphan:' || p_payment_id::text
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke execute on function notify_pickup_orphan_payment(uuid) from public, anon, authenticated;
grant execute on function notify_pickup_orphan_payment(uuid) to service_role;

create or replace function apply_pickup_request(p_payment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req booking_pickup_requests;
  v_status booking_status;
  v_disruption jsonb;
  v_called_off boolean;
begin
  -- `applied_at is null` is the whole idempotency story: a replayed webhook, the reconcile sweep and
  -- the customer's own sync poll all land here, and only the first one moves money onto the booking.
  select * into v_req from booking_pickup_requests
   where payment_id = p_payment_id and applied_at is null
   for update;
  if not found then
    -- Money with nothing to apply it to. The ONE case that is normal is a replay of a supplement
    -- already applied in full; anything else is a real capture we would otherwise keep silently
    -- (the guest revised to a zero-fee address while this session was still payable, or the request
    -- was superseded). Alerting is the whole point: nobody can refund what nobody knows about.
    perform notify_pickup_orphan_payment(p_payment_id);
    return;
  end if;

  -- The booking must still be live. A supplement captured on a session minted before the guest
  -- cancelled (Peach sessions stay completable ~30 min) would otherwise add a pickup and its fare to
  -- a cancelled/refunded booking. append_payment_event's own "money on a non-live booking" branch
  -- routes that capture to refund_pending, which is the right answer; this must not undo it by
  -- writing a pickup onto it.
  --
  -- 'completed' counts as live, exactly as it does in append_payment_event, api_mark_refunded and the
  -- capacity count. Excluding it meant a supplement that settled late on a trip the owner had already
  -- marked complete was KEPT and never applied — that branch does not route to refund_pending either,
  -- so the money simply vanished from view.
  select status, disruption into v_status, v_disruption from bookings where id = v_req.booking_id;
  if v_status not in ('confirmed', 'completed') then
    return;
  end if;

  -- …and the departure must still be running. api_weather_cancel_occurrence leaves the booking
  -- 'confirmed' with its items on the cancelled occurrence, so the status check above sails past a
  -- called-off trip. Every SELL-side path already refuses this (pickup_addon_quote), but this is the
  -- path that actually takes the money onto the booking, and it was the only one that did not: the
  -- guest was charged for transport to a trip we had just told them was cancelled, and the pickup was
  -- stamped onto a booking that still owes them a reschedule-or-refund choice.
  select exists (
    select 1
      from booking_items bi
      join session_occurrences so on so.id = bi.session_occurrence_id
     where bi.booking_id = v_req.booking_id and so.status = 'cancelled'
  ) into v_called_off;
  if v_called_off or booking_awaiting_choice(v_disruption) then
    perform notify_pickup_orphan_payment(p_payment_id);
    return;
  end if;

  update bookings
     set pickup_location = v_req.pickup_location,
         dropoff_location = coalesce(v_req.dropoff_location, dropoff_location),
         pickup_pending = false,
         pickup_lat = v_req.pickup_lat,
         pickup_lng = v_req.pickup_lng,
         pickup_region = nullif(v_req.pickup_region, ''),
         transport_minor = transport_minor + v_req.fee_minor,
         total_minor = total_minor + v_req.fee_minor,
         operator_payout_minor = operator_payout_minor + v_req.fee_minor,
         updated_at = now()
   where id = v_req.booking_id;

  update booking_pickup_requests set applied_at = now(), updated_at = now() where id = v_req.id;

  perform notify_pickup_set(v_req.booking_id, v_req.id, v_req.fee_minor);
end;
$$;

revoke execute on function apply_pickup_request(uuid) from public, anon, authenticated;
grant execute on function apply_pickup_request(uuid) to service_role;

create or replace function trg_apply_pickup_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform apply_pickup_request(new.id);
  return new;
end;
$$;

drop trigger if exists payments_apply_pickup_addon on payments;
create trigger payments_apply_pickup_addon
after update of status on payments
for each row
when (new.purpose = 'pickup_addon' and new.status = 'paid' and old.status is distinct from 'paid')
execute function trg_apply_pickup_request();

-- ---------------------------------------------------------------------------
-- 7) api_create_payment — the 20260902000000 body VERBATIM with the purpose branch.
--
--    Three changes, all of them about keeping the two kinds of money apart:
--      a. `purpose` is read from the payload (default 'booking' — every existing caller is unchanged);
--      b. the booking-payability guard applies to a 'booking' payment; a 'pickup_addon' instead
--         requires an open, unapplied request with a row already minted by api_request_pickup (this
--         function never invents an add-on amount);
--      c. every payments lookup and the insert are scoped by purpose, so a booking re-pay can no
--         longer pick up the add-on row (and vice versa).
--    The FX pin, the checkout lease, the reuse window and the ownership check are untouched.
-- ---------------------------------------------------------------------------
create or replace function api_create_payment(p jsonb)
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
begin
  if v_purpose not in ('booking', 'pickup_addon') then
    raise exception 'invalid_payment_purpose' using detail = v_purpose;
  end if;

  -- FOR UPDATE: every concurrent create-payment call for one booking serialises on this row for the
  -- rest of the transaction. That closes two races at once: two callers both inserting a payments row
  -- below, and — via the checkout lease — two callers both getting a green light to mint a Peach
  -- session. Peach's nonce is unique per REQUEST (it never dedupes), so without this lease two tabs
  -- or a retry could create two independently payable sessions for the same booking.
  -- (It also makes the charge pin race-free: one caller pins, the loser re-reads the pinned row.)
  select * into v_booking from bookings where ref = p ->> 'bookingRef' for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_purpose = 'booking' then
    if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
       or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
      raise exception 'booking_not_payable' using detail = v_booking.status::text;
    end if;
  else
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
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
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
  else
    -- Exactly the row the open request points at — never "the newest add-on row", which after a
    -- superseded request could be a different, abandoned one.
    select * into v_payment from payments where id = v_req.payment_id and purpose = 'pickup_addon';
  end if;

  if not found then
    if v_purpose <> 'booking' then
      -- api_request_pickup owns the add-on row (it is the only place that knows the fare). Never
      -- invent one here, or the amount would come from nowhere.
      raise exception 'pickup_request_not_found';
    end if;
    insert into payments (booking_id, idempotency_key, amount_minor, purpose)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor, 'booking')
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
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

revoke execute on function api_create_payment(jsonb) from public, anon;
grant execute on function api_create_payment(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) api_pending_payment_checkouts — the 20260902000000 body with the add-on branch.
--
--    The sweep enumerated by BOOKING state (`status = 'payment_pending'`), which is exactly wrong for
--    a supplement on a confirmed booking: a lost webhook would strand the guest's money forever with
--    nothing re-querying it. Add-on rows are therefore enumerated by their OWN state, and their grace
--    window runs from the payment's creation rather than the booking's (the booking may be weeks old).
--
--    `distinct on` now keys on (booking, purpose) so a booking carrying both kinds of row surfaces
--    both.
-- ---------------------------------------------------------------------------
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
    -- latest payment per booking+purpose (a re-pay opens a fresh checkout the sweep must query), then
    -- the most-recent stuck rows up to the batch cap. The two orderings need separate query levels:
    -- distinct-on requires its leading sort be (b.id, pay.purpose, pay.created_at), so recency + limit
    -- wrap it.
    -- LATERAL over (current, previous) checkout ids: a customer can complete a checkout minted
    -- before a re-pay overwrote the pointer (Peach sessions stay completable ~30 min) -- sweeping
    -- both ids means that capture is ingested instead of stranded.
    select c.ref, c.payment_id, v.checkout_id as provider_checkout_id, c.created_at
    from (
      select distinct on (b.id, pay.purpose)
             b.id, b.ref,
             -- For an add-on, from whichever is later: the row is created when the guest commits the
             -- ADDRESS, but they can mint the Peach session on it hours later (the resume button), and
             -- the grace window has to cover the session, not the intent.
             case when pay.purpose = 'pickup_addon'
                  then greatest(pay.created_at, coalesce(pay.checkout_created_at, pay.created_at))
                  else b.created_at end as created_at,
             pay.id as payment_id, pay.provider_checkout_id, pay.prev_provider_checkout_id
        from bookings b
        join payments pay on pay.booking_id = b.id
       where (
               (pay.purpose = 'booking'
                 and b.status = 'payment_pending'
                 and b.payment_state in ('pending', 'failed'))
               or
               (pay.purpose = 'pickup_addon' and pay.status in ('pending', 'failed'))
             )
         and (case when pay.purpose = 'pickup_addon'
                   then greatest(pay.created_at, coalesce(pay.checkout_created_at, pay.created_at))
                   else b.created_at end)
               > now() - make_interval(
                   mins => least(greatest(coalesce((p ->> 'graceMinutes')::int, 240), 1), 10080)
                 )
         and pay.provider_checkout_id is not null
         and not exists (
               select 1 from payment_events pe
                where pe.payment_id = pay.id and pe.type in ('paid', 'refunded')
             )
       order by b.id, pay.purpose, pay.created_at desc
    ) c
    cross join lateral (values (c.provider_checkout_id), (c.prev_provider_checkout_id)) as v(checkout_id)
    where v.checkout_id is not null
    -- recency-ordered batch, capped (default 100, hard ceiling 1000) to bound Peach API calls per run
    order by c.created_at desc
    limit least(greatest(coalesce((p ->> 'limit')::int, 100), 1), 1000)
  ) t;
$$;

revoke execute on function api_pending_payment_checkouts(jsonb) from public, anon, authenticated;
grant execute on function api_pending_payment_checkouts(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 9) booking_json — the 20260908000000 body VERBATIM plus `pendingPickup`, so the booking page can
--    tell "you still owe us an address" from "we're waiting for your supplement to settle" (and keep
--    polling through the second one — the status-based poll stops dead on a confirmed booking).
--    STAYS `security invoker`: the guest reads their own request row through its RLS policy.
-- ---------------------------------------------------------------------------
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
    'supplements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', bs.name, 'qty', bs.qty,
        'unitEur', bs.unit_minor::float / 100, 'totalEur', bs.total_minor::float / 100
      ) order by bs.position, bs.name)
      from booking_supplements bs where bs.booking_id = b.id
    ), '[]'::jsonb),
    'pendingPickup', (
      select jsonb_build_object(
        'pickupLocation', r.pickup_location,
        'dropoffLocation', r.dropoff_location,
        'feeEur', r.fee_minor::float / 100,
        'paymentId', r.payment_id,
        'createdAt', r.created_at
      )
      from booking_pickup_requests r
      where r.booking_id = b.id and r.applied_at is null and r.fee_minor > 0
      order by r.created_at desc
      limit 1
    ),
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
    'disruption', b.disruption,
    'partySize', coalesce((
      select sum(coalesce(bi.pax, bi.quantity))
        from booking_items bi where bi.booking_id = b.id
    ), 0),
    -- The BOOKING-UNIT count, the unit seatsLeft is denominated in. For a per-person option it equals
    -- partySize; for a vehicle/private one it is 1 (one van / one trip, any group size). The date
    -- picker must filter on THIS, not partySize, or a 6-guest transfer is offered nothing.
    'unitsNeeded', coalesce((
      select sum(bi.quantity)
        from booking_items bi where bi.booking_id = b.id
    ), 0),
    'activityOptionId', (
      select bi.activity_option_id
        from booking_items bi where bi.booking_id = b.id order by bi.id limit 1
    ),
    'activitySlug', (
      select a.slug
        from booking_items bi
        join activity_options ao on ao.id = bi.activity_option_id
        join activities a on a.id = ao.activity_id
       where bi.booking_id = b.id
       order by bi.id limit 1
    ),
    'cancellable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and (
        booking_awaiting_choice(b.disruption)
        or coalesce((
          select min(so.starts_at)
            from booking_items bi
            join session_occurrences so on so.id = bi.session_occurrence_id
           where bi.booking_id = b.id
        ), 'epoch'::timestamptz) > now() + interval '24 hours'
      )
    ),
    'reschedulable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and (
        booking_awaiting_choice(b.disruption)
        or coalesce((
          select min(so.starts_at)
            from booking_items bi
            join session_occurrences so on so.id = bi.session_occurrence_id
           where bi.booking_id = b.id
        ), 'epoch'::timestamptz) > now() + interval '24 hours'
      )
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

-- ---------------------------------------------------------------------------
-- 10) api_enqueue_pickup_reminders — the 48h / 24h chase.
--
--     Service-role only (the maintenance cron), and modelled on api_enqueue_review_invites: find the
--     candidates, insert the outbox rows, let the drain send them.
--
--     THE SIGNATURE IS LOAD-BEARING. It takes a single defaulted jsonb `p` it never reads, because the
--     shared Supabase adapter (src/lib/supabase/rpc.ts) invokes EVERY api_* function as fn(p := jsonb).
--     A niladic function is invisible to PostgREST through that adapter — it 404s with PGRST202, the
--     maintenance route 503s on every tick, and no reminder is ever sent. That is not hypothetical:
--     20260828000000_review_invites_p_arg.sql exists solely because api_enqueue_review_invites shipped
--     niladic and silently sent nothing for weeks. Its integration test masked it exactly the way one
--     here would — by calling `select api_enqueue_pickup_reminders()` directly, bypassing the wrapper.
--
--     No Mauritius-time bucketing here and none is needed: these are intervals BEFORE a timestamptz,
--     not calendar days, so the timezone landmine does not apply.
-- ---------------------------------------------------------------------------
drop function if exists public.api_enqueue_pickup_reminders();

create or replace function api_enqueue_pickup_reminders(p jsonb default '{}'::jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_candidate record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_candidate in (
    select b.id as booking_id, b.ref, b.customer_email, b.customer_name, b.locale::text as locale,
           a.title as activity_title, fo.starts_at,
           case when fo.starts_at <= now() + interval '24 hours' then 24 else 48 end as window_hours,
           -- The eligibility ladder, evaluated ONCE per candidate. It gates the guest chase (there is
           -- no point mailing "add it now" to someone the booking page will refuse) but deliberately
           -- NOT the owner escalation — see the split below.
           pickup_addon_quote(b.id, null, null) ->> 'reason' as refusal
    from bookings b
    join lateral (
      select min(so.starts_at) as starts_at
        from booking_items bi
        join session_occurrences so on so.id = bi.session_occurrence_id
       where bi.booking_id = b.id
    ) fo on true
    join lateral (
      select a2.title
        from booking_items bi
        join activity_options o on o.id = bi.activity_option_id
        join activities a2 on a2.id = o.activity_id
       where bi.booking_id = b.id
       order by bi.id
       limit 1
    ) a on true
    where b.status = 'confirmed'
      and coalesce(b.pickup_pending, false)
      and b.pickup_location is null
      and b.customer_email is not null
      and fo.starts_at > now()
      and fo.starts_at <= now() + interval '48 hours'
  )
  loop
    -- A trip that has departed or been called off needs no signal to anyone; every OTHER refusal
    -- (no pickup service on this activity, a pricing mode the add-on does not serve) still leaves a
    -- guest the owner must collect, so it must still reach the owner below.
    if v_candidate.refusal in ('departed', 'departure_cancelled', 'pickup_not_pending') then
      continue;
    end if;

    -- Guest chase: only when they can actually comply. Chasing someone whose booking page answers
    -- "this trip doesn't include a pickup service" is a demand with no way to satisfy it.
    if v_candidate.refusal is null then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_candidate.customer_email, 'pickup_reminder',
      jsonb_build_object(
        'ref', v_candidate.ref,
        'customerName', v_candidate.customer_name,
        'activityTitle', v_candidate.activity_title,
        'startsAt', v_candidate.starts_at,
        'hoursBefore', v_candidate.window_hours,
        'locale', v_candidate.locale
      ),
      v_candidate.booking_id,
      -- The DEPARTURE is part of the key, not just the booking. A reschedule keeps the booking id, so
      -- a booking-scoped key would let the first date's chase permanently suppress the new date's —
      -- the driver arrives at a rearranged trip with no address and nobody warned.
      'pickup_reminder_' || v_candidate.window_hours::text || ':' || v_candidate.booking_id::text
        || ':' || to_char(v_candidate.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI')
    )
    on conflict (idempotency_key) do nothing;
    end if;

    -- The owner nudge fires at the 24h mark only: at 48h the guest still has plenty of time, and an
    -- alert the owner cannot act on yet is an alert they learn to ignore. It fires whether or not the
    -- guest could be chased — a booking that still says "pickup to be arranged" the day before
    -- departure is exactly the thing the owner must know about, and on an activity with no online
    -- pickup service they are the ONLY one who can resolve it. `refusal` rides along so the alert can
    -- say whether the guest was chased twice or never chased at all.
    if v_candidate.window_hours = 24 then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', 'owner', 'owner_pickup_missing',
        jsonb_build_object(
          'ref', v_candidate.ref,
          'customerName', v_candidate.customer_name,
          'activityTitle', v_candidate.activity_title,
          'startsAt', v_candidate.starts_at,
          'guestChased', (v_candidate.refusal is null),
          'refusal', v_candidate.refusal
        ),
        v_candidate.booking_id,
        'pickup_missing_owner:' || v_candidate.booking_id::text
          || ':' || to_char(v_candidate.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI')
      )
      on conflict (idempotency_key) do nothing;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function api_enqueue_pickup_reminders(jsonb) from public, anon, authenticated;
grant execute on function api_enqueue_pickup_reminders(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 11) append_payment_event - the 20260902000000 body VERBATIM with ONE condition added to the
--     refunded branch.
--
--     That branch wrote BOOKING-level state from a SINGLE payments row: any row reaching 'refunded'
--     stamped `bookings.status = 'refunded'` and released the holds. It predates multi-purpose rows
--     and is the same class of bug as the sticky payment_state latch fixed in 20260902000000 - a
--     booking-level projection derived from one child row.
--
--     With a second row it is live: refund the EUR 30 transport supplement in Peach (a legitimate
--     thing to do when a pickup cannot be serviced) and a fully-paid EUR 500 booking reads 'refunded'
--     on the guest's page and in /admin while the trip is still on and the money is still held - its
--     seats freed, its cancel/reschedule affordances gone, and a "your booking has been refunded"
--     email sent.
--
--     The roll-up `v_booking_state` computed above is already the honest booking-level answer (it
--     ranks paid > partially_refunded > refunded), so the transition now requires it: the booking
--     flips to refunded only when NO row of it still holds money. The single-payment case - every
--     booking that never had an add-on - projects exactly what it projected before.
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

-- ---------------------------------------------------------------------------
-- 12) api_mark_refunded - the 20260726000000 body, re-pointed from "the newest payments row" to
--     "every row of this booking that still holds money".
--
--     `order by created_at desc limit 1` meant the staff "Mark refunded" button reversed whichever row
--     was newest. After a late-pickup supplement settles that is ALWAYS the add-on row, so an owner
--     who refunded EUR 530 in Peach recorded a EUR 30 refund against the supplement, left the EUR 500
--     booking payment reading paid_minor = 50000 / refunded_minor = 0 - and could never fix it,
--     because the `alreadyRefunded` short-circuit fires on the second click and the booking-status
--     gate rejects every call after that. (The admin dialog quotes `netPaidEur`, which sums across
--     rows, so the owner was told EUR 530 while the RPC reversed EUR 30.)
--
--     A merely PENDING add-on row was worse: the `v_payment.status in ('paid','partially_refunded')`
--     gate saw 'pending' and raised not_refundable, so a guest who opened a supplement checkout and
--     abandoned it made their whole booking impossible to mark refunded.
--
--     Now: loop every money-holding row oldest-first, reverse each one's own outstanding amount
--     through append_payment_event, and move BOTH gates (idempotency and not_refundable) from "the
--     newest row" to "does any row of this booking still hold money". The event id is per-payment
--     ('manual:refund:<payment id>') - the ledger's conflict target is (payment_id,
--     provider_event_id, type), so replay-idempotency is preserved while two rows no longer collide
--     on one key.
-- ---------------------------------------------------------------------------
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
  v_reversed int := 0;
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

  if not exists (select 1 from payments where booking_id = v_booking_id) then
    raise exception 'payment_not_found';
  end if;

  -- Already fully reversed -> no-op (idempotent: a repeat click must not error or re-enqueue). Asked
  -- of the WHOLE booking, not of one row: with two rows, "the newest is refunded" was true while the
  -- booking payment was still fully held.
  if not exists (
    select 1 from payments
     where booking_id = v_booking_id
       and (status in ('paid', 'partially_refunded') or paid_minor > refunded_minor)
  ) then
    return jsonb_build_object('ok', true, 'alreadyRefunded', true);
  end if;

  -- Only a booking whose money is actually held may be refunded: the cancel path lands it in
  -- refund_pending (payment_state stays paid), or staff refund a confirmed/completed paid booking
  -- directly. Anything else (unpaid, draft, already cancelled with no money) is rejected. The payment
  -- half of the gate is the `not exists` above - a pending sibling row must not veto the refund.
  if v_booking.status not in ('refund_pending', 'confirmed', 'completed') then
    raise exception 'not_refundable'
      using detail = format('booking %s', v_booking.status);
  end if;

  -- Reverse the full outstanding (paid - already-refunded) amount of EVERY row that still holds money,
  -- oldest first, so the booking-level roll-up inside append_payment_event only reaches 'refunded' on
  -- the last one. append_payment_event derives the refunded state from the SUM of refund events.
  for v_payment in
    select * from payments
     where booking_id = v_booking_id
       and (status in ('paid', 'partially_refunded') or paid_minor > refunded_minor)
     order by created_at
  loop
    v_amount := greatest(v_payment.paid_minor - v_payment.refunded_minor, 0);
    if v_amount > 0 then
      -- Record through the SAME path the webhook uses. The synthesised provider_event_id makes it
      -- idempotent at the ledger: a second call with the same id hits the
      -- (payment_id, provider_event_id, type) conflict and is a no-op, so the booking_refunded enqueue
      -- (which also guards old.status is distinct from 'refunded') never double-fires.
      perform append_payment_event(
        v_payment.id,
        'refunded',
        'manual:refund:' || v_payment.id::text,
        v_amount,
        now(),
        jsonb_build_object('source', 'admin_mark_refunded', 'bookingId', v_booking_id)
      );
      v_reversed := v_reversed + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'paymentsReversed', v_reversed);
end;
$$;

revoke execute on function api_mark_refunded(jsonb) from public;
grant execute on function api_mark_refunded(jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 13) api_booking_receipt - the 20260901000300 body with its payment select scoped to
--     `purpose = 'booking'`, plus the settled supplement folded into the charged figure.
--
--     It picked "the booking's most recent payment" unscoped, so once a supplement settled the VAT
--     invoice reported the ADD-ON's charge, timestamp and provider reference as the booking's: a
--     EUR 150 invoice showing MUR 1,590 settled on the wrong date under the wrong reference, with
--     buildPaymentBlock deriving an FX rate of ~10 against a real ~53. That is a customer-facing tax
--     document and the owner's own refund evidence.
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
  v_addon_charged bigint := 0;
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
     and pay.purpose = 'booking'
   order by pay.created_at desc
   limit 1;

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

  -- The guest's stored booking locale (Task 15): the notification drain runs off-request (cron), so
  -- this is the only correct source for which language the confirmation email + PDFs render in.
  select b.customer_phone, b.locale::text into v_phone, v_locale from bookings b where b.id = v_booking_id;

  return v_base
    || jsonb_build_object('activityTitle', v_title, 'when', v_when)
    || jsonb_build_object('payment', coalesce(v_payment, 'null'::jsonb))
    || jsonb_build_object('customerPhone', v_phone)
    || jsonb_build_object('locale', v_locale);
end;
$$;

revoke execute on function api_booking_receipt(jsonb) from public, anon, authenticated;
grant execute on function api_booking_receipt(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 14) api_erase_user - the 20260909000000 body (the quotes-module version, which is the WINNING one:
--     it re-applied 20260816000000 and added the quotes erasure) with one statement added, deleting
--     the late-pickup request rows alongside the booking fields they duplicate.
--
--     Basing this on 20260816000000 instead - the last definition a naive grep surfaces - silently
--     reverts the quotes erasure and re-opens an Art. 17 hole in two other tables. That is
--     migration-revert drift, the worst landmine in docs/handbook/landmines.md, and the reason the
--     rule is "the LAST migration to define it wins", verified against the whole directory.
-- ---------------------------------------------------------------------------
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
  v_del_quotes int := 0;
  v_anon_quotes int := 0;
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
    -- booking_custom_items cascades from bookings, so the quote's non-occurrence lines go with it.
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
  -- pickup_location / dropoff_location are addresses the customer typed -- PII, and not part of the
  -- retained money trail -- so they are nulled alongside the other traveller fields.
  -- This is an UPDATE that does NOT touch status, so the status-only enqueue trigger never re-fires.
  update bookings
     set customer_name = '(Deleted user)',
         customer_email = 'deleted@privacy.invalid',
         customer_phone = null,
         notes = null,
         pickup_location = null,
         dropoff_location = null,
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

  -- The late-pickup request rows hold their OWN copy of the address the guest typed, plus the exact
  -- GPS coordinates of where they were staying (20260910000000). Nulling bookings.pickup_location
  -- above leaves that copy untouched, and because a late pickup only ever exists on a confirmed+paid
  -- booking, every one of these rows belongs to the RETAINED set - it would survive erasure forever.
  --
  -- ANONYMIZED, not deleted. The row is also the receipt's evidence that a settled supplement was
  -- applied (api_booking_receipt folds a charge in only when applied_at is set), while its fare stays
  -- inside bookings.total_minor for good — so deleting it made the retained VAT invoice report a
  -- charge smaller than its own line items. Keep the money facts (fee_minor, applied_at, payment_id),
  -- strip the person.
  update booking_pickup_requests
     set pickup_location = null, pickup_lat = null, pickup_lng = null,
         pickup_region = null, dropoff_location = null, updated_at = now()
   where booking_id = any(v_anon_ids)
     and (pickup_location is not null or dropoff_location is not null
          or pickup_lat is not null or pickup_lng is not null);

  -- ---- Redact the notification outbox -------------------------------------------------------------
  -- Strip recipient (the email) + the customerName key from any queued/sent message for this person,
  -- matched by the recipient address OR by linkage to one of their (still-existing, anonymized) bookings.
  -- recipient is NOT NULL in the schema, so it is redacted to the sentinel rather than nulled. Removing
  -- customerName from the payload (jsonb - key) is a no-op when the key is already absent -> idempotent.
  update notification_outbox
     set recipient = 'deleted@privacy.invalid',
         payload = coalesce(
           (select jsonb_object_agg(k, v) from jsonb_each(payload) as e(k, v)
             where k in ('ref', 'activityTitle', 'startsAt', 'feeEur', 'totalMinor', 'currency',
                         'locale', 'hoursBefore', 'guestChased', 'refusal', 'token',
                         'previousStartsAt', 'reason', 'chargedAmountMinor', 'chargedCurrency')),
           '{}'::jsonb
         )
   where v_email is not null and lower(recipient) = v_email;
  -- Booking-linked rows keep their RECIPIENT -- they may address the OWNER (the 'owner' sentinel or
  -- the ops inbox), and severing that address would silently kill a pending owner alert for a real
  -- paid booking. Only the person's name leaves the payload. Matched by the pre-captured id set.
  update notification_outbox
     set payload = coalesce(
           (select jsonb_object_agg(k, v) from jsonb_each(payload) as e(k, v)
             where k in ('ref', 'activityTitle', 'startsAt', 'feeEur', 'totalMinor', 'currency',
                         'locale', 'hoursBefore', 'guestChased', 'refusal', 'token',
                         'previousStartsAt', 'reason', 'chargedAmountMinor', 'chargedCurrency')),
           '{}'::jsonb
         )
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

  -- ---- Quotes: the offer the owner drafted for this person ----------------------------------------
  -- A quote that never minted a booking is not a financial record -> delete it and its lines outright
  -- (children first; quote_items cascades, but be explicit, exactly as the bookings block above is).
  -- A CONVERTED quote is retained and stripped instead. Keyed on converted_at, NOT booking_id: the
  -- bookings delete a few statements up nulls booking_id via its `on delete set null` FK.
  if v_email is not null then
    delete from quote_items qi
     using quotes q
     where qi.quote_id = q.id
       and lower(q.customer_email) = v_email
       and q.converted_at is null
       and q.booking_id is null;

    delete from quotes q
     where lower(q.customer_email) = v_email
       and q.converted_at is null
       and q.booking_id is null;
    get diagnostics v_del_quotes = row_count;

    -- Retained (converted) quotes: same redaction as the bookings they minted. internal_notes is
    -- staff free text that routinely names the guest, so it goes too. Idempotent via the same
    -- already-anonymized skip.
    update quotes
       set customer_name = '(Deleted user)',
           customer_email = 'deleted@privacy.invalid',
           customer_phone = null,
           internal_notes = null
     where lower(customer_email) = v_email
       and (converted_at is not null or booking_id is not null)
       and customer_name is distinct from '(Deleted user)';
    get diagnostics v_anon_quotes = row_count;
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
      || ' lead(s), ' || v_del_quotes || ' quote(s); anonymized ' || v_anon_bookings
      || ' retained booking(s), ' || v_anon_quotes || ' retained quote(s)'
  );

  return jsonb_build_object(
    'ok', true,
    'deletedBookings', v_del_bookings,
    'anonymizedBookings', v_anon_bookings,
    'deletedLeads', v_del_leads,
    'deletedQuotes', v_del_quotes,
    'anonymizedQuotes', v_anon_quotes
  );
end;
$$;

revoke execute on function api_erase_user(jsonb) from public, anon;
grant execute on function api_erase_user(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 15) api_apply_funded_pickups — settle a supplement we already hold but could not apply.
--
--     apply_pickup_request refuses at settlement when the departure has been called off. The guest's
--     money is captured, the request stays open, and the owner is told to refund it — but the usual
--     next step is that the guest takes the RESCHEDULE arm onto a live date, at which point they still
--     want the pickup and we are still holding exactly the right amount for it. Leaving that to a
--     manual refund + a second payment is worse for everyone, and it is what made the double-charge
--     above reachable.
--
--     So the maintenance cron retries. apply_pickup_request re-checks every gate itself (booking live,
--     departure running, not already applied), which is what makes an unconditional retry safe: this
--     function only decides WHICH payments are worth re-offering to it.
-- ---------------------------------------------------------------------------
create or replace function api_apply_funded_pickups(p jsonb default '{}'::jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_payment_id uuid;
  v_before timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_payment_id in
    select r.payment_id
      from booking_pickup_requests r
      join payments pay on pay.id = r.payment_id
     where r.applied_at is null
       and r.fee_minor > 0
       and pay.purpose = 'pickup_addon'
       and pay.paid_minor >= r.fee_minor
     order by r.created_at
  loop
    select applied_at into v_before from booking_pickup_requests where payment_id = v_payment_id;
    perform apply_pickup_request(v_payment_id);
    -- Count only what actually landed: the gates inside may still refuse (the trip is still called
    -- off), and this number is read by the cron's health verdict.
    if v_before is null and exists (
      select 1 from booking_pickup_requests where payment_id = v_payment_id and applied_at is not null
    ) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function api_apply_funded_pickups(jsonb) from public, anon, authenticated;
grant execute on function api_apply_funded_pickups(jsonb) to service_role;

commit;
