-- 20261017120000_charge_currency_setting
--
-- The owner chooses, in /admin, which currency customers' cards are charged in — and sets the
-- EUR→MUR rate by hand.
--
-- Background: since 2026-07-30 every card was charged in MUR (the live Peach account had no EUR
-- facility; see 20260830000000) at a rate the maintenance cron pulled from open.er-api.com into
-- fx_rates. Peach has now enabled EUR on the account (2026-10-17). Owner decision:
--   * a switch in the admin Dashboard: charge cards in MUR or in EUR;
--   * the EUR→MUR rate is typed in by the owner, and the Exchange Rate API feed is retired.
--
-- Prices and the ledger are untouched: they were always EUR. What changes is only the PIN — the
-- figure create_payment writes once per payment row into payments.charged_amount_minor /
-- charged_currency, which Peach is asked to charge and reconcile measures the settlement against.
--
-- Both settings live on the business_settings singleton (20260922000000) rather than in fx_rates:
-- that row already has the exact boundary wanted here — world-readable (the checkout must know
-- which currency to tell a customer about), staff-writable under RLS — and fx_rates is
-- service_role-only, so the admin card could not even read it. fx_rates and its two RPCs are left
-- in place, unused, rather than dropped.
--
-- Rollout safety:
--   * charge_currency DEFAULTS TO 'MUR', so applying this changes nothing until the owner flips it.
--   * eur_mur_rate is seeded from the current fx_rates row (the last rate the feed delivered), so
--     day one charges exactly what yesterday did.
--   * The switch applies to NEW pins only (first-write-wins, unchanged). A payment row pinned in MUR
--     keeps charging MUR — a Peach session minted under the old pin stays completable for ~30 minutes,
--     and re-pinning it would turn that settlement into a currency_mismatch quarantine.
--   * One booking, one charge currency: once a booking has taken money, later rows follow it (see the
--     pin block below).
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

-- ── business_settings: the two new settings ─────────────────────────────────────────────────────
alter table business_settings
  add column if not exists charge_currency text not null default 'MUR'
    check (charge_currency in ('MUR', 'EUR'));

-- The 40–70 band is the same plausibility band the pin re-checks on read (and src/lib/money/fx.ts's
-- EUR_MUR_MIN/MAX, which the admin card validates against). EUR/MUR has ranged ~44–54 over the past
-- decade; with a human typing it, the likeliest bad value is a slipped decimal (5.3, 530), which this
-- refuses at the door. NULL = never set — the pin then falls back to the 53.00 floor.
alter table business_settings
  add column if not exists eur_mur_rate numeric(18,6)
    check (eur_mur_rate is null or (eur_mur_rate >= 40 and eur_mur_rate <= 70));

-- When the rate was last changed (the admin card shows it; the pin copies it to charged_fx_at).
alter table business_settings
  add column if not exists eur_mur_rate_updated_at timestamptz;

comment on column business_settings.charge_currency is
  'Currency customer cards are charged in: MUR (the EUR price converted at eur_mur_rate, whole rupees) '
  'or EUR (the EUR price exactly). Read by create_payment when it pins a NEW payment row; a row already '
  'pinned keeps its currency.';
comment on column business_settings.eur_mur_rate is
  'Owner-set EUR→MUR rate used to pin MUR charges. Replaced the open.er-api.com feed on 2026-10-17.';

-- Seed the rate from the last feed value, once. Only a value inside the band is carried over; with no
-- usable fx_rates row the column stays NULL and the pin uses the 53.00 floor, exactly as it did before.
update business_settings bs
   set eur_mur_rate = r.rate,
       eur_mur_rate_updated_at = r.fetched_at
  from fx_rates r
 where bs.eur_mur_rate is null
   and r.base = 'EUR' and r.quote = 'MUR'
   and r.rate >= 40 and r.rate <= 70;

