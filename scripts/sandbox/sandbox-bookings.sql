-- =============================================================================
-- Sandbox seed — fake bookings across every status
--
-- Run LAST by `npm run sandbox:setup`, after the test users exist (so a booking
-- can be owned by customer@sandbox.test). Produces a realistic spread the admin
-- screens, reports and calendar can display:
--   confirmed/paid · payment_pending · cancelled · refund_pending · refunded
--
-- Each booking is tagged notes='sandbox-seed'. The block is a no-op if those
-- rows already exist, so `npm run sandbox:setup` stays idempotent. To rebuild
-- the fake bookings, delete them first:
--   delete from bookings where notes = 'sandbox-seed';
--
-- Bookings are inserted directly (not through the api_book money path) — this is
-- seed data for a throwaway sandbox, so the amounts are self-consistent
-- (total = unit × qty, payment ledger agrees) rather than server-recomputed.
-- =============================================================================

do $sb$
declare
  n         int;
  made      int := 0;
  spec      record;
  c         record;
  v_user    uuid;
  v_booking uuid;
  v_payment uuid;
  v_amount  int;
begin
  if exists (select 1 from bookings where notes = 'sandbox-seed') then
    raise notice 'sandbox-bookings: already present — skipping';
    return;
  end if;

  -- Working set: the earliest future open slot for each normal (non-planner,
  -- non-transfer) published activity, with its cheapest price row.
  create temporary table _sb_cand on commit drop as
    with per_activity as (
      select distinct on (a.id)
             a.id              as activity_id,
             so.id             as occ_id,
             so.activity_option_id as opt_id,
             pr.label          as price_label,
             pr.amount_minor   as amount_minor
        from activities a
        join activity_options o  on o.activity_id = a.id
        join session_occurrences so
          on so.activity_option_id = o.id
         and so.status = 'open'
         and so.starts_at > now()
        join lateral (
               select label, amount_minor
                 from activity_option_prices
                where activity_option_id = o.id
                order by position
                limit 1) pr on true
       where a.status = 'published'
         and coalesce(a.is_custom_planner, false)   = false
         and coalesce(a.is_airport_transfer, false) = false
         and coalesce(a.is_hotel_transfer, false)   = false
       order by a.id, so.starts_at
    )
    select row_number() over (order by activity_id) as rn,
           occ_id, opt_id, price_label, amount_minor
      from per_activity;

  select count(*) into n from _sb_cand;
  if n = 0 then
    raise notice 'sandbox-bookings: no bookable occurrences found — run sandbox-seed.sql first';
    return;
  end if;

  v_user := (select id from auth.users where email = 'customer@sandbox.test');

  -- (seq, booking status, payment state, pax, name, email, owned-by-customer?)
  for spec in
    select * from (values
      (1, 'confirmed'::booking_status,       'paid'::payment_state,     2, 'Amelia Rose',  'customer@sandbox.test', true),
      (2, 'confirmed'::booking_status,       'paid'::payment_state,     3, 'Marcus Lee',    'marcus@example.com',    false),
      (3, 'confirmed'::booking_status,       'paid'::payment_state,     1, 'Priya Nair',    'priya@example.com',     false),
      (4, 'payment_pending'::booking_status, 'pending'::payment_state,  2, 'Tom Becker',    'tom@example.com',       false),
      (5, 'payment_pending'::booking_status, 'pending'::payment_state,  1, 'Amelia Rose',   'customer@sandbox.test', true),
      (6, 'cancelled'::booking_status,       'pending'::payment_state,  2, 'Sofia Marin',   'sofia@example.com',     false),
      (7, 'refund_pending'::booking_status,  'paid'::payment_state,     1, 'Liam Walsh',    'liam@example.com',      false),
      (8, 'refunded'::booking_status,        'refunded'::payment_state, 2, 'Nadia Osei',    'nadia@example.com',     false)
    ) as t(seq, status, pstate, qty, cname, cemail, owned)
  loop
    select * into c from _sb_cand where rn = ((spec.seq - 1) % n) + 1;
    v_amount := c.amount_minor * spec.qty;

    insert into bookings
      (user_id, customer_name, customer_email, source, status, currency,
       total_minor, operator_payout_minor, agency_commission_minor, payment_state, notes)
    values
      (case when spec.owned then v_user else null end,
       spec.cname, spec.cemail, 'web', spec.status, 'EUR',
       v_amount, v_amount, 0, spec.pstate, 'sandbox-seed')
    returning id into v_booking;

    insert into booking_items
      (booking_id, session_occurrence_id, activity_option_id, price_label,
       quantity, unit_amount_minor, subtotal_minor)
    values
      (v_booking, c.occ_id, c.opt_id, c.price_label, spec.qty, c.amount_minor, v_amount);

    -- A payment ledger only where money actually moved.
    if spec.pstate in ('paid', 'refunded', 'partially_refunded') then
      insert into payments
        (booking_id, idempotency_key, provider, amount_minor, currency, status,
         paid_minor, refunded_minor)
      values
        (v_booking, 'sandbox-' || v_booking::text, 'peach', v_amount, 'EUR', spec.pstate,
         v_amount, case when spec.pstate = 'refunded' then v_amount else 0 end)
      returning id into v_payment;

      insert into payment_events (payment_id, type, provider_event_id, amount_minor, occurred_at, payload)
      values (v_payment, 'paid', 'sandbox-' || v_payment::text || '-paid', v_amount, now(), '{}'::jsonb);

      if spec.pstate = 'refunded' then
        insert into payment_events (payment_id, type, provider_event_id, amount_minor, occurred_at, payload)
        values (v_payment, 'refunded', 'sandbox-' || v_payment::text || '-refunded', v_amount, now(), '{}'::jsonb);
      end if;
    end if;

    made := made + 1;
  end loop;

  raise notice 'sandbox-bookings: created % fake bookings (% activities available)', made, n;
end
$sb$;
