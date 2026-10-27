-- One departure can leave at a different time from its tour's usual start (a tide, a late flight, a
-- guide's request). Until now a departure's time came ONLY from the tour's start time (option, else
-- activity — see src/lib/catalogue/departure-time.ts), so the calendar had no way to say "the 26 Oct
-- boat leaves at 08:00". This adds a per-departure override that wins over both.
--
-- 1) session_occurrences.departure_time — NULL means "use the tour's start time". It is a Mauritius
--    wall-clock time, deliberately NOT folded into starts_at: every day-slot sits at a placeholder clock
--    that the booking calendar (utcDayKey) and materialize_availability's per-day de-dupe both rely on.
-- 2) api_admin_set_departure_time — staff set or clear it for one open, not-yet-departed departure.
--    Guests are NOT notified (the calendar says so); staff tell them.
-- 3) api_booking_receipt — the 20261027120000 body VERBATIM, with the override first in the start-time
--    coalesce, so the guest's confirmation email + invoice print the time staff set.

alter table session_occurrences add column if not exists departure_time time;

comment on column session_occurrences.departure_time is
  'Per-departure start time (Mauritius wall clock) overriding the tour''s start time; NULL = use the tour''s.';

create or replace function api_admin_set_departure_time(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p ->> 'occurrenceId', '')::uuid;
  v_raw text := nullif(btrim(coalesce(p ->> 'time', '')), '');
  v_time time;
  v_occ session_occurrences;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_id is null then
    raise exception 'invalid_request' using detail = 'set_departure_time: occurrenceId required';
  end if;
  -- "HH:MM", 24-hour. NULL / blank clears the override back to the tour's start time.
  if v_raw is not null then
    if v_raw !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'invalid_request' using detail = 'set_departure_time: time must be HH:MM';
    end if;
    v_time := v_raw::time;
  end if;

  select * into v_occ from session_occurrences where id = v_id for update;
  if not found then
    raise exception 'occurrence_not_found';
  end if;
  -- A called-off departure runs at no time, and a departed one is history.
  if v_occ.status = 'cancelled' then
    raise exception 'occurrence_cancelled';
  end if;
  if (v_occ.starts_at at time zone 'Indian/Mauritius')::date < (now() at time zone 'Indian/Mauritius')::date then
    raise exception 'occurrence_in_past';
  end if;

  update session_occurrences set departure_time = v_time where id = v_id;

  return jsonb_build_object(
    'occurrenceId', v_id,
    'departureTime', to_char(v_time, 'HH24:MI')
  );
end;
$$;

revoke execute on function api_admin_set_departure_time(jsonb) from public, anon;
grant execute on function api_admin_set_departure_time(jsonb) to authenticated, service_role;

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
  v_start_window text;
  v_payment jsonb;
  v_phone text;
  v_locale text;
  v_bal bigint;
  v_addon_charged bigint := 0;
  v_change_charged bigint := 0;
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

  -- The booking-wide "headline" activity title (the FIRST tour) + earliest trip date, for the header,
  -- plus that departure's start time: the per-departure override staff set on the calendar
  -- (`o.departure_time`), else the option's start time AS TYPED, else the activity's. `o.starts_at` sits
  -- at a placeholder clock, so this is the only departure time the Date line may print. The app parses it.
  select a.title, o.starts_at,
         coalesce(to_char(o.departure_time, 'HH24:MI'),
                  nullif(btrim(ao.start_window), ''),
                  nullif(btrim(a.extra ->> 'startWindow'), ''))
    into v_title, v_when, v_start_window
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

    -- THE CHANGE ADD-ON, folded the same way and for the same reason: the guest paid the difference
    -- on its own payments row, so an invoice that reported only the original charge would understate
    -- what was actually taken from the card. Gated on applied_at because a settled-but-unapplied
    -- change is an ORPHAN -- it never moved the booking, the owner has been alerted to refund it, and
    -- it must not appear as part of this booking's charge.
    --
    -- The currency guard is load-bearing, not defensive: chargedAmountMinor is a single scalar in one
    -- currency, so adding a row charged in a different one would produce a number that is not money in
    -- any currency. Dropping it out is the correct, conservative answer.
    select coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor)), 0)
      into v_change_charged
      from payments pay
     where pay.booking_id = v_booking_id
       and pay.purpose = 'change_addon'
       and pay.paid_minor > 0
       and exists (
         select 1 from booking_change_requests r
          where r.payment_id = pay.id and r.applied_at is not null
       )
       and coalesce(pay.charged_currency, pay.currency)
             is not distinct from (v_payment ->> 'chargedCurrency');
    if v_change_charged > 0 then
      v_payment := v_payment || jsonb_build_object(
        'chargedAmountMinor', (v_payment ->> 'chargedAmountMinor')::bigint + v_change_charged
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
    || jsonb_build_object('activityTitle', v_title, 'when', v_when, 'startWindow', v_start_window)
    || jsonb_build_object('payment', coalesce(v_payment, 'null'::jsonb))
    || jsonb_build_object('customerPhone', v_phone)
    || jsonb_build_object('balanceDueMinor', coalesce(v_bal, 0))
    || jsonb_build_object('locale', v_locale);
end;
$$;

revoke execute on function api_booking_receipt(jsonb) from public, anon, authenticated;
grant execute on function api_booking_receipt(jsonb) to service_role;
