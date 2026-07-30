-- Charge the card in MUR, keep the EUR ledger.
--
-- Peach confirmed (2026-07-30) the live merchant account has NO EUR facility, so every
-- create-checkout in EUR fails with "No valid payment methods available for this request" and no
-- customer can pay. Owner decision: prices and the ledger STAY EUR (the contractual price); the card
-- is charged the EUR total converted to MUR at a live rate.
--
-- Design (adversarially reviewed before implementation — see
-- docs/superpowers/plans/2026-07-30-mur-charge-currency.md):
--
--   THE MUR CHARGE IS PINNED ONCE PER PAYMENT ROW, HERE IN SQL, from a server-controlled rate table.
--   The service charges the figure this function returns — it never computes an amount itself.
--
-- Why pinning is load-bearing and not decoration:
--   * payments.charged_amount_minor is deliberately FIRST-WRITE-WINS (api_record_payment_charge,
--     20260725000000). If the service computed a fresh MUR figure per checkout session, a re-minted
--     session at a moved rate would charge one amount while reconcile measured the settlement against
--     another — quarantining legitimate full payments (or worse). Pinning makes first-write-wins
--     CORRECT: every session for a payment charges the identical figure, the pay page shows that
--     figure, and reconcile measures settlements against it. One number, three uses, no drift.
--   * The rate comes from fx_rates (refreshed by the maintenance cron), NEVER from caller input:
--     api_create_payment is granted to authenticated, so a caller-supplied rate would let a booking
--     owner pin their own MUR 0.05 charge — the exact hole 20260725000000 closed for amounts.
--   * Whole rupees (multiples of 100 minor units) kill every sub-unit disagreement between the amount
--     we send Peach ((minor/100).toFixed(2)) and the amount Peach echoes back. Cost: ≤ MUR 0.50/booking.
--
-- The EUR ledger is untouched: payments.amount_minor / currency, payment_events.amount_minor,
-- paid_minor / refunded_minor all stay EUR. append_payment_event is NOT modified (its grants are
-- pinned to the exact 6-arg signature — see 20260814000000 and the definer-grant-leak history).
-- reconcile.ts converts a full MUR settlement into a full-EUR-total ledger credit; a short or
-- wrong-currency settlement quarantines and flags settlement_review_at so the expiry sweep cannot
-- silently release a booking whose money may be real.

-- ── fx_rates: server-controlled EUR→MUR rate ────────────────────────────────────────────────────
-- One row per (base, quote). Written ONLY by the maintenance cron via api_upsert_fx_rate; read ONLY
-- inside api_create_payment. Seeded so day one has a usable row before the first cron tick.
create table if not exists fx_rates (
  base text not null,
  quote text not null,
  rate numeric(18,6) not null check (rate > 0),
  source text not null,
  fetched_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (base, quote)
);

comment on table fx_rates is
  'Server-controlled FX rates for charge-currency conversion (EUR→MUR). Written only by the '
  'maintenance cron (api_upsert_fx_rate); read only inside api_create_payment when pinning a charge. '
  'Never exposed to customers — display prices remain EUR.';

alter table fx_rates enable row level security; -- no policies: definer/service-role access only

revoke all on fx_rates from public, anon, authenticated;
grant select, insert, update on fx_rates to service_role;

-- Cold-start floor. 53.00 is ~1.8% BELOW the 2026-07-30 open.er-api.com mid (53.976111),
-- deliberately: a frozen fallback then under-collects for US rather than over-charging a customer
-- against the EUR price they were quoted (consumer-protection beats revenue). OWNER: review
-- quarterly; it must stay below mid. Idempotent: never overwrites a live rate.
insert into fx_rates (base, quote, rate, source, fetched_at)
values ('EUR', 'MUR', 53.00, 'fallback', now())
on conflict (base, quote) do nothing;

