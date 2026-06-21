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
