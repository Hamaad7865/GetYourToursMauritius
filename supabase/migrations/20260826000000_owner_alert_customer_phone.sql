-- The owner_new_booking alert email/WhatsApp/Telegram messages have no way to reach the guest by
-- phone -- api_booking_receipt (20260724000000_booking_receipt.sql) merges activityTitle/when/payment
-- on top of booking_json(), but booking_json() itself never carried customer_phone (it's written by
-- api_book/create_booking and shown in /admin, just never read back through this RPC). Add it the same
-- way the other two merged fields are added: one extra scalar read, folded into the returned jsonb.
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
   order by pay.created_at desc
   limit 1;

  select b.customer_phone into v_phone from bookings b where b.id = v_booking_id;

  return v_base
    || jsonb_build_object('activityTitle', v_title, 'when', v_when)
    || jsonb_build_object('payment', coalesce(v_payment, 'null'::jsonb))
    || jsonb_build_object('customerPhone', v_phone);
end;
$$;

revoke execute on function api_booking_receipt(jsonb) from public, anon, authenticated;
grant execute on function api_booking_receipt(jsonb) to service_role;
