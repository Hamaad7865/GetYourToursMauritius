-- F14: cancelling a PAID booking must record the refund obligation, not silently keep the money.
--
-- setBookingStatus(id,'cancelled') was permitted for a confirmed booking and only changed status;
-- the guard pins payment_state, so a paid booking became status='cancelled', payment_state='paid'
-- with no refund/refund_pending state and no notification — the seat is freed for resale but the
-- system records nothing owed back to the customer (chargeback / accounting-drift risk).
--
-- Route a browser-session cancel of a paid (or partially-refunded) booking to 'refund_pending'
-- instead, so the retained-funds obligation is explicit. The actual refund still flows through the
-- verified webhook → append_payment_event ledger, which sets payment_state='refunded'. An UNPAID
-- booking cancels exactly as before.
create or replace function enforce_booking_admin_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new; -- service_role / owner / SECURITY DEFINER RPCs (webhook, create_booking)
  end if;

  -- Immutable from a browser session — owned by the booking/ledger RPCs.
  new.payment_state           := old.payment_state;
  new.total_minor             := old.total_minor;
  new.agency_commission_minor := old.agency_commission_minor;
  new.operator_payout_minor   := old.operator_payout_minor;
  new.currency                := old.currency;
  new.ref                     := old.ref;
  new.idempotency_key         := old.idempotency_key;
  new.user_id                 := old.user_id;
  new.customer_name           := old.customer_name;
  new.customer_email          := old.customer_email;
  new.customer_phone          := old.customer_phone;
  new.source                  := old.source;
  new.created_at              := old.created_at;

  -- A cancel on a paid booking becomes a refund_pending (money is owed back).
  if new.status = 'cancelled' and old.payment_state in ('paid', 'partially_refunded') then
    new.status := 'refund_pending';
  end if;

  -- Status may only move through the operational transitions staff are allowed to make.
  if new.status is distinct from old.status then
    if not (
      (new.status = 'completed' and old.status = 'confirmed') or
      (new.status = 'cancelled' and old.status in ('draft', 'held', 'payment_pending', 'confirmed')) or
      (new.status = 'refund_pending' and old.status = 'confirmed')
    ) then
      raise exception 'forbidden_booking_status_transition'
        using detail = format('%s -> %s', old.status, new.status);
    end if;
  end if;

  return new;
end;
$$;
