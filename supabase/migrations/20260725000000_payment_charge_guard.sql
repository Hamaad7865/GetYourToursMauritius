-- P1 IDOR + P2 FX-drift fix for api_record_payment_charge.
--
-- 20260723000000 introduced this SECURITY DEFINER writer granted to `authenticated` with NO
-- authorization check: it updates payments.charged_amount_minor/charged_currency for ANY payment id.
-- Being SECURITY DEFINER it bypasses the payments_staff RLS write policy AND the forbid_public_write
-- trigger, so any signed-in user who learns a payment UUID could falsify the recorded "PAID" amount /
-- currency on another customer's tax invoice + receipt (those fields render on the invoice PDF + email).
--
-- The legit caller is the SIGNED-IN CUSTOMER: POST /api/v1/payments runs requireUser then builds a
-- user-scoped (anon-key + Bearer) db client, so this RPC executes as that customer. Keep the
-- `authenticated` grant but gate the body to the booking owner or staff (same shape as api_create_payment
-- and api_release_hold).
--
-- P2 (FX drift): createPaymentLink calls this on EVERY POST /api/v1/payments with a fresh FX rate, so
-- re-paying an older Peach checkout after the rate moved overwrote the first recorded charge and the
-- receipt's USD no longer matched the card. Only set the charge ONCE (where charged_amount_minor is null)
-- so the first recorded value sticks.
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
  -- owner may record a charge against its payment row. auth.uid() must be non-null, else `null = null`
  -- is NULL (not false) and an anonymous caller would slip through a guest (user_id NULL) booking.
  if not (is_staff() or exists (
    select 1 from payments pay
    join bookings b on b.id = pay.booking_id
    where pay.id = v_payment_id and auth.uid() is not null and b.user_id = auth.uid()
  )) then
    raise exception 'forbidden';
  end if;

  -- Record the charge ONCE (FX-drift fix): a later re-pay with a different rate must not overwrite the
  -- first recorded amount, or the receipt's USD would disagree with what the card was billed.
  update payments
  set charged_amount_minor = v_minor,
      charged_currency = v_currency
  where id = v_payment_id and charged_amount_minor is null;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function api_record_payment_charge(jsonb) to authenticated, service_role;
