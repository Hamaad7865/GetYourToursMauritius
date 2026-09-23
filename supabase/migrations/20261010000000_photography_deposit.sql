-- 20261010000000_photography_deposit
--
-- Photography is paid in two halves: 50% to book, the rest when the photos are delivered.
--
-- HOW, WITHOUT TOUCHING A MONEY-PATH FUNCTION. The deposit machinery already exists (quotes,
-- 20260912000000): `create_payment` sizes the first `booking` payment to `bookings.deposit_minor`
-- whenever it is non-zero (`coalesce(nullif(deposit_minor, 0), total_minor)`), paying it confirms the
-- booking and reserves the slot with no change to the confirm-on-paid gate, `append_payment_event`
-- projects `balance_due_minor = total − settled`, the guest gets a deposit RECEIPT on confirm and the
-- full VAT invoice when the balance clears, the balance is a separate `purpose = 'balance'` payment the
-- booking's owner may open (create_payment's identity check: owner or staff), and `api_mark_refunded`
-- keeps a genuine partial deposit on cancellation (owner decision, 20260916000000 — the photography
-- deposit is non-refundable under the same rule).
--
-- So the only thing missing for a catalogue booking is SETTING `deposit_minor`. That is all this file
-- does: a trigger on `booking_items` that, for a booking on a Photography-category activity, sets
-- `deposit_minor` to half the total (rounded UP to the cent, so the deposit is never the smaller half).
-- No redefinition of api_book / create_booking / create_payment / append_payment_event.
--
-- WHY A DEFERRED CONSTRAINT TRIGGER. api_book inserts the items and only then folds supplements and
-- transport into `total_minor`, in the same transaction. A DEFERRABLE INITIALLY DEFERRED trigger runs at
-- COMMIT, when the total is final. (Consequence: api_book's own returned DTO still shows
-- depositEur 0 — the checkout re-reads the booking after commit for its display.)
--
-- WHEN IT DOES NOTHING. A booking that already carries a deposit (a quote: api_convert_quote sizes its
-- own, and a pay-in-full quote's equals the total), one that has left the pre-payment states, one that
-- has already taken money, or one whose line is not a photography package. The category match mirrors
-- src/lib/catalogue/photography.ts (PHOTOGRAPHY_CATEGORY, exact after trimming).
--
-- SECURITY DEFINER so its UPDATE passes enforce_booking_admin_update however the insert was made
-- (current_user is the owner); locked to service_role — trigger execution never checks the caller's
-- EXECUTE, so the grant buys nothing and removing it costs nothing (definer-grants-lockdown pattern).
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

create or replace function set_photography_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
begin
  if not exists (
    select 1
      from activity_options o
      join activities a on a.id = o.activity_id
     where o.id = new.activity_option_id
       and btrim(a.category) = 'Photography'
  ) then
    return null;
  end if;

  select * into v_booking from bookings where id = new.booking_id for update;
  if not found then
    return null;
  end if;
  if coalesce(v_booking.deposit_minor, 0) <> 0
     or v_booking.status not in ('draft', 'held', 'payment_pending')
     or v_booking.payment_state <> 'pending'
     or coalesce(v_booking.total_minor, 0) < 2
     or exists (select 1 from payments pay where pay.booking_id = v_booking.id and pay.paid_minor > 0)
  then
    return null;
  end if;

  -- Half, rounded UP to the cent: (total + 1) / 2 in integer minor units. Mirrored for DISPLAY ONLY by
  -- photographyDepositMinor() in src/lib/catalogue/photography.ts — this is the figure that is charged.
  update bookings
     set deposit_minor = (v_booking.total_minor + 1) / 2
   where id = v_booking.id;
  return null;
end;
$$;

revoke all on function set_photography_deposit() from public, anon, authenticated;
grant execute on function set_photography_deposit() to service_role;

drop trigger if exists booking_items_photography_deposit on booking_items;
create constraint trigger booking_items_photography_deposit
  after insert on booking_items
  deferrable initially deferred
  for each row execute function set_photography_deposit();
