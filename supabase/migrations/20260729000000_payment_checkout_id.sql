-- 20260729000000_payment_checkout_id: persist the Peach checkout id for server-side reconciliation.
-- A later sweep re-queries Peach for a payment's status, which needs the checkout id on the payment row.
-- Additive (one nullable column + a new SECURITY DEFINER writer) so it can't drift a migrated DB.
-- Unlike the charge (record-once), the checkout id OVERWRITES: a re-pay opens a fresh checkout and the
-- sweep must query the latest one.
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
