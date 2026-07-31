-- 20260902000000_money_path_recovery_fixes
--
-- A declined card used to disable the money-recovery machinery, permanently and silently.
--
-- `bookings.payment_state` is a BOOKING-level column, but append_payment_event wrote it from
-- whichever payment ROW the event touched, and the per-row reducer LATCHES to 'failed'
-- (`bool_or(type = 'failed')` over the row's whole event stream — only a later credit on the SAME
-- row can outrank it). That statement is the only writer of the column anywhere in the schema
-- (verified: every `set payment_state =` in supabase/migrations is that one line), so nothing ever
-- reset it. One declined transaction therefore stamped the booking 'failed' for good, and both
-- recovery paths key off exactly that column:
--
--   * api_pending_payment_checkouts -- the webhook-less safety net the cron sweeps before expiry --
--     enumerates `b.payment_state = 'pending'`. A customer who retried after a decline was excluded
--     from it forever, so if their successful retry's webhook was lost and they closed the tab
--     before /payments/sync ran, nothing would ever re-query Peach. Money taken, never confirmed.
--   * run_booking_maintenance expires `b.payment_state = 'pending'`. A declined-then-abandoned
--     booking was never expired, never emitted booking_expired, and kept a live "Pay now" affordance
--     indefinitely -- including after the departure had run.
--
-- The same latch also forked the payment row: api_create_payment looked for a reusable row
-- `and status <> 'failed'`, so after a decline it skipped the row and inserted a new one. Both
-- anti-double-charge mechanisms -- the still-fresh `existingCheckoutId` reuse and the
-- `checkout_claimed_until` single-flight lease -- are COLUMNS ON that skipped row, so the booking
-- could hold two independently payable Peach sessions at once (peach.ts deliberately treats only
-- 100.396.101 as a closed session, so the first stays payable after a decline). Nothing downstream
-- would have caught the overpayment: the reducer is per-row, so two rows each reaching
-- `v_paid >= amount_minor` both read a clean 'paid' and no one sums across them.
--
-- Each fix re-applies its function's WINNING body verbatim with ONE change, because a migration that
-- re-applies a stale body silently reverts an earlier fix ([[gytm-migration-revert-drift]]):
--   1. append_payment_event  (20260901000800) -- booking projection rolls up across the booking's rows
--   2. api_create_payment    (20260830000000) -- reuse the payment row even when it is 'failed'
--   3. run_booking_maintenance      (20260830000000) -- expire 'failed' as well as 'pending'
--   4. api_pending_payment_checkouts (20260805000000) -- sweep 'failed' as well as 'pending'
--
-- Two further money-path defects from the same sweep, unrelated to the decline latch:
--   1b. append_payment_event also refuses to CONFIRM onto a departure that has been called off. Its
--       confirm branch re-validated capacity but never looked at session_occurrences.status, so a
--       payment settling after api_weather_cancel_occurrence confirmed the guest onto a trip that is
--       not running -- and, because the weather fan-out only stamps bookings that were already
--       confirmed+paid and refuses to re-run on an already-cancelled occurrence, that guest could
--       never be stamped `disruption` afterwards either. Without the stamp there is no 24h bypass,
--       so they were charged, told "confirmed", and locked out of both the refund and the free
--       reschedule. Now routed to refund_pending, the same answer an oversold confirm already gives.
--   5.  api_book (20260901000300) -- the airport and hotel-to-hotel fare overrides get the replay
--       guard every other post-create mutation in that function already has.
--
-- (3) and (4) are safe without (1): both already carry their own money guards at the PAYMENTS level
-- -- run_booking_maintenance refuses any booking with a row that is paid/partially_refunded/refunded,
-- has paid_minor > 0, or is flagged settlement_review_at; api_pending_payment_checkouts skips a
-- payment that already has a 'paid'/'refunded' event. The payment_state predicate was never the
-- thing keeping money safe, only the thing keeping coverage narrow.
--
-- Re-run supabase/catch-up.sql after applying (idempotent).

