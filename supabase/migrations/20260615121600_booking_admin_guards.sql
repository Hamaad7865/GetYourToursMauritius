-- Admin-booking write guards (from the admin Bookings adversarial review).
--
-- The admin panel lets staff manage bookings DIRECTLY via PostgREST (the browser
-- client), gated only by the `*_staff` RLS policies. Those policies are column-agnostic
-- `for all`, so without these guards a signed-in staff/admin could hand-craft a PATCH and
-- (a) forge bookings.payment_state = 'paid' / status = 'confirmed', or (b) rewrite financial
-- and identity columns (total_minor, payout, customer_email, ref, …), or (c) fabricate a
-- paid `payments` row — all bypassing the invariant that payment confirmation comes ONLY
-- from the verified webhook -> append_payment_event ledger path.
--
-- We enforce the invariant at the database (the UI is not a security boundary), mirroring
-- the existing enforce_profile_role pattern: the SECURITY DEFINER RPCs (create_booking,
-- append_payment_event, api_create_payment) run as the table owner and service_role runs as
-- itself, so `current_user not in ('anon','authenticated')` lets the legitimate flow through
-- untouched while a browser session is constrained.

-- ---------------------------------------------------------------------------
-- bookings: from a browser session, only `notes` and the operational status
-- transitions (-> completed / -> cancelled) may change. Everything financial,
-- identity- or payment-related is pinned to its previous value.
-- ---------------------------------------------------------------------------
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

  -- Status may only move through the operational transitions staff are allowed to make.
  if new.status is distinct from old.status then
    if not (
      (new.status = 'completed' and old.status = 'confirmed') or
      (new.status = 'cancelled' and old.status in ('draft', 'held', 'payment_pending', 'confirmed'))
    ) then
      raise exception 'forbidden_booking_status_transition'
        using detail = format('%s -> %s', old.status, new.status);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_admin_update_guard on bookings;
create trigger bookings_admin_update_guard
  before update on bookings
  for each row execute function enforce_booking_admin_update();

-- ---------------------------------------------------------------------------
-- payments + booking_items: never written directly from a browser session. All
-- legitimate writes go through SECURITY DEFINER RPCs (owner) or service_role. We
-- block INSERT/UPDATE only (not DELETE) so booking-delete FK cascades still work.
-- ---------------------------------------------------------------------------
create or replace function forbid_public_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'forbidden_direct_write' using detail = tg_table_name;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_no_public_write on payments;
create trigger payments_no_public_write
  before insert or update on payments
  for each row execute function forbid_public_write();

drop trigger if exists booking_items_no_public_write on booking_items;
create trigger booking_items_no_public_write
  before insert or update on booking_items
  for each row execute function forbid_public_write();
