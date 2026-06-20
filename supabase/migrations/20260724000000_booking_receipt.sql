-- Invoice + Receipt email (Task 6): give the out-of-band notification drain everything it needs to
-- render the confirmation email + the combined Tax Invoice / Receipt PDF, in one elevated read.
--
-- Two pieces:
--   1. claim_notifications also returns booking_id, so the drain can look the booking up by id (the
--      idempotency-keyed enqueue already stamps booking_id on every confirmation/refund row).
--   2. api_booking_receipt(p) — a SECURITY DEFINER read that returns booking_json merged with the two
--      fields booking_json cannot carry (the activity title + the occurrence date/time), plus the
--      payment block (the actually-charged amount/currency from 20260723000000, the paid timestamp and
--      the provider event ref). The drain runs as service_role behind INTERNAL_TASK_SECRET; this RPC is
--      SECURITY DEFINER + service_role-only so the worker can read the customer email / payment without
--      broadening table RLS.

-- ---------------------------------------------------------------------------
-- claim_notifications: identical to 20260617120200 (the lease) EXCEPT it now also returns booking_id.
-- A confirmation/refund row always has booking_id (enqueue_booking_notification sets it); plain rows
-- carry null, which the drain ignores. mark_notification is unchanged.
-- ---------------------------------------------------------------------------
create or replace function claim_notifications(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 100);
  v_lease interval := make_interval(
    secs => least(greatest(coalesce((p ->> 'leaseSeconds')::int, 300), 30), 3600)
  );
  v_rows jsonb;
begin
  with batch as (
    select id from notification_outbox
    where status = 'pending'
      and attempts < 5
      and (locked_until is null or locked_until <= now())
    order by created_at
    limit v_limit
    for update skip locked
  ), upd as (
    update notification_outbox o
       set attempts = attempts + 1,
           locked_until = now() + v_lease
      from batch
     where o.id = batch.id
    returning o.id, o.channel, o.recipient, o.template, o.payload, o.booking_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'channel', channel, 'recipient', recipient, 'template', template,
    'payload', payload, 'bookingId', booking_id
  )), '[]'::jsonb)
  into v_rows
  from upd;
  return v_rows;
end;
$$;

revoke execute on function claim_notifications(jsonb) from public;
grant execute on function claim_notifications(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- api_booking_receipt(p) — p = { bookingId }. Returns booking_json enriched with:
--   activityTitle : the title of the activity behind the booking's FIRST item (ordered by occurrence
--                   start, then item creation) — the primary activity for a single- or multi-item order.
--   when          : the EARLIEST occurrence start among the booking's items (ISO) — the trip date.
--   payment       : { chargedAmountMinor, chargedCurrency, paidAt, providerRef } from the booking's
--                   most-recent payment row: charged_* (the real card charge from 20260723000000,
--                   falling back to the EUR ledger amount/currency when not yet recorded), the first
--                   'paid' event's occurred_at, and that event's provider_event_id.
-- Returns null when the booking does not exist.
-- ---------------------------------------------------------------------------
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

  return v_base
    || jsonb_build_object('activityTitle', v_title, 'when', v_when)
    || jsonb_build_object('payment', coalesce(v_payment, 'null'::jsonb));
end;
$$;

revoke execute on function api_booking_receipt(jsonb) from public;
grant execute on function api_booking_receipt(jsonb) to service_role;
