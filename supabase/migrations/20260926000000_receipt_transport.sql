-- api_booking_receipt carries each line's TRANSPORT ADD-ON, so the receipt/email can itemise the
-- attached round-trip transfer as a nested line under its tour/custom line.
--
-- The transfer fare is now inside bookings.total_minor (charged on the line, not as a separate line), but
-- until this migration api_booking_receipt did not surface it — so buildInvoice would see lines that
-- under-sum the total and the per-line VAT split would silently book the fare as tax. This re-applies the
-- WINNING body of api_booking_receipt (20260923000000 — per-line title + per-line date) VERBATIM apart
-- from two additions: `transportFareMinor` + `transportPickupLabel` on every catalogue AND custom item.
-- buildInvoice then emits a nested "Round-trip transfer · from <hotel>" line for any item whose fare > 0,
-- reconciling the lines back to the total.
--
-- Must come AFTER 20260924000000 (which added the transport_* columns) — it does (later filename). The
-- pinned contracts are preserved: `from booking_custom_items` and the `balanceDueMinor` projection
-- (resolved-function-bodies.test.ts). Mirror into supabase/catch-up.sql and regenerate supabase/setup.sql.

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
  v_bal bigint;
  v_addon_charged bigint := 0;
  v_items jsonb;
  v_custom jsonb;
begin
  if v_booking_id is null then
    raise exception 'invalid_request' using detail = 'booking_receipt: bookingId required';
  end if;

  v_base := booking_json(v_booking_id);
  if v_base is null then
    return null;
  end if;

  -- The booking-wide "headline" activity title (the FIRST tour) + earliest trip date, for the header.
  select a.title, o.starts_at
    into v_title, v_when
    from booking_items bi
    join session_occurrences o on o.id = bi.session_occurrence_id
    join activity_options ao on ao.id = bi.activity_option_id
    join activities a on a.id = ao.activity_id
   where bi.booking_id = v_booking_id
   order by o.starts_at asc, bi.created_at asc
   limit 1;

  select case
           when count(*) filter (where pay.paid_minor > 0) = 0 then null
           else jsonb_build_object(
             'chargedAmountMinor',
               coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor))
                        filter (where pay.paid_minor > 0), 0),
             'chargedCurrency',
               coalesce(max(coalesce(pay.charged_currency, pay.currency))
                        filter (where pay.paid_minor > 0), max(pay.currency)),
             'paidAt', max(paid.occurred_at) filter (where pay.paid_minor > 0),
             'providerRef', (array_agg(paid.provider_event_id order by paid.occurred_at desc nulls last)
                             filter (where pay.paid_minor > 0 and paid.provider_event_id is not null))[1]
           )
         end
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
     and pay.purpose in ('booking', 'balance');

  if v_payment is not null then
    select coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor)), 0)
      into v_addon_charged
      from payments pay
     where pay.booking_id = v_booking_id
       and pay.purpose = 'pickup_addon'
       and pay.paid_minor > 0
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

  select b.customer_phone, b.locale::text, b.balance_due_minor
    into v_phone, v_locale, v_bal
    from bookings b where b.id = v_booking_id;

  -- Catalogue lines, each with its OWN activity title, per-line date, AND its attached transport add-on.
  -- Same FROM/WHERE as booking_json's items and NO order by, so item order stays byte-identical (the
  -- owner-alert party mix + voucher lines[0] read it positionally). `transportFareMinor`/
  -- `transportPickupLabel` are the attached round-trip transfer; buildInvoice renders a nested line from
  -- them. A JOIN/order by here reordered the age bands and broke the owner alert — do not reintroduce.
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', (select a.title
                       from activity_options ao
                       join activities a on a.id = ao.activity_id
                      where ao.id = bi.activity_option_id),
           'when', (select o.starts_at from session_occurrences o where o.id = bi.session_occurrence_id),
           'priceLabel', bi.price_label,
           'quantity', bi.quantity,
           'pax', bi.pax,
           'unitAmountEur', bi.unit_amount_minor::float / 100,
           'subtotalEur', bi.subtotal_minor::float / 100,
           'occurrenceId', bi.session_occurrence_id,
           'transportFareMinor', bi.transport_fare_minor,
           'transportPickupLabel', bi.transport_pickup_label
         )), '[]'::jsonb)
    into v_items
    from booking_items bi
   where bi.booking_id = v_booking_id;

  -- The priced lines that have no session_occurrence (a converted quote's custom/transfer lines, and
  -- rentals). title = null so buildInvoice adds no prefix — `booking_custom_items.description` already
  -- names the line. The transport add-on rides along exactly as it does for a catalogue line.
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', null::text,
           'when', ci.starts_at,
           'priceLabel', ci.description,
           'quantity', ci.quantity,
           'pax', null::int,
           'unitAmountEur', ci.unit_amount_minor::float / 100,
           'subtotalEur', ci.subtotal_minor::float / 100,
           'transportFareMinor', ci.transport_fare_minor,
           'transportPickupLabel', ci.transport_pickup_label
         ) order by ci.position), '[]'::jsonb)
    into v_custom
    from booking_custom_items ci
   where ci.booking_id = v_booking_id;

  -- Catalogue lines FIRST (voucher-pdf.ts reads lines[0]), custom lines after by position.
  return v_base
    || jsonb_build_object('items', v_items || v_custom)
    || jsonb_build_object('activityTitle', v_title, 'when', v_when)
    || jsonb_build_object('payment', coalesce(v_payment, 'null'::jsonb))
    || jsonb_build_object('customerPhone', v_phone)
    || jsonb_build_object('balanceDueMinor', coalesce(v_bal, 0))
    || jsonb_build_object('locale', v_locale);
end;
$$;

revoke execute on function api_booking_receipt(jsonb) from public, anon, authenticated;
grant execute on function api_booking_receipt(jsonb) to service_role;