-- ── api_upsert_fx_rate: the cron writes a fresh rate ────────────────────────────────────────────
create or replace function api_upsert_fx_rate(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rate numeric := nullif(p ->> 'rate', '')::numeric;
  v_source text := left(coalesce(nullif(btrim(p ->> 'source'), ''), 'unknown'), 100);
  v_fetched timestamptz := coalesce(nullif(p ->> 'fetchedAt', '')::timestamptz, now());
begin
  -- Grants are the primary gate (service_role only); defence in depth as in api_record_payment_charge.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  -- Band-clamp IN THE WRITE PATH too (api_create_payment re-checks on read): an inverted payload
  -- (MUR→EUR ≈ 0.0185) or a USD-based one must never become the pin denominator. EUR/MUR has ranged
  -- ~44–54 over the past decade; 40–70 flags anything structurally wrong without tripping on drift.
  if v_rate is null or v_rate < 40 or v_rate > 70 then
    raise exception 'invalid_request' using detail = 'fx rate outside the plausible EUR->MUR band';
  end if;

  insert into fx_rates (base, quote, rate, source, fetched_at, updated_at)
  values ('EUR', 'MUR', v_rate, v_source, v_fetched, now())
  on conflict (base, quote)
  do update set rate = excluded.rate, source = excluded.source,
                fetched_at = excluded.fetched_at, updated_at = now();

  return jsonb_build_object('ok', true, 'rate', v_rate);
end;
$$;

revoke execute on function api_upsert_fx_rate(jsonb) from public, anon, authenticated;
grant execute on function api_upsert_fx_rate(jsonb) to service_role;

-- ── api_fx_rate_status: lets the cron decide whether a fetch failure is fatal ───────────────────
create or replace function api_fx_rate_status(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row fx_rates;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  select * into v_row from fx_rates where base = 'EUR' and quote = 'MUR';
  if not found then
    return jsonb_build_object('rate', null, 'source', null, 'fetchedAt', null, 'ageHours', null);
  end if;
  return jsonb_build_object(
    'rate', v_row.rate, 'source', v_row.source, 'fetchedAt', v_row.fetched_at,
    'ageHours', extract(epoch from (now() - v_row.fetched_at)) / 3600.0
  );
end;
$$;

revoke execute on function api_fx_rate_status(jsonb) from public, anon, authenticated;
grant execute on function api_fx_rate_status(jsonb) to service_role;

-- ── payments: the charge record becomes the EXPECTED SETTLEMENT, plus review flags ──────────────
-- bigint: MUR minor units are ~54× the EUR figure; a EUR 397k-equivalent booking would overflow int.
alter table payments alter column charged_amount_minor type bigint;

alter table payments add column if not exists charged_fx_rate numeric(18,6);
alter table payments add column if not exists charged_fx_source text;
alter table payments add column if not exists charged_fx_at timestamptz;
alter table payments add column if not exists settlement_review_at timestamptz;
alter table payments add column if not exists settlement_review_reason text;

comment on column payments.charged_amount_minor is
  'What the CARD is asked to pay, in charged_currency minor units — the EXPECTED SETTLEMENT that '
  'reconcile measures provider events against, not receipt decoration. Pinned once per payment row '
  'inside api_create_payment (whole rupees for MUR); first-write-wins thereafter.';
comment on column payments.charged_currency is
  'Currency the card is charged in (MUR post-2026-07-30; EUR for legacy rows). May differ from '
  'payments.currency, which stays the EUR ledger currency.';
comment on column payments.charged_fx_rate is
  'EUR→charged-currency rate used to pin the charge, persisted for manual Peach refunds, chargeback '
  'evidence and VAT/MRA questions. Documents print the EFFECTIVE rate '
  '(charged_amount_minor / amount_minor) so their arithmetic closes after whole-rupee rounding.';
comment on column payments.settlement_review_at is
  'Set when a settled provider event could not be credited to the ledger (quarantined: short amount, '
  'currency mismatch, missing charge record). Blocks the auto-expiry sweep: money may be real.';

-- Loud write failure instead of silent mis-settlement if a future change ever tries to ledger a
-- booking in a new currency without designing for it.
alter table payments drop constraint if exists payments_ledger_currency_eur;
alter table payments add constraint payments_ledger_currency_eur check (currency = 'EUR');
alter table payments drop constraint if exists payments_charged_currency_known;
alter table payments add constraint payments_charged_currency_known
  check (charged_currency is null or charged_currency in ('EUR', 'MUR'));

-- ── api_flag_settlement_review ──────────────────────────────────────────────────────────────────
-- Called by reconcile when it QUARANTINES a settled event. Keeps the earliest flag time (coalesce):
-- the first quarantine is the incident; retries must not look like fresh ones.
create or replace function api_flag_settlement_review(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
  v_reason text := left(coalesce(nullif(btrim(p ->> 'reason'), ''), 'unspecified'), 200);
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'flag_settlement_review: paymentId required';
  end if;
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  update payments
     set settlement_review_at = coalesce(settlement_review_at, now()),
         settlement_review_reason = v_reason,
         updated_at = now()
   where id = v_payment_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_flag_settlement_review(jsonb) from public, anon, authenticated;
grant execute on function api_flag_settlement_review(jsonb) to service_role;

-- ── api_create_payment: pin the MUR charge once per payment row ─────────────────────────────────
-- Verbatim from 20260827000000 with TWO additions: the pin block (after the payment row exists,
-- before any return), and chargedAmountMinor/chargedCurrency/chargedFxRate on all three returns.
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

-- ── run_booking_maintenance: never auto-expire a booking whose money may be real ────────────────
-- Verbatim from 20260733000001 with ONE change: the stale predicate also spares a booking whose
-- payment carries a partial ledger credit (paid_minor > 0) or a settlement-review flag. Without this,
-- a settlement we could not credit (quarantined) would hit the grace timer, expire the booking and
-- release the seat WITH THE CUSTOMER'S MONEY TAKEN — the remedy must land before the detection.
-- Holds still expire on their own timer, so capacity is not held hostage; only the booking row
-- lingers for staff to resolve.
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

-- ── One-time cutover: clear the EUR-era pin on still-payable, never-settled rows ────────────────
-- These rows recorded charged_currency='EUR' back when the card was charged EUR. The live Peach
-- account cannot take EUR, so left pinned they would hand every retry an unpayable expectation.
-- Clearing lets the customer's next "Complete payment" click re-pin in MUR. Date-bounded and
-- settled-event-guarded, so re-running catch-up.sql is a no-op and no settled money is ever touched.
update payments p
   set charged_amount_minor = null, charged_currency = null,
       charged_fx_rate = null, charged_fx_source = null, charged_fx_at = null
 where p.charged_currency = 'EUR' and p.status = 'pending'
   and p.created_at < '2026-07-31'::timestamptz
   and exists (select 1 from bookings b where b.id = p.booking_id
                 and b.status in ('draft', 'held', 'payment_pending'))
   and not exists (select 1 from payment_events pe
                    where pe.payment_id = p.id and pe.type in ('paid', 'captured', 'refunded'));
