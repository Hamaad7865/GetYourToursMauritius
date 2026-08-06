-- Quote deposit + balance: a quote guest pays a DEPOSIT (default 10%, editable per quote; 100% = pay
-- in full) which confirms the booking and reserves the seat, then staff chase the balance later with
-- a second payment link. This migration is the SCHEMA half only — the sizing, the second payments
-- row, the receipt-vs-invoice split and the admin UI land in later tasks of the same plan
-- (docs/superpowers/plans/2026-08-06-quote-deposit-balance.md).
--
-- Three storage facts turn the feature on:
--
--   1. quotes.deposit_bps — the deposit as basis points (1000 = 10.00%). Editable per quote; 10000
--      means "pay in full", which is the UNCHANGED current behaviour (the whole booking total is
--      charged and confirmed exactly as today). The range check forbids 0 (a deposit that charges
--      nothing would never confirm the booking) and anything over 100%.
--
--   2. bookings.deposit_minor / bookings.balance_due_minor — the deposit taken and the amount still
--      owed. bookings.total_minor stays the FULL price throughout (it feeds VAT and operator payout);
--      balance_due_minor is the "how much is still owed" source of truth, kept OUT of the payment_state
--      roll-up so the enum (and its sticky-failed protection) is left untouched.
--
--      DEFAULT 0 IS LOAD-BEARING. Every booking that already exists is fully paid or fully unpaid in
--      the pre-deposit world; defaulting balance_due_minor to total_minor would make every one of them
--      look part-paid to every reader and sweep. A legacy booking must read "nothing owed" (0).
--
--   3. payments.purpose gains 'balance' — the balance is a SEPARATE, purpose-scoped payments row (the
--      same pattern the late-pickup add-on established for 'pickup_addon'), so the existing
--      confirm-on-paid path is untouched and a booking re-pay can never collide with it.

begin;

-- 1) quotes.deposit_bps — the per-quote deposit size, in basis points (1000 = 10.00%).
alter table quotes add column deposit_bps int not null default 1000
  check (deposit_bps between 1 and 10000);

-- 2) bookings.deposit_minor / balance_due_minor — deposit taken and amount still owed.
--    Default 0: an existing booking owes nothing (see header — this is the landmine).
alter table bookings add column deposit_minor     bigint not null default 0;
alter table bookings add column balance_due_minor bigint not null default 0;

-- 3) payments.purpose — widen to admit the balance row alongside 'booking' and 'pickup_addon'.
alter table payments drop constraint if exists payments_purpose_check;
alter table payments add constraint payments_purpose_check
  check (purpose in ('booking', 'pickup_addon', 'balance'));

commit;


-- ---------------------------------------------------------------------------------------------------
-- Task 2 — deposit sizing at conversion + charge. Re-applies api_convert_quote and create_payment (the
-- shared checkout body) verbatim apart from the deposit logic, so this migration — the LATER file — is
-- the winning definition of both. See docs/superpowers/plans/2026-08-06-quote-deposit-balance.md.
--
--   * api_convert_quote now writes deposit_minor / balance_due_minor onto the booking. total_minor and
--     operator_payout_minor stay the FULL quoted price (VAT + operator payout); create_hold still
--     reserves the WHOLE seat regardless of money, untouched.
--   * create_payment sizes the first `booking` payments row to the booking's deposit_minor (with a
--     total_minor fallback for the depositless customer path), read from the booking row, never caller
--     input. Everything downstream — the FX pin, the MUR charge, the confirm-on-paid gate — follows
--     amount_minor unchanged, so paying the deposit confirms the booking exactly as today.
-- ---------------------------------------------------------------------------------------------------

