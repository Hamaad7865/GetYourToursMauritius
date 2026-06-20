-- The booking LEDGER is EUR, but the Mauritius card acquirer settles in USD. createPaymentLink
-- converts the EUR total to whole-dollar USD at charge time and sends THAT to the provider — but
-- the charged amount/currency was never persisted, so a receipt/invoice could only show the EUR
-- ledger figure, not what the customer's card was actually billed. Record the real charge on the
-- payment row (best-effort, written after the payment + checkout session are created).
alter table payments add column if not exists charged_amount_minor integer;
alter table payments add column if not exists charged_currency text;

-- Records what the card was actually charged on an existing payment row. SECURITY DEFINER so the
-- edge request path (running as the signed-in customer) can write these provider-side fields without
-- broadening table RLS. Best-effort: a no-op when the payment id is unknown — it never blocks checkout.
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

  update payments
  set charged_amount_minor = v_minor,
      charged_currency = v_currency
  where id = v_payment_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function api_record_payment_charge(jsonb) to authenticated, service_role;