-- ---------------------------------------------------------------------------
-- 1. append_payment_event -- verbatim from 20260901000800 with ONE change: the `update bookings set
--    payment_state = ...` line becomes a roll-up across every payment row of the booking.
--    Signature is byte-identical, so the pinned execute grants survive the replace; re-issued below
--    anyway (see the definer-grant-leak history).
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
  elsif v_state = 'refunded' then
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
-- 2. api_create_payment -- verbatim from 20260830000000 with ONE change: the reusable-row lookup no
--    longer excludes `status = 'failed'`.
--
--    Excluding it forked the row and took the double-charge guards with it. Reusing a failed row is
--    safe and is what the surrounding machinery already assumes: a booking that actually holds money
--    is rejected above by the booking_not_payable guard (payment_state in paid/partially_refunded/
--    refunded, which after fix 1 is a true booking-level roll-up), and the caller still verifies the
--    returned session with the provider before reusing it. A retry that succeeds on the reused row
--    outranks the latched 'failed' — the reducer's `v_paid >= amount_minor` branch precedes it.
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
begin
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
  if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
     or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'booking_not_payable' using detail = v_booking.status::text;
  end if;
  if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  -- No `and status <> 'failed'`: that skipped the row a declined attempt had latched to 'failed' and
  -- minted a SECOND payments row, orphaning the checkout-reuse window and the single-flight lease
  -- (both columns on the skipped row) and leaving two independently payable Peach sessions.
  select * into v_payment from payments
  where booking_id = v_booking.id
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
-- 3. run_booking_maintenance -- verbatim from 20260830000000 with ONE change: the expiry predicate
--    accepts 'failed' as well as 'pending'.
--
--    The money guard is the `not exists` over PAYMENTS below, not this column: a booking with any row
--    that is paid/partially_refunded/refunded, carries paid_minor > 0, or is flagged for settlement
--    review is still never expired. Excluding 'failed' only meant a declined-then-abandoned booking
--    was never released at all.
-- ---------------------------------------------------------------------------
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
       and b.payment_state in ('pending', 'failed')
       and b.created_at < now() - v_grace
       and not exists (
         select 1 from payments pay
         where pay.booking_id = b.id
           and (pay.status in ('paid', 'partially_refunded', 'refunded')
                or pay.paid_minor > 0
                or pay.settlement_review_at is not null)
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

revoke execute on function run_booking_maintenance(jsonb) from public, anon, authenticated;
grant execute on function run_booking_maintenance(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. api_pending_payment_checkouts -- verbatim from 20260805000000 with ONE change: the enumeration
--    predicate accepts 'failed' as well as 'pending'.
--
--    This is the sweep that re-queries Peach when a webhook never arrives. Excluding 'failed' made it
--    skip exactly the customers most likely to need it: the ones retrying after a decline.
--    The `not exists` over payment_events below still keeps an already-settled payment out.
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
         and b.payment_state in ('pending', 'failed')
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

revoke execute on function api_pending_payment_checkouts(jsonb) from public, anon, authenticated;
grant execute on function api_pending_payment_checkouts(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Repair the rows the latch already stranded: a booking still in flight whose projection reads
-- 'failed' while none of its payment rows actually holds money. Recomputed with the same ranking the
-- function now uses, so it is idempotent and a no-op once the code above is live.
-- ---------------------------------------------------------------------------
update bookings b
   set payment_state = 'pending', updated_at = now()
 where b.payment_state = 'failed'
   and b.status in ('draft', 'held', 'payment_pending')
   and exists (select 1 from payments pay where pay.booking_id = b.id and pay.status <> 'failed')
   and not exists (
     select 1 from payments pay
     where pay.booking_id = b.id
       and (pay.status in ('paid', 'partially_refunded', 'refunded') or pay.paid_minor > 0)
   );


-- ---------------------------------------------------------------------------
-- 5. api_book -- verbatim from 20260901000300 with ONE change, applied to BOTH fare-override blocks
--    (airport and hotel-to-hotel, which are byte-identical): the override is skipped once the booking
--    has a payment row.
--
--    Every other post-create mutation here is already replay-safe, because create_booking returns the
--    EXISTING row on an idempotency-key replay -- the child-seat extra is guarded `and child_seats = 0`,
--    the transport add-on `and transport_minor = 0`, the itinerary `and custom_itinerary is null`.
--    The transfer fare branches were the exception: they re-wrote total_minor, operator_payout_minor
--    and the line item unconditionally, so a replayed POST re-priced a live booking underneath a
--    pinned MUR charge and an already-minted Peach session.
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

  -- The language the guest booked in. Email and PDFs render later, often from a cron worker with no
  -- request context, so the locale must be stored rather than inferred at send time. Unconditional: by
  -- this point the F23 guard above has already verified the caller may act on this booking, so re-
  -- asserting the same value on an idempotent replay is harmless. Absent/empty collapses to 'en' (never
  -- SQL NULL, never a failed enum cast), so an older client that sends no locale still books cleanly.
  update bookings
  set locale = coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale
  where id = v_booking.id;

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
    -- Replay guard, matching the pattern every other post-create mutation in this function already
    -- uses (`and custom_itinerary is null`, `and pickup_location is null`, `and pickup_pending = false`).
    -- create_booking returns the EXISTING row on an idempotency-key replay, so unguarded this silently
    -- re-prices a booking that has already started paying -- moving total_minor out from under the MUR
    -- charge pinned on its payment row and a Peach session already minted for the old amount.
    if v_fare > 0 and not exists (select 1 from payments pay where pay.booking_id = v_booking.id) then
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
    -- Replay guard, matching the pattern every other post-create mutation in this function already
    -- uses (`and custom_itinerary is null`, `and pickup_location is null`, `and pickup_pending = false`).
    -- create_booking returns the EXISTING row on an idempotency-key replay, so unguarded this silently
    -- re-prices a booking that has already started paying -- moving total_minor out from under the MUR
    -- charge pinned on its payment row and a Peach session already minted for the old amount.
    if v_fare > 0 and not exists (select 1 from payments pay where pay.booking_id = v_booking.id) then
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