create or replace function api_convert_quote(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_prior bookings;
  v_booking bookings;
  v_reusable boolean := false;
  v_lines_minor bigint;
  v_owner uuid;
  v_deposit_minor bigint;
  v_seats record;
  v_hold booking_holds;
begin
  select * into v_quote
    from quotes
   where id = nullif(p ->> 'quoteId', '')::uuid
   for update;

  if v_quote.id is null then
    raise exception 'quote_not_found';
  end if;

  -- Convert-once, read off converted_at, and meaning "one PAYABLE booking at a time" (see above).
  if v_quote.converted_at is not null then
    -- LOCK THE MONEY BEFORE JUDGING IT. append_payment_event locks the payments row, writes paid_minor
    -- and status onto it, and only THEN rolls the projection onto bookings — so an unlocked read of
    -- either table can catch a settlement mid-flight, conclude "this booking never took a cent", mint
    -- booking B, commit, and let the settlement land on A afterwards. Taking the payments locks in the
    -- same order that function does serialises the two instead of racing them.
    --
    -- `bookings` is deliberately NOT locked here as well: api_create_payment locks bookings and then
    -- payments, so adding payments -> bookings on this side would close a deadlock cycle on the money
    -- path. It is also unnecessary — read committed gives every later statement in this function a
    -- fresh snapshot, so once the payments locks are held the reads below see post-settlement state.
    -- A booking with no payments row locks nothing, which is safe: api_create_payment refuses a dead
    -- booking ('booking_not_payable'), so no first payment can appear on one.
    perform 1 from payments where booking_id = v_quote.booking_id for update;

    -- booking_id is null here when an erasure hard-deleted the booking; the select finds nothing and
    -- v_reusable stays false, which is the section-4 invariant.
    select * into v_prior from bookings where id = v_quote.booking_id;
    v_reusable := found
      and v_prior.status in ('expired', 'cancelled', 'failed')
      and v_prior.payment_state in ('pending', 'failed')
      -- Money already HELD, including the shapes the booking-level projection above cannot see: an
      -- underpayment (append_payment_event sets 'pending' when v_paid > 0 but below amount_minor, so
      -- paid_minor is positive while payment_state is not) and a wrong-currency settlement quarantine
      -- (settlement_review_at, 20260830000000), which is stamped precisely so the projection is left
      -- alone. Both hold a capture on a booking that still reads clean.
      and not exists (
        select 1 from payments pay
         where pay.booking_id = v_prior.id
           and (pay.paid_minor > 0
                or pay.refunded_minor > 0
                or pay.status in ('paid', 'partially_refunded', 'refunded')
                or pay.settlement_review_at is not null)
      )
      -- Money that can still be TAKEN. A dead booking is not a dead checkout: run_booking_maintenance
      -- expires a booking 30 minutes after it was CREATED, while a Peach session stays completable
      -- ~30 minutes after it was MINTED (api_pending_payment_checkouts says exactly that in its own
      -- comment). A guest who converts at T0, clicks Pay at T0+26 and wanders off has an expired
      -- booking at T0+30 and a live session until roughly T0+56; re-arming in that gap leaves TWO
      -- payable sessions for one quote — the double charge api_create_payment's reuse guard refuses
      -- to create one level down ("Minting a replacement while the original is still live would leave
      -- TWO payable sessions for one booking") and the one 20260902000000 removed. It is also
      -- unreconcilable: api_pending_payment_checkouts only re-queries bookings still in
      -- 'payment_pending', so once the booking is expired a lost webhook on that capture is never
      -- swept — money taken, no ledger row, no link back to the quote.
      --
      -- 30 minutes, not api_create_payment's 25: 25 is the REUSE window, deliberately short of the
      -- session's life so a session handed back cannot die under the guest. The hazard here lasts as
      -- long as the session can be COMPLETED, so this window has to be the wider of the two.
      --
      -- The claimed-lease arm covers the ~90 seconds where a caller is out at Peach and the session
      -- id has not been recorded yet: provider_checkout_id is still null, so freshness alone sees
      -- nothing and would re-arm into the same double charge moments before the session appears.
      --
      -- The refusal is a wait, not a wall: mapDbError already reads quote_already_converted as "has
      -- already been paid for or is being paid", and the quote converts again once the session dies.
      and not exists (
        select 1 from payments pay
         where pay.booking_id = v_prior.id
           and ((pay.provider_checkout_id is not null
                 and coalesce(pay.checkout_created_at, pay.updated_at) > now() - interval '30 minutes')
                or (pay.checkout_claimed_until is not null and pay.checkout_claimed_until > now()))
      );
    if not v_reusable then
      raise exception 'quote_already_converted'
        using detail = coalesce(v_prior.status::text, 'linked booking no longer exists');
    end if;

    -- THE DEAD BOOKING'S SEATS GO BACK BEFORE THIS CONVERSION TAKES FRESH ONES.
    --
    -- Re-arming mints a SECOND booking, which takes its own holds below — so unless the first
    -- booking's holds are released here, one quote reserves two sets of seats for the rest of their
    -- 30-minute life. Nothing else does it: run_booking_maintenance releases holds only for the
    -- bookings IT expired, so a hand-cancelled booking (or one already swept while its hold ran on)
    -- keeps them. On a nearly-full departure that is the guest's own abandoned attempt selling the
    -- trip out from under them — create_hold would raise `insufficient_capacity` and the quote would
    -- read as sold out to the only person entitled to those seats.
    --
    -- Safe because of what the branch above has already established: this booking is dead
    -- (expired/cancelled/failed), never took a cent, and cannot take one.
    update booking_holds set status = 'released'
     where booking_id = v_prior.id and status = 'active';
  end if;

  -- Status: an explicit WHITELIST, the shape api_create_payment uses next door. A blacklist of one
  -- let a 'draft' (a half-built offer the owner has not sent, whose total may be mid-edit) and an
  -- 'expired' quote — a terminal state of the very enum this migration created — both convert.
  -- 'accepted' is in the list because that is what a converted quote's status already is, and the
  -- re-arm branch above has to be able to get past here.
  if v_quote.status = 'cancelled' then
    raise exception 'quote_cancelled';
  end if;
  if v_quote.status = 'expired' or v_quote.valid_until < current_date then
    raise exception 'quote_expired';
  end if;
  if v_quote.status not in ('sent', 'accepted') then
    raise exception 'quote_not_convertible' using detail = v_quote.status::text;
  end if;

  -- A zero-total quote mints a booking that can NEVER confirm: api_create_payment skips the FX pin
  -- for a zero amount, and append_payment_event carries an explicit guard whose own comment says "a
  -- zero-amount payment must never read as fully paid (0 >= 0)". The booking would sit in
  -- payment_pending until the sweep expired it. quotes.total_minor DEFAULTS to 0, so an empty or
  -- never-priced draft reaches this state by default rather than by accident.
  if coalesce(v_quote.total_minor, 0) <= 0 then
    raise exception 'quote_not_convertible' using detail = 'zero total';
  end if;

  -- THE TWO CATALOGUE LINES THIS FUNCTION WILL NOT PRICE INTO A SEAT. Both fail closed here, before
  -- anything is minted, because both are shapes whose capacity meaning cannot be read off the line.
  --
  -- 1. AN OPTION THAT IS NOT COUNTED IN PEOPLE. For a private or vehicle option one BOOKING is one
  --    unit of the pool — the pool counts trips, not heads (20260908000000), and create_booking
  --    records the real party size in booking_items.pax while writing quantity 1. A quote line for
  --    six guests would therefore reserve SIX DEPARTURES if it were held like a per-person line, and
  --    reserve one while charging for six if it were not. Neither is a guess worth making on the
  --    money path: there is no editor that can draft such a line yet, and the pay route's re-price
  --    gate refuses it one step earlier anyway (a private option has no activity_option_prices row
  --    to re-price against). The day the editor learns to quote a private charter, this is the
  --    branch that teaches the conversion the trips-vs-heads mapping — deliberately, with a test.
  --
  -- 2. AN OPTION THAT IS NOT THE OCCURRENCE'S OWN. `quote_item_shape` makes a catalogue line name
  --    both, and nothing checks they agree; a mismatch would write a booking_items row whose option
  --    contradicts its occurrence, i.e. a voucher and a day sheet naming a trip the guest is not on.
  --
  -- Both reuse `quote_not_convertible` rather than minting a token of their own: mapDbError already
  -- reads it as "This quote is not ready to pay yet — please message us", which is exactly true, and
  -- an unfinished offer is the operator's to fix.
  if exists (
    select 1
      from quote_items qi
      join activity_options o on o.id = qi.activity_option_id
      join activities a on a.id = o.activity_id
     where qi.quote_id = v_quote.id
       and qi.kind = 'catalogue'
       and (o.private_base_minor is not null
            or coalesce(a.pricing_mode::text, 'per_person') in ('vehicle', 'vehicle_custom'))
  ) then
    raise exception 'quote_not_convertible' using detail = 'private/vehicle catalogue line';
  end if;
  if exists (
    select 1
      from quote_items qi
      join session_occurrences so on so.id = qi.session_occurrence_id
     where qi.quote_id = v_quote.id
       and qi.kind = 'catalogue'
       and qi.activity_option_id is distinct from so.activity_option_id
  ) then
    raise exception 'quote_not_convertible' using detail = 'catalogue line option is not its occurrence''s';
  end if;

  -- THE CHARGE AND THE ITEMISATION MUST AGREE, or nothing is minted.
  --
  -- The amount charged is copied from quotes.total_minor while the lines are copied by the separate
  -- statement below, and nothing else ties the two together: total_minor carries no CHECK against its
  -- lines and no trigger recomputing it, and the editor writes the total in a different statement from
  -- the lines. src/lib/quotes/totals.ts states in its own header that there is no Zod layer above it
  -- yet and that its guards "ARE the only validation between a browser-supplied line and
  -- quotes.total_minor" — so this function is the last gate before a card is charged, and failing OPEN
  -- on the drift charges the guest a figure the itemisation does not support and renders a VAT
  -- invoice whose lines do not sum to the charge.
  --
  -- The sum is over ALL lines, of every kind: the custom ones are copied into booking_custom_items
  -- below and the catalogue ones take the hold path into booking_items, so every line reaches the
  -- booking and every line was priced into the total the guest agreed to.
  --
  -- It subsumes the zero-lines case too — a hand-set total with no itemisation at all would otherwise
  -- mint a booking with no lines and a booking_json carrying no items: charged for something with no
  -- record of what it was.
  select coalesce(sum(qi.subtotal_minor), 0) into v_lines_minor
    from quote_items qi
   where qi.quote_id = v_quote.id;
  if v_quote.total_minor <> v_lines_minor then
    raise exception 'quote_total_mismatch'
      using detail = format('total %s vs lines %s', v_quote.total_minor, v_lines_minor);
  end if;

  -- WHO WILL BE ABLE TO SEE THIS BOOKING. `user_id` is what the bookings RLS policy reads
  -- (`user_id = auth.uid() or is_staff()`), so a booking minted with a null one is invisible to every
  -- customer — including the guest about to pay for it, whose confirmation email links to
  -- /bookings/{ref}. quote_owner_for_email (section 6d) answers with the single CONFIRMED account
  -- holding the quoted address, or null; see its header for why that rule is exactly this narrow.
  --
  -- NULL IS A SUPPORTED ANSWER, NOT A FAILURE. Most quote guests never open an account, and nothing
  -- downstream requires an owner: api_create_quote_payment (20260911000000) exists precisely because a
  -- quote booking has none, the guest's own record stays reachable through the link token, and
  -- api_claim_quote_bookings (7c) fills the column in later if they ever do sign up.
  v_owner := quote_owner_for_email(v_quote.customer_email);

  -- DEPOSIT SIZING. The deposit is total_minor * deposit_bps / 10000 (basis points; 1000 = 10.00%),
  -- rounded to the minor unit; the balance is the exact remainder. total_minor AND
  -- operator_payout_minor stay the FULL quoted price — they feed the VAT invoice and the operator
  -- payout, and it is only the FIRST payments row (sized to this deposit in create_payment) that the
  -- guest is charged now. deposit_bps = 10000 makes the deposit the whole total and the balance zero:
  -- the UNCHANGED pay-in-full path. deposit_bps carries a `between 1 and 10000` CHECK, so the deposit
  -- is always a positive fraction of the total and balance_due_minor is never negative.
  v_deposit_minor := round(v_quote.total_minor * v_quote.deposit_bps / 10000.0);

  insert into bookings (
    user_id, customer_name, customer_email, customer_phone, status, source,
    currency, total_minor, operator_payout_minor, payment_state, locale,
    deposit_minor, balance_due_minor
  )
  values (
    v_owner, v_quote.customer_name, v_quote.customer_email, v_quote.customer_phone, 'payment_pending',
    'quote', v_quote.currency, v_quote.total_minor, v_quote.total_minor, 'pending', v_quote.locale,
    v_deposit_minor, v_quote.total_minor - v_deposit_minor
  )
  returning * into v_booking;

  -- The `kind <> 'catalogue'` filter is what keeps this statement and the hold path below from both
  -- claiming the same line: booking_custom_items carries `check (kind <> 'catalogue')`, and a
  -- catalogue line belongs in booking_items, where it can be counted against a departure.
  insert into booking_custom_items (
    booking_id, position, kind, description, starts_at, ends_at,
    rental_vehicle_slug, quantity, unit_amount_minor, subtotal_minor
  )
  select v_booking.id, qi.position, qi.kind, qi.description, qi.starts_at, qi.ends_at,
         qi.rental_vehicle_slug, qi.quantity, qi.unit_amount_minor, qi.subtotal_minor
    from quote_items qi
   where qi.quote_id = v_quote.id
     and qi.kind <> 'catalogue';

  -- ── THE CATALOGUE LINES TAKE THEIR SEATS, HERE, IN THIS TRANSACTION ─────────────────────────
  --
  -- A catalogue line names a session_occurrence, so unlike a custom line it is a place on a real
  -- departure. It is only actually reserved if it is reserved the way every other booking reserves
  -- one: create_hold — the universal gate, which api_create_hold and api_book both delegate their
  -- hold INSERT to — takes `select … for update` on the occurrence, re-reads used_capacity() under
  -- that lock and refuses an oversell; and the booking_items row is what used_capacity() counts once
  -- the booking confirms, what append_payment_event's oversell re-check reads before it confirms
  -- anything, and what puts the guest on the day sheet. Re-deriving either here would be a second,
  -- quieter definition of "a seat exists" on the money path.
  --
  -- WHY IT IS IN THIS FUNCTION AND NOT IN THE PAY ROUTE (which is where the plan first put it): a
  -- route does it in a SECOND transaction, so a hold that fails leaves a converted quote and a
  -- payable booking with no seat behind it — the guest pays for a place nobody reserved, which is
  -- the precise state the placeholder guard this replaces existed to prevent, now reached by a
  -- different road. In here, a refusal takes the booking, its custom lines and `converted_at` back
  -- with it, and the guest sees a refusal instead of a charge.
  --
  -- UNITS, NOT PEOPLE. used_capacity() sums booking_holds.quantity and booking_items.quantity, and
  -- append_payment_event re-checks this booking's own booking_items sum against the occurrence's
  -- capacity — so the hold's quantity must equal the quantities of the lines it covers, or the seat
  -- count drifts the moment the payment lands. Lines that share an occurrence are aggregated into
  -- ONE hold for exactly that reason (two 'Adult' and 'Child' lines on one boat are three seats on
  -- one trip, not two reservations).
  --
  -- The idempotency key is scoped to THIS booking, so a re-arm (a fresh booking for the same quote)
  -- takes fresh holds rather than being handed create_hold's idempotent replay of a released one.
  --
  -- WHAT IS DELIBERATELY *NOT* RE-USED FROM THE CHECKOUT: create_booking's per-booking guests-per-trip
  -- cap (20260908000000). That cap exists because a self-serve guest cannot know the day's pool is
  -- several departures — "the boat only seats so many, however big the day's pool is" — and it is
  -- enforced per BOOKING, so one quote line could never express "twenty guests, two boats" with it in
  -- the way. The operator drafting this quote chose the departure and the party size, and the POOL is
  -- still enforced by create_hold, so no other guest can be oversold; what a big party costs is two
  -- boats' worth of units out of the day, which is what it consumes. Revisit this the day quotes are
  -- drafted by anyone but staff.
  for v_seats in
    select qi.session_occurrence_id as occurrence_id, sum(qi.quantity)::int as units
      from quote_items qi
     where qi.quote_id = v_quote.id and qi.kind = 'catalogue'
     group by qi.session_occurrence_id
  loop
    begin
      v_hold := create_hold(
        v_seats.occurrence_id, v_seats.units,
        'quote:' || v_booking.id::text || ':' || v_seats.occurrence_id::text
      );
    exception when raise_exception then
      -- create_hold refuses in the CHECKOUT's vocabulary — insufficient_capacity,
      -- occurrence_not_bookable, occurrence_in_past, occurrence_too_soon — and mapDbError turns those
      -- into "Not enough availability for this selection" or the bare "Invalid booking request",
      -- neither of which tells a quote guest anything they can act on: they cannot pick another date,
      -- because the date was arranged for them. One token for all of them, carrying the real reason in
      -- DETAIL for error_logs, and mapped to a sold-out 409 that says to message us.
      raise exception 'quote_seats_unavailable'
        using detail = format('occurrence %s x%s: %s', v_seats.occurrence_id, v_seats.units, sqlerrm);
    end;

    -- ATTACH THE HOLD TO THE BOOKING. Not tidiness: append_payment_event's oversell re-check counts
    -- every active hold that is NOT this booking's own against it, so a detached hold is the guest's
    -- own reservation blocking their own confirmation and routing a good payment to refund_pending.
    -- It is also what makes the confirmation mark it 'consumed' rather than leaving it to lapse.
    update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  end loop;

  -- One row per LINE (the hold above is one row per occurrence): the tiers are what the voucher, the
  -- day sheet and the VAT invoice itemise. Prices are the quote's own — the negotiated figure the
  -- guest saw and `quote_total_mismatch` has just re-checked — never re-derived from the catalogue
  -- here; the pay route compares them against the live price list and refuses on drift before this
  -- function is ever called. `price_label` is NOT NULL on booking_items, so a line that carries no
  -- tier name falls back to its description rather than failing at the constraint.
  insert into booking_items (
    booking_id, session_occurrence_id, activity_option_id, price_label,
    quantity, unit_amount_minor, subtotal_minor
  )
  select v_booking.id, qi.session_occurrence_id, qi.activity_option_id,
         coalesce(nullif(btrim(qi.price_label), ''), nullif(btrim(qi.description), ''), 'Quoted place'),
         qi.quantity, qi.unit_amount_minor, qi.subtotal_minor
    from quote_items qi
   where qi.quote_id = v_quote.id
     and qi.kind = 'catalogue'
   order by qi.position;

  -- Overwrites booking_id on a re-arm, which releases the dead booking from the UNIQUE.
  update quotes
     set booking_id = v_booking.id,
         converted_at = now(),
         status = 'accepted',
         updated_at = now()
   where id = v_quote.id;

  return booking_json(v_booking.id);
end;
$$;
revoke execute on function api_convert_quote(jsonb) from public, anon, authenticated;
grant execute on function api_convert_quote(jsonb) to service_role;

create or replace function create_payment(p jsonb, p_enforce_caller_identity boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_payment payments;
  v_rate numeric;
  v_src text;
  v_at timestamptz;
  v_charged bigint;
  v_purpose text := coalesce(nullif(p ->> 'purpose', ''), 'booking');
  v_req booking_pickup_requests;
begin
  if v_purpose not in ('booking', 'pickup_addon') then
    raise exception 'invalid_payment_purpose' using detail = v_purpose;
  end if;

  -- FOR UPDATE: every concurrent create-payment call for one booking serialises on this row for the
  -- rest of the transaction. That closes two races at once: two callers both inserting a payments row
  -- below, and — via the checkout lease — two callers both getting a green light to mint a Peach
  -- session. Peach's nonce is unique per REQUEST (it never dedupes), so without this lease two tabs
  -- or a retry could create two independently payable sessions for the same booking.
  -- (It also makes the charge pin race-free: one caller pins, the loser re-reads the pinned row.)
  --
  -- It is also what serialises the two ENTRY POINTS against each other: a staff member opening the
  -- checkout for a quote booking through api_create_payment and the guest clicking Pay through
  -- api_create_quote_payment reach this same lock, this same payments row and this same lease.
  select * into v_booking from bookings where ref = p ->> 'bookingRef' for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_purpose = 'booking' then
    if v_booking.status in ('confirmed', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded', 'failed')
       or v_booking.payment_state in ('paid', 'partially_refunded', 'refunded') then
      raise exception 'booking_not_payable' using detail = v_booking.status::text;
    end if;
  else
    -- The add-on's own payability: an open request must exist, and the trip must not have left.
    select * into v_req from booking_pickup_requests
     where booking_id = v_booking.id and applied_at is null and payment_id is not null;
    if not found then
      raise exception 'pickup_request_not_found';
    end if;
    -- …and it must not ALREADY hold the guest's money. A request refused at settlement (the departure
    -- was called off) stays open behind a payments row that is already 'paid'. If the trip is then
    -- rescheduled onto a live date the eligibility ladder goes green again, and without this guard
    -- the booking page's "Complete payment" button minted a SECOND Peach session on that same row —
    -- charging the card twice for one supplement, invisibly: the apply trigger cannot fire again
    -- (its WHEN clause needs old.status distinct from 'paid'), so no second alert is raised either.
    if exists (
      select 1 from payments pay
       where pay.id = v_req.payment_id and pay.paid_minor >= pay.amount_minor and pay.amount_minor > 0
    ) then
      raise exception 'pickup_already_paid';
    end if;
    if not coalesce((pickup_addon_quote(v_booking.id, v_req.pickup_lat, v_req.pickup_lng) ->> 'eligible')::boolean, false) then
      raise exception 'booking_not_payable' using detail = 'pickup_addon';
    end if;
  end if;
  -- THE CALLER-IDENTITY CHECK — unchanged, and still what api_create_payment enforces. It is skipped
  -- ONLY for a caller that has already proved a stronger, non-session credential: see the header, and
  -- api_create_quote_payment, which is the only function in the schema that passes `false`.
  if p_enforce_caller_identity
     and not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())) then
    raise exception 'forbidden';
  end if;

  -- No `and status <> 'failed'`: that skipped the row a declined attempt had latched to 'failed' and
  -- minted a SECOND payments row, orphaning the checkout-reuse window and the single-flight lease
  -- (both columns on the skipped row) and leaving two independently payable Peach sessions.
  if v_purpose = 'booking' then
    select * into v_payment from payments
    where booking_id = v_booking.id and purpose = 'booking'
    order by created_at desc
    limit 1;

    if not found then
      -- Scoped to THIS booking: an unscoped key lookup let a caller echo another payment's key and
      -- receive that payment's id/amount back.
      select * into v_payment from payments
      where idempotency_key = p ->> 'idempotencyKey' and booking_id = v_booking.id and purpose = 'booking';
    end if;
  else
    -- Exactly the row the open request points at — never "the newest add-on row", which after a
    -- superseded request could be a different, abandoned one.
    select * into v_payment from payments where id = v_req.payment_id and purpose = 'pickup_addon';
  end if;

  if not found then
    if v_purpose <> 'booking' then
      -- api_request_pickup owns the add-on row (it is the only place that knows the fare). Never
      -- invent one here, or the amount would come from nowhere.
      raise exception 'pickup_request_not_found';
    end if;
    -- The first `booking` row is sized to the DEPOSIT when the booking carries one. A quote booking
    -- carries a positive deposit_minor (api_convert_quote sized it from deposit_bps), and a pay-in-full
    -- quote's is the whole total; an ordinary customer booking has none — deposit_minor DEFAULTS to 0,
    -- so nullif() falls the charge back to total_minor and the customer path is bit-for-bit what it was.
    -- Sized off the BOOKING ROW, never caller input, exactly like the FX pin below: what a card is
    -- charged is a server figure. append_payment_event then confirms the booking when THIS row is paid
    -- in full, so paying the deposit confirms it and reserves the seat with no change to that gate.
    insert into payments (booking_id, idempotency_key, amount_minor, purpose)
    values (v_booking.id, p ->> 'idempotencyKey',
            coalesce(nullif(v_booking.deposit_minor, 0), v_booking.total_minor), 'booking')
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', coalesce(nullif(v_booking.deposit_minor, 0), v_booking.total_minor));
  end if;

  -- ── Pin the charge (once per payment row) ────────────────────────────────────────────────────
  -- The EUR ledger total converted to WHOLE MUR RUPEES at the server-controlled rate. Derived here,
  -- in SQL, from fx_rates — NEVER from caller input (this function is granted to authenticated; a
  -- caller-supplied rate would let a booking owner pin their own MUR 0.05 charge). First-write-wins:
  -- every later call — every re-minted checkout session, the pay page, reconcile — reads THIS figure,
  -- so a moved FX rate between sessions can never make the charge and the expected settlement drift.
  if v_payment.charged_amount_minor is null and v_payment.amount_minor > 0 then
    select r.rate, r.source, r.fetched_at into v_rate, v_src, v_at
      from fx_rates r where r.base = 'EUR' and r.quote = 'MUR';
    -- Band-clamped on READ as well as write: an inverted or foreign payload that somehow reached the
    -- table (0.0185 would bill MUR 1.85 for a EUR 100 booking — and, because settled == charged,
    -- CONFIRM it) falls back to the floor instead of being trusted.
    if v_rate is null or v_rate < 40 or v_rate > 70 then
      v_rate := 53.00; -- cold-start floor; see the fx_rates seed comment (kept below mid on purpose)
      v_src := 'fallback';
      v_at := now();
    end if;
    -- Whole rupees: kills every sub-unit disagreement between what we send Peach and what Peach
    -- reports back. Costs at most MUR 0.50 (~EUR 0.01) per booking.
    v_charged := (round(v_payment.amount_minor * v_rate / 100.0) * 100)::bigint;
    update payments
       set charged_amount_minor = v_charged,
           charged_currency = 'MUR',
           charged_fx_rate = v_rate,
           charged_fx_source = v_src,
           charged_fx_at = v_at,
           updated_at = now()
     where id = v_payment.id and charged_amount_minor is null
     returning * into v_payment;
    if not found then
      -- Another transaction pinned first (or a legacy row already carried a charge): read the truth.
      select * into v_payment from payments where id = v_payment.id;
    end if;
  end if;

  -- Checkout lease (single-flight): exactly one caller may be out creating a Peach session at any
  -- moment. Order matters — reuse beats pending beats claim:
  --   1. a still-fresh recorded checkout        -> hand the SAME session back (reuse; no Peach call);
  --   2. someone else holds an unexpired lease  -> checkoutPending (caller retries shortly);
  --   3. otherwise                              -> stamp the lease and let THIS caller call Peach.
  -- api_record_payment_checkout clears the lease when the session id is recorded; a Peach failure
  -- releases it via api_release_checkout_claim, and the 90-second expiry is the crash backstop.
  --
  -- Freshness is measured from checkout_created_at (when the session was MINTED), never from
  -- updated_at: the reconcile sweep touches updated_at on every pass, which used to re-arm this
  -- window forever and trap the customer on a dead session. The caller still verifies liveness with
  -- the provider before actually reusing what this returns.
  if v_payment.provider_checkout_id is not null
     and coalesce(v_payment.checkout_created_at, v_payment.updated_at) > now() - interval '25 minutes' then
    return jsonb_build_object(
      'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
      'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
      'existingCheckoutId', v_payment.provider_checkout_id,
      'chargedAmountMinor', v_payment.charged_amount_minor,
      'chargedCurrency', v_payment.charged_currency,
      'chargedFxRate', v_payment.charged_fx_rate
    );
  end if;

  if v_payment.checkout_claimed_until is not null and v_payment.checkout_claimed_until > now() then
    return jsonb_build_object(
      'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
      'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
      'existingCheckoutId', null,
      'checkoutPending', true,
      'chargedAmountMinor', v_payment.charged_amount_minor,
      'chargedCurrency', v_payment.charged_currency,
      'chargedFxRate', v_payment.charged_fx_rate
    );
  end if;

  update payments set checkout_claimed_until = now() + interval '90 seconds'
  where id = v_payment.id;

  return jsonb_build_object(
    'paymentId', v_payment.id, 'amountMinor', v_payment.amount_minor,
    'bookingRef', v_booking.ref, 'customerEmail', v_booking.customer_email,
    'existingCheckoutId', null,
    'chargedAmountMinor', v_payment.charged_amount_minor,
    'chargedCurrency', v_payment.charged_currency,
    'chargedFxRate', v_payment.charged_fx_rate
  );
end;
$$;

revoke execute on function create_payment(jsonb, boolean) from public, anon, authenticated;
grant execute on function create_payment(jsonb, boolean) to service_role;

comment on function create_payment(jsonb, boolean) is
  'Shared body behind api_create_payment (identity check ON) and api_create_quote_payment (OFF). '
  'Holds the single-flight checkout lease, the reuse window and the first-write-wins FX pin, so the '
  'two entry points cannot drift into two payable sessions for one booking. Internal: service_role '
  'only — the boolean argument is the authorization decision itself.';


-- ---------------------------------------------------------------------------------------------------
-- Task 3 — append_payment_event maintains balance_due_minor.
--
-- The deposit is the first `booking` payments row SIZED to it (Task 2), so the confirm-on-paid gate is
-- UNCHANGED: a deposit-sized row reaching its own amount_minor still flips draft/held/payment_pending
-- to confirmed and consumes the hold. What this migration adds is one statement — "how much is still
-- owed", recomputed after every event as a PROJECTION over the payment rows, never latched from the
-- single row this event touched (the sticky-failed landmine, [[gytm-sticky-failed-payment-state]]):
--
--   balance_due_minor = greatest(0, total_minor - sum(paid_minor) over the rows that pay the order
--                                DOWN — purpose in ('booking','balance'))
--
-- Purpose-scoped on purpose: a 'pickup_addon' capture is its own separately-priced row (it GROWS
-- total_minor by its fee, apply_pickup_request in 20260910000000), so counting it toward the balance
-- would understate what the guest still owes on the quote. balance_due_minor stays OUT of the
-- payment_state enum, so the booking-level roll-up (and everything that reads it, incl. the
-- sticky-failed protection) is byte-for-byte what it was.
--
-- ONE MORE TIME, THE WHOLE BODY, VERBATIM. This is the most dangerous function in the repo: re-
-- declaring it from a stale copy silently reverts an earlier fix ([[gytm-migration-revert-drift]]).
-- The body below is the WINNING one — 20260910000000 (the LATER of the two prior definitions, so the
-- one a fully-migrated database actually resolves to), which is itself 20260902000000 plus (a) the
-- owner_overpayment alert and (b) the refunded-branch guard `coalesce(v_booking_state, v_state) =
-- 'refunded'` that stops a single refunded child row (e.g. a refunded pickup supplement) from stamping
-- a still-paid booking 'refunded'. BOTH are carried forward here unchanged; the oversold/called-off/
-- refund branches are re-applied verbatim. The ONLY change is the balance_due_minor statement, added
-- after the payment_state roll-up. resolved-function-bodies.test.ts pins that statement against
-- pg_proc so a future re-definition cannot drop it and keep the comment.
-- ---------------------------------------------------------------------------------------------------

create or replace function append_payment_event(
  p_payment_id uuid,
  p_type text,
  p_provider_event_id text,
  p_amount_minor bigint,
  p_occurred_at timestamptz,
  p_payload jsonb
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_paid bigint;
  v_refunded bigint;
  v_failed boolean;
  v_state payment_state;
  v_booking_state payment_state;
  v_booking_status booking_status;
  v_occ_id uuid;
  v_needed bigint;
  v_cap bigint;
  v_used_conf bigint;
  v_used_hold bigint;
  v_oversold boolean := false;
  v_called_off boolean := false;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  insert into payment_events (payment_id, type, provider_event_id, amount_minor, occurred_at, payload)
  values (
    p_payment_id, p_type, p_provider_event_id, coalesce(p_amount_minor, 0),
    coalesce(p_occurred_at, now()), coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (payment_id, provider_event_id, type) do nothing;

  select
    coalesce(sum(amount_minor) filter (where type in ('paid', 'captured')), 0),
    coalesce(sum(amount_minor) filter (where type = 'refunded'), 0),
    bool_or(type = 'failed')
  into v_paid, v_refunded, v_failed
  from payment_events
  where payment_id = p_payment_id;

  if v_paid > 0 and v_refunded >= v_paid then
    v_state := 'refunded';
  elsif v_paid > 0 and v_refunded > 0 then
    v_state := 'partially_refunded';
  -- amount_minor > 0: a zero-amount payment must never read as fully paid (0 >= 0) -- the 'failed'
  -- branch below has to win for it.
  elsif v_payment.amount_minor > 0 and v_paid >= v_payment.amount_minor then
    v_state := 'paid';
  elsif v_paid > 0 then
    v_state := 'pending'; -- underpaid: do not confirm
  elsif coalesce(v_failed, false) then
    v_state := 'failed';
  else
    v_state := 'pending';
  end if;

  update payments
  set status = v_state, paid_minor = v_paid, refunded_minor = v_refunded, updated_at = now()
  where id = p_payment_id
  returning * into v_payment;

  -- MORE money than we asked for, on one payments row. Nothing else in this system can see that: the
  -- reducer's own branches all read `>= amount_minor`, so a second capture on an already-paid row is
  -- indistinguishable from the first, and the late-pickup apply trigger cannot re-fire on it. It
  -- should be impossible — but "impossible" is what the double-charge guards keep discovering it is
  -- not, and the only honest response to money we did not ask for is to tell someone who can return it.
  if v_payment.amount_minor > 0 and v_paid > v_payment.amount_minor then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    select 'email', 'owner', 'owner_overpayment',
           jsonb_build_object(
             'ref', b.ref,
             'customerName', b.customer_name,
             'expectedEur', v_payment.amount_minor::float / 100,
             'paidEur', v_paid::float / 100,
             'purpose', v_payment.purpose
           ),
           b.id,
           'overpaid:' || v_payment.id::text
      from bookings b where b.id = v_payment.booking_id
    on conflict (idempotency_key) do nothing;
  end if;

  -- BOOKING-level projection, rolled up across every payment row of this booking -- best row wins,
  -- and 'failed' only when EVERY row failed. Written from the single touched row it was a latch: one
  -- declined attempt stamped the booking 'failed' forever (nothing else writes this column), which
  -- silently removed it from api_pending_payment_checkouts and run_booking_maintenance. Ranking
  -- rather than re-summing the ledger keeps this a pure widening: a booking with one payment row --
  -- every booking that never hit the fork -- projects exactly what it projected before.
  -- Ordered paid > partially_refunded > refunded > pending > failed: with two rows after a double
  -- charge, one refunded and one not, money is still held and 'paid' is the honest answer.
  select case min(
           case pay.status
             when 'paid' then 1
             when 'partially_refunded' then 2
             when 'refunded' then 3
             when 'pending' then 4
             when 'failed' then 5
           end
         )
         when 1 then 'paid'
         when 2 then 'partially_refunded'
         when 3 then 'refunded'
         when 5 then 'failed'
         else 'pending'
         end::payment_state
    into v_booking_state
    from payments pay
   where pay.booking_id = v_payment.booking_id;

  update bookings set payment_state = coalesce(v_booking_state, v_state), updated_at = now()
  where id = v_payment.booking_id;

  -- AMOUNT STILL OWED, maintained here as a projection over the payment ROWS — never latched from the
  -- single row this event touched (that is precisely the sticky-failed class of bug: a booking-level
  -- figure derived from one child row). total_minor stays the FULL quoted price, so "owed" is the full
  -- price minus everything that has settled AGAINST THE ORDER. Purpose-scoped to the two rows that pay
  -- the order down — the deposit ('booking') row and the balance ('balance') row — so a 'pickup_addon'
  -- capture, which is its own separately-priced row that GROWS total_minor by its fee, is never mistaken
  -- for money paying off the balance. greatest(0, …) so an overpayment or a refund event can never drive
  -- balance_due_minor negative. A legacy/customer booking with no balance owed recomputes to 0 unchanged
  -- (its single 'booking' row covers total_minor), so this is a pure widening for the quote path.
  update bookings b
     set balance_due_minor = greatest(
           0,
           b.total_minor - coalesce((
             select sum(pay.paid_minor)
               from payments pay
              where pay.booking_id = b.id
                and pay.purpose in ('booking', 'balance')
           ), 0)
         ),
         updated_at = now()
   where b.id = v_payment.booking_id;

  -- Confirmation stays driven by THIS row reaching 'paid' (v_state), never by the roll-up: a row
  -- that just captured the full amount is what licenses confirming, and reusing the roll-up here
  -- would re-run the capacity re-check on every later event of an already-paid booking.
  if v_state = 'paid' then
    select status into v_booking_status from bookings where id = v_payment.booking_id;

    if v_booking_status in ('draft', 'held', 'payment_pending') then
      -- Re-validate capacity per occurrence, excluding this booking's own items/holds.
      for v_occ_id in
        select distinct session_occurrence_id from booking_items where booking_id = v_payment.booking_id
      loop
        perform 1 from session_occurrences where id = v_occ_id for update;
        select coalesce(sum(quantity), 0) into v_needed
        from booking_items where booking_id = v_payment.booking_id and session_occurrence_id = v_occ_id;
        select capacity into v_cap from session_occurrences where id = v_occ_id;
        select coalesce(sum(bi.quantity), 0) into v_used_conf
        from booking_items bi join bookings b on b.id = bi.booking_id
        where bi.session_occurrence_id = v_occ_id
          and b.status in ('confirmed', 'completed')
          and b.id <> v_payment.booking_id;
        select coalesce(sum(h.quantity), 0) into v_used_hold
        from booking_holds h
        where h.session_occurrence_id = v_occ_id
          and h.status = 'active' and h.expires_at > now()
          and (h.booking_id is null or h.booking_id <> v_payment.booking_id);
        if v_needed > v_cap - v_used_conf - v_used_hold then
          v_oversold := true;
        end if;
      end loop;

      -- Was the departure called off while this payment was in flight?
      --
      -- Confirming here would tell the guest they are booked onto a trip that is not running. Worse,
      -- they could never be put right afterwards: api_weather_cancel_occurrence stamps only bookings
      -- that were ALREADY confirmed+paid when it ran, and it refuses to re-run on an occurrence it
      -- has already cancelled — so this booking would never receive a `disruption` stamp, and that
      -- stamp is the ONLY thing that opens the 24h bypass in api_cancel_booking and
      -- api_reschedule_booking (via booking_awaiting_choice). Charged, told "confirmed", and locked
      -- out of both the refund and the free reschedule /refunds promises.
      --
      -- Route the money back instead — the same answer this function already gives when the seats
      -- turn out to be gone (oversold) or the booking is no longer live. refund_pending frees the
      -- capacity immediately and fires enqueue_booking_notification's refund_pending branch, so the
      -- owner gets a work item and the guest is told.
      select exists (
        select 1
          from booking_items bi
          join session_occurrences so on so.id = bi.session_occurrence_id
         where bi.booking_id = v_payment.booking_id
           and so.status = 'cancelled'
      ) into v_called_off;

      if v_oversold or v_called_off then
        update bookings set status = 'refund_pending', updated_at = now() where id = v_payment.booking_id;
      else
        update bookings set status = 'confirmed', updated_at = now() where id = v_payment.booking_id;
        update booking_holds set status = 'consumed'
        where booking_id = v_payment.booking_id and status = 'active';
      end if;
    elsif v_booking_status not in ('confirmed', 'completed') then
      -- Money captured on an expired/cancelled booking: must be refunded, not confirmed.
      update bookings set status = 'refund_pending', updated_at = now() where id = v_payment.booking_id;
    end if;
  elsif v_state = 'refunded' and coalesce(v_booking_state, v_state) = 'refunded' then
    update bookings set status = 'refunded', updated_at = now()
    where id = v_payment.booking_id and status <> 'cancelled';
    update booking_holds set status = 'released'
    where booking_id = v_payment.booking_id and status = 'active';
  end if;

  return v_payment;
end;
$$;

revoke execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function append_payment_event(uuid, text, text, bigint, timestamptz, jsonb) to service_role;
