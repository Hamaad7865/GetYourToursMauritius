-- 20260928000000_custom_line_runsheet
--
-- A custom/private-tour line carries no headcount and no pickup of its own, so the operations calendar
-- can show a bespoke tour's date and price but not "collect 2 guests from <hotel>, room 214". Three
-- additive, nullable columns fix that, on every table a custom line lives in so they survive quote ->
-- booking conversion and reach the day sheet:
--   * guests       — the party size for the run sheet (custom lines only; a catalogue line has its
--                    tier quantities, a rental counts vehicles). NOT a money field: PricedLine ignores
--                    it and quote_total_mismatch never sees it.
--   * pickup_label — where to collect the tour from (the guest's hotel), independent of the optional
--                    paid transport add-on (a private tour includes its transport, so it must not be
--                    forced through a €0 "round-trip transfer" line just to record a pickup).
--   * room_or_cabin on quotes — the guest's room for the driver's hotel gate pass, copied onto the
--                    booking (bookings.room_or_cabin already exists) at conversion.
--
-- Null everywhere today, so purely additive; it changes no existing figure. Then api_convert_quote is
-- re-applied VERBATIM from its winning body (20260925000000) apart from two copies: booking.room_or_cabin
-- from the quote, and guests/pickup_label onto booking_custom_items. The total check, the owner resolve
-- (quote_owner_for_email) and the deposit sizing (round(total_minor * deposit_bps / 10000.0)) are
-- byte-identical (resolved-function-bodies.test.ts pins the latter two).
--
-- Mirror into supabase/catch-up.sql and regenerate supabase/setup.sql (`npm run setup:sql`); add
-- ('20260928000000','custom_line_runsheet') to supabase/backfill-migration-ledger.sql.

alter table quote_items
  add column if not exists guests int check (guests is null or guests > 0),
  add column if not exists pickup_label text;

alter table booking_custom_items
  add column if not exists guests int check (guests is null or guests > 0),
  add column if not exists pickup_label text;

alter table quotes
  add column if not exists room_or_cabin text;

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
  -- The sum is over ALL lines, of every kind, AND their transport add-ons: the line price
  -- (subtotal_minor) plus its optional round-trip transfer (transport_fare_minor) — the same
  -- Σ subtotal + Σ transport the browser's quoteTotalMinor summed into quotes.total_minor. Omitting
  -- the fares would refuse every quote that attaches a transfer ("total 61600 vs lines 52000").
  --
  -- It subsumes the zero-lines case too — a hand-set total with no itemisation at all would otherwise
  -- mint a booking with no lines and a booking_json carrying no items: charged for something with no
  -- record of what it was.
  select coalesce(sum(qi.subtotal_minor), 0) + coalesce(sum(qi.transport_fare_minor), 0)
    into v_lines_minor
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
  -- rounded to the minor unit. total_minor AND operator_payout_minor stay the FULL quoted price — they
  -- feed the VAT invoice and the operator payout, and it is only the FIRST payments row (sized to this
  -- deposit in create_payment) that the guest is charged now. deposit_bps = 10000 makes the deposit the
  -- whole total — the UNCHANGED pay-in-full path. deposit_bps carries a `between 1 and 10000` CHECK, so
  -- the deposit is always a positive fraction of the total.
  v_deposit_minor := round(v_quote.total_minor * v_quote.deposit_bps / 10000.0);

  -- balance_due_minor is INITIALISED to the full total: nothing is settled at conversion, so the
  -- "amount still owed" is the whole order, exactly as append_payment_event's projection would compute
  -- it (total_minor - sum of settled money, which is 0 here). It is NOT total - deposit — that would
  -- read as if the deposit were already paid the moment the booking is minted, before the guest has
  -- been charged a cent, and would disagree with the projection that recomputes this column downward
  -- as the deposit and then the balance settle (→ total - deposit → 0). The deposit is a CHARGE size
  -- (deposit_minor / the first payments row), not a payment; only settling it reduces what is owed.
  --
  -- room_or_cabin rides across from the quote (this migration): the guest's room for the driver's
  -- hotel gate pass. Null on every quote drafted before this column existed, so additive.
  insert into bookings (
    user_id, customer_name, customer_email, customer_phone, status, source,
    currency, total_minor, operator_payout_minor, payment_state, locale,
    deposit_minor, balance_due_minor, room_or_cabin
  )
  values (
    v_owner, v_quote.customer_name, v_quote.customer_email, v_quote.customer_phone, 'payment_pending',
    'quote', v_quote.currency, v_quote.total_minor, v_quote.total_minor, 'pending', v_quote.locale,
    v_deposit_minor, v_quote.total_minor, v_quote.room_or_cabin
  )
  returning * into v_booking;

  -- The `kind <> 'catalogue'` filter is what keeps this statement and the hold path below from both
  -- claiming the same line: booking_custom_items carries `check (kind <> 'catalogue')`, and a
  -- catalogue line belongs in booking_items, where it can be counted against a departure. The three
  -- transport_* columns ride across so a custom line's attached transfer reaches the day sheet + receipt;
  -- guests + pickup_label ride across (this migration) so a bespoke tour's headcount and pickup hotel
  -- reach the operations day sheet.
  insert into booking_custom_items (
    booking_id, position, kind, description, starts_at, ends_at,
    rental_vehicle_slug, quantity, unit_amount_minor, subtotal_minor,
    transport_pickup_label, transport_dropoff_label, transport_fare_minor,
    guests, pickup_label
  )
  select v_booking.id, qi.position, qi.kind, qi.description, qi.starts_at, qi.ends_at,
         qi.rental_vehicle_slug, qi.quantity, qi.unit_amount_minor, qi.subtotal_minor,
         qi.transport_pickup_label, qi.transport_dropoff_label, qi.transport_fare_minor,
         qi.guests, qi.pickup_label
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
  -- tier name falls back to its description rather than failing at the constraint. The transport_*
  -- columns ride across so a tour's attached transfer reaches the day sheet + receipt.
  insert into booking_items (
    booking_id, session_occurrence_id, activity_option_id, price_label,
    quantity, unit_amount_minor, subtotal_minor,
    transport_pickup_label, transport_dropoff_label, transport_fare_minor
  )
  select v_booking.id, qi.session_occurrence_id, qi.activity_option_id,
         coalesce(nullif(btrim(qi.price_label), ''), nullif(btrim(qi.description), ''), 'Quoted place'),
         qi.quantity, qi.unit_amount_minor, qi.subtotal_minor,
         qi.transport_pickup_label, qi.transport_dropoff_label, qi.transport_fare_minor
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