-- ── create_payment: the WINNING body (20261006000000) VERBATIM, except the pin block ─────────────
-- Re-applied in full because this repo resolves "the last migration to define a function wins". The
-- only differences from 20261006000000: one declared variable (v_ccy) and the pin block, which now
-- reads the currency and the rate from business_settings instead of hard-coding MUR from fx_rates.
-- tests/integration/resolved-function-bodies.test.ts pins both the old contracts and the new one.
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
  v_ccy text;
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
  -- What the card is asked to pay, in the currency the owner chose in /admin (business_settings.
  -- charge_currency, 20261017120000): EUR = the ledger amount exactly; MUR = the EUR ledger amount
  -- converted to WHOLE RUPEES at the owner-set rate (business_settings.eur_mur_rate). Derived here, in
  -- SQL, from server-controlled settings — NEVER from caller input (this function is granted to
  -- authenticated; a caller-supplied rate or currency would let a booking owner pin their own MUR 0.05
  -- charge). First-write-wins: every later call — every re-minted checkout session, the pay page,
  -- reconcile — reads THIS figure, so flipping the currency or moving the rate in /admin never makes a
  -- live session's charge and its expected settlement drift. The switch applies to NEW pins only.
  if v_payment.charged_amount_minor is null and v_payment.amount_minor > 0 then
    -- ONE BOOKING, ONE CHARGE CURRENCY. Once any payment on this booking has taken money, every later
    -- row (the balance, a dated installment, a pickup or change add-on) is charged in that same
    -- currency, whatever the switch says now. api_booking_receipt sums the booking + balance rows'
    -- charged_amount_minor into ONE scalar labelled with ONE currency, and folds an add-on only when
    -- its currency matches — so a MUR deposit followed by an EUR balance would print a "charged to
    -- card" figure that is money in no currency on a VAT invoice, and drop the add-on from it.
    -- (No row means v_ccy stays null — plpgsql SELECT INTO assigns null when nothing matches.)
    select coalesce(pay.charged_currency, pay.currency) into v_ccy
      from payments pay
     where pay.booking_id = v_booking.id
       and pay.id <> v_payment.id
       and pay.paid_minor > 0
     order by pay.created_at asc
     limit 1;
    if v_ccy is null then
      select bs.charge_currency into v_ccy from business_settings bs limit 1;
    end if;
    -- Anything but an explicit EUR — no settings row, a null — charges MUR, the long-standing default.
    v_ccy := case when upper(coalesce(v_ccy, 'MUR')) = 'EUR' then 'EUR' else 'MUR' end;

    if v_ccy = 'EUR' then
      -- Same currency as the ledger: the card pays the ledger amount to the cent. No conversion and no
      -- whole-unit rounding — reconcile measures the settlement against exactly this figure.
      v_charged := v_payment.amount_minor;
      v_rate := 1;
      v_src := 'same-currency';
      v_at := now();
    else
      select bs.eur_mur_rate, coalesce(bs.eur_mur_rate_updated_at, bs.updated_at)
        into v_rate, v_at
        from business_settings bs limit 1;
      v_src := 'admin';
      -- Band-clamped on READ as well as write (the column CHECK is the write side): an inverted or
      -- mistyped rate that somehow reached the row (0.0185 would bill MUR 1.85 for a EUR 100 booking —
      -- and, because settled == charged, CONFIRM it) falls back to the floor instead of being trusted.
      -- A never-set rate lands here too.
      if v_rate is null or v_rate < 40 or v_rate > 70 then
        v_rate := 53.00; -- safety floor; see the fx_rates seed comment (kept below mid on purpose)
        v_src := 'fallback';
        v_at := now();
      end if;
      -- Whole rupees: kills every sub-unit disagreement between what we send Peach and what Peach
      -- reports back. Costs at most MUR 0.50 (~EUR 0.01) per booking.
      v_charged := (round(v_payment.amount_minor * v_rate / 100.0) * 100)::bigint;
    end if;

    update payments
       set charged_amount_minor = v_charged,
           charged_currency = v_ccy,
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

revoke execute on function create_payment(jsonb, boolean) from public, anon, authenticated;
grant execute on function create_payment(jsonb, boolean) to service_role;
