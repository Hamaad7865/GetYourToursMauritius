-- The VAT invoice/receipt printed EVERY line under ONE tour's name.
--
-- api_booking_receipt returned a single booking-wide `activityTitle` (the earliest booking_item's
-- activity), and buildInvoice prefixed it onto every line — "<activityTitle> — <priceLabel>". That was
-- correct back when a booking was one activity with a few price bands. It is wrong the moment a booking
-- carries more than one thing, which a converted QUOTE routinely does: the offer can mix several
-- different catalogue tours (each a booking_items row) with transfers, a car rental and free-text
-- custom lines (all booking_custom_items). Observed on BMTDB3C935BB085C — a quote with THREE distinct
-- tours plus five custom lines — whose receipt read, in full:
--
--   Catamaran Cruise – Ile Aux Cerfs — Adult          (the Catamaran Cruise line — right)
--   Catamaran Cruise – Ile Aux Cerfs — Adult          (actually the Dolphin swim tour — WRONG)
--   Catamaran Cruise – Ile Aux Cerfs — Adult          (actually the Northern Islands tour — WRONG)
--   Catamaran Cruise – Ile Aux Cerfs — Private South Tour Mauritius …   (a custom line — WRONG)
--   Catamaran Cruise – Ile Aux Cerfs — Round-trip transfer · …          (a transfer — WRONG)
--   Catamaran Cruise – Ile Aux Cerfs — Nissan March · … 1-day rental    (a car rental — WRONG)
--
-- The fix moves the title ONTO EACH LINE. A catalogue line carries its OWN activity's title; a custom
-- line (transfer, rental, free-text) carries `title = null`, because its description already says what
-- it is and a prefix there is what produced "… — Nissan March". buildInvoice (src/lib/invoice/model.ts)
-- reads the per-line `title` and only falls back to the booking-wide `activityTitle` when a line
-- supplies none — so an ordinary single-tour booking, whose header title still names it, is unchanged.
--
-- Everything else in this function is the 20260915000000 body verbatim: the deposit/balance payment
-- roll-up, the applied-pickup add-on fold-in, and the `balanceDueMinor` the deposit receipt needs are
-- all preserved (tests/integration/resolved-function-bodies.test.ts pins both `from
-- booking_custom_items` and the `balanceDueMinor` projection). The catalogue lines are now built HERE
-- with their titles rather than taken from booking_json's untitled `items`, and — the receipt's own
-- ordering contract (voucher-pdf.ts reads lines[0]) — they still come FIRST, custom lines after by
-- position. Mirror into supabase/catch-up.sql and regenerate supabase/setup.sql (`npm run setup:sql`).

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

  -- The booking-wide "headline" activity title + the earliest trip date, for the RÉSERVATION header
  -- block (buildInvoice's `model.booking.activityTitle`). It is the FIRST tour, not every tour — and
  -- that is fine for a one-line header. The per-line titles below are what the itemisation reads.
  select a.title, o.starts_at
    into v_title, v_when
    from booking_items bi
    join session_occurrences o on o.id = bi.session_occurrence_id
    join activity_options ao on ao.id = bi.activity_option_id
    join activities a on a.id = ao.activity_id
   where bi.booking_id = v_booking_id
   order by o.starts_at asc, bi.created_at asc
   limit 1;

  -- SETTLED SO FAR, summed across the deposit ('booking') and the balance ('balance') rows -- NOT the
  -- single newest row the pre-deposit body picked. A deposit receipt shows the deposit charged; once the
  -- balance clears the full invoice shows BOTH charges. An ordinary booking has only the one 'booking'
  -- row, so this is byte-identical to the old `order by created_at desc limit 1`. Only rows that actually
  -- settled (paid_minor > 0) contribute a charge, so a minted-but-uncharged balance row adds nothing;
  -- paidAt/providerRef are the LATEST settled event across the counted rows.
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

  -- A settled late-pickup supplement is a SECOND charge on the same card, and its fare is already
  -- inside the booking's total_minor - so the receipt's charged figure has to include it, or the
  -- invoice states that a EUR 150 order settled with the EUR 120 charge and buildPaymentBlock's
  -- derived fx rate (charged / total) becomes fiction. Summed only across rows in the SAME charge
  -- currency: a legacy EUR booking row and an MUR add-on cannot be added together, and omitting the
  -- add-on understates by less than a cross-currency sum would misstate.
  if v_payment is not null then
    select coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor)), 0)
      into v_addon_charged
      from payments pay
     where pay.booking_id = v_booking_id
       and pay.purpose = 'pickup_addon'
       and pay.paid_minor > 0
       -- APPLIED, not merely settled. apply_pickup_request adds the fare to total_minor only for a
       -- live booking on a running departure; a capture it refused leaves the total untouched, so
       -- folding its charge in here would print a charged figure the invoice's own lines do not add
       -- up to — and buildPaymentBlock derives its fx rate from charged/total.
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

  -- The guest's stored booking locale (Task 15) + the amount still owed (Task 6/7: the deposit split).
  -- The notification drain runs off-request (cron), so this is the only correct source for language.
  select b.customer_phone, b.locale::text, b.balance_due_minor
    into v_phone, v_locale, v_bal
    from bookings b where b.id = v_booking_id;

  -- ── THE CATALOGUE LINES, EACH WITH ITS OWN ACTIVITY TITLE ───────────────────────────────────────
  -- The ONLY change from booking_json's own `items` is the added per-line `title`, resolved by a
  -- correlated subquery: same FROM (`booking_items bi`), same WHERE, and NO `order by` — so the row
  -- order is byte-identical to what booking_json emitted, which several consumers read positionally and
  -- must not shift (the owner-alert party mix maps `items` straight to "N × band" in array order, and
  -- voucher-pdf.ts reads lines[0]). The title makes a multi-tour quote name each line for the tour IT
  -- belongs to; buildInvoice renders "<title> — <priceLabel>", falling back to the booking-wide title
  -- only when a line supplies none. A JOIN in the FROM or an `order by` here is exactly what silently
  -- reordered the age bands and broke the owner alert — do not reintroduce either. Empty (and free) for
  -- a booking with no booking_items, e.g. a pure-custom converted quote. Appended BEFORE the custom lines.
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', (select a.title
                       from activity_options ao
                       join activities a on a.id = ao.activity_id
                      where ao.id = bi.activity_option_id),
           -- The line's OWN departure, so the receipt/email can print a per-line date. Correlated
           -- subquery (not a FROM join) to keep the item order byte-identical — see the note above.
           'when', (select o.starts_at from session_occurrences o where o.id = bi.session_occurrence_id),
           'priceLabel', bi.price_label,
           'quantity', bi.quantity,
           'pax', bi.pax,
           'unitAmountEur', bi.unit_amount_minor::float / 100,
           'subtotalEur', bi.subtotal_minor::float / 100,
           'occurrenceId', bi.session_occurrence_id
         )), '[]'::jsonb)
    into v_items
    from booking_items bi
   where bi.booking_id = v_booking_id;

  -- FROM 20260909000000 SECTION 7b - the priced lines that have no session_occurrence: a converted
  -- quote's custom/transfer lines, and rentals. `title` is explicitly NULL so buildInvoice adds no
  -- prefix — the description ("Round-trip transfer · …", "Nissan March · … 1-day rental") already
  -- names the line, and prefixing it with the booking's first tour is exactly the bug being fixed.
  --   * `priceLabel` <- `description`. A custom line has no price label (it is not a catalogue price
  --     band) and `booking_custom_items.description` is NOT NULL precisely so the line stays readable
  --     on its own; receiptSchema types priceLabel as a required string, so this is the field it maps to.
  --   * `quantity` verbatim, and `pax` explicitly null - a custom line is priced per LINE, not per
  --     person, and buildInvoice reads `pax ?? quantity`, so null is what makes it use the quantity.
  --   * `subtotalEur` <- `subtotal_minor / 100.0`, the same minor->major conversion booking_json does.
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', null::text,
           'when', ci.starts_at, -- the custom line's own date (a transfer's excursion day, a rental's pickup)
           'priceLabel', ci.description,
           'quantity', ci.quantity,
           'pax', null::int,
           'unitAmountEur', ci.unit_amount_minor::float / 100,
           'subtotalEur', ci.subtotal_minor::float / 100
         ) order by ci.position), '[]'::jsonb)
    into v_custom
    from booking_custom_items ci
   where ci.booking_id = v_booking_id;

  -- Catalogue lines FIRST (voucher-pdf.ts reads lines[0]), custom lines after by position. `activityTitle`
  -- stays the booking's headline for the header block; the itemisation now names each line for itself.
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
