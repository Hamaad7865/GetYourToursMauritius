-- Per-date payment schedule ("pay before each activity").
--
-- A quote can be sent in payment_mode = 'per_date' instead of 'deposit'. On conversion, the booking's
-- balance is split into a SCHEDULE of installments — one per activity DATE — each due before that day,
-- each with its own durable pay-link and an auto-reminder emailed a few days before. Nothing about the
-- ledger changes: installments ride on the existing `purpose='balance'` payments, so
-- append_payment_event's balance_due_minor projection (total − settled) is UNTOUCHED. An installment is
-- "covered" the moment cumulative settlement reaches its running total — a pure waterfall over the
-- balance already tracked. Installment 0 IS the deposit (the payment that secures the whole trip's
-- seats, exactly like today's deposit); 1..N are the dated balance links.
--
-- This file is the SCHEMA + the three redefined money-path functions (api_convert_quote, create_payment,
-- booking_json — each reproduced from its winning body with an ADDITIVE branch) + the reminder enqueuer.

-- ── Schema ──────────────────────────────────────────────────────────────────────────────────────

-- How a quote is to be paid. 'deposit' (default) = the existing deposit + one balance. 'per_date' =
-- a schedule of one installment per activity date, built by api_convert_quote from the line dates.
alter table quotes
  add column if not exists payment_mode text not null default 'deposit'
    check (payment_mode in ('deposit', 'per_date'));

-- Which installment a payment row belongs to (0 = the deposit row, 1..N = the dated balance rows).
-- NULL on every ordinary booking/balance/pickup payment, so the single-flight lease and the balance
-- projection are unchanged for them; it only scopes the per-installment checkout lease in create_payment.
alter table payments
  add column if not exists installment_seq int;

-- One row per scheduled payment. Amounts are the negotiated quote figures (Σ line subtotal + transport
-- for that date); `due_on` is the activity's Mauritius-local date (pay by that day, reminder a few days
-- before). The amounts are a projection of the booking's lines snapshot at conversion — a schedule NEVER
-- overrides what append_payment_event says is owed; it only groups it into dated buckets. The durable
-- pay-link needs no column here: its token is a deterministic HMAC(secret, booking_id:seq) recomputed at
-- send/resolve time (src/lib/quotes/installment-token.ts), so no raw bearer token is ever persisted —
-- the same rule the balance link follows (nothing raw in notification_outbox).
create table if not exists booking_installments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  seq int not null,
  due_on date not null,
  label text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  created_at timestamptz not null default now(),
  unique (booking_id, seq)
);

create index if not exists booking_installments_booking_idx on booking_installments (booking_id);
create index if not exists booking_installments_due_idx on booking_installments (due_on);

-- New table needs its OWN grants (the blanket grant-on-all was a one-time backfill). Anon is granted
-- nothing: the durable-link path reads through SECURITY DEFINER functions (booking_json / the resolver),
-- which bypass RLS; only the owner's account page and staff read the table directly.
grant select on booking_installments to authenticated;
grant all on booking_installments to service_role;

alter table booking_installments enable row level security;

drop policy if exists booking_installments_owner_select on booking_installments;
create policy booking_installments_owner_select on booking_installments
  for select using (
    exists (
      select 1 from bookings b
      where b.id = booking_installments.booking_id
        and (b.user_id = auth.uid() or is_staff())
    )
  );

drop policy if exists booking_installments_staff_all on booking_installments;
create policy booking_installments_staff_all on booking_installments
  for all using (is_staff()) with check (is_staff());

-- ── api_convert_quote — winning body from 20260928000000, + a per_date schedule branch ────────
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
  v_per_date boolean := false;
  v_min_date date;
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

  -- PER-DATE SCHEDULE. When the quote is sent payment_mode='per_date', the balance is split into one
  -- installment per activity DATE (Mauritius-local; a null-dated line folds into the earliest date). The
  -- earliest PAYABLE date is installment 0 and IS the deposit — the payment that secures every seat,
  -- exactly like the % deposit above — so v_deposit_minor is overridden to that date's amount here, and
  -- the rest become dated balance links (built below, after the lines are copied). Falls back to the %
  -- deposit when the quote has no dated lines at all (nothing to schedule). This ONLY resizes the deposit
  -- CHARGE; the total, the balance projection and every downstream reader are untouched.
  --
  -- ZERO-AMOUNT DATES ARE EXCLUDED. A date whose lines sum to 0 (a complimentary activity) is not an
  -- installment — there is nothing to collect for it, and its seats are secured by the deposit like any
  -- other. Sizing the deposit to a zero earliest date would set deposit_minor = 0, which create_payment
  -- reads as the "no deposit" sentinel (coalesce(nullif(deposit_minor,0), total_minor)) and would then
  -- charge the WHOLE total at the deposit step — the guest shown "Pay 0.00" but billed everything. So the
  -- deposit is the first date with a POSITIVE amount, and the schedule below skips zero dates to match.
  v_min_date := (
    select min((qi.starts_at at time zone 'Indian/Mauritius')::date)
      from quote_items qi
     where qi.quote_id = v_quote.id and qi.starts_at is not null
  );
  v_per_date := (v_quote.payment_mode = 'per_date' and v_min_date is not null);
  if v_per_date then
    select g.amount_minor
      into v_deposit_minor
      from (
        select coalesce((qi.starts_at at time zone 'Indian/Mauritius')::date, v_min_date) as due_on,
               coalesce(sum(qi.subtotal_minor), 0) + coalesce(sum(qi.transport_fare_minor), 0) as amount_minor
          from quote_items qi
         where qi.quote_id = v_quote.id
         group by 1
        having coalesce(sum(qi.subtotal_minor), 0) + coalesce(sum(qi.transport_fare_minor), 0) > 0
         order by due_on
         limit 1
      ) g;
    -- Defensive: total_minor > 0 guarantees at least one positive date, so this cannot be null in
    -- practice. If it ever were, fall back to the % deposit rather than mint a zero-deposit booking.
    if v_deposit_minor is null or v_deposit_minor <= 0 then
      v_per_date := false;
      v_deposit_minor := round(v_quote.total_minor * v_quote.deposit_bps / 10000.0);
    end if;
  end if;

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

  -- THE PER-DATE SCHEDULE ROWS. One installment per activity date (Mauritius-local; null-dated lines fold
  -- into the earliest). seq 0 = the earliest date = the deposit just sized above; 1..N = the later dates,
  -- each a dated balance link. Amounts are the SAME Σ subtotal + Σ transport the quote total was just
  -- re-checked against (quote_total_mismatch), grouped by date — a projection over the balance, never a
  -- second source of truth for what is owed. On a re-arm this runs against the FRESH booking id.
  if v_per_date then
    insert into booking_installments (booking_id, seq, due_on, label, amount_minor)
    select v_booking.id,
           (row_number() over (order by g.due_on) - 1)::int,
           g.due_on,
           to_char(g.due_on, 'FMDD Mon YYYY'),
           g.amount_minor
      from (
        select coalesce((qi.starts_at at time zone 'Indian/Mauritius')::date, v_min_date) as due_on,
               coalesce(sum(qi.subtotal_minor), 0) + coalesce(sum(qi.transport_fare_minor), 0) as amount_minor
          from quote_items qi
         where qi.quote_id = v_quote.id
         group by 1
         -- Skip zero-amount dates: a complimentary date is not an installment (nothing to collect), and
         -- keeping it would make seq 0 a €0 row that disagrees with the positive-first deposit above.
        having coalesce(sum(qi.subtotal_minor), 0) + coalesce(sum(qi.transport_fare_minor), 0) > 0
      ) g;
  end if;

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

-- ── create_payment — winning body from 20260912000000, + installment sizing in the balance branch
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
  -- The installment a 'balance' link names (null = the plain whole-balance link, unchanged). Its charge
  -- brings settlement up to that installment's running total; scopes the checkout lease so each dated
  -- link is its own single-flight session, not a fork of the previous installment's.
  v_installment_seq int := nullif(p ->> 'installmentSeq', '')::int;
  v_charge bigint;
begin
  if v_purpose not in ('booking', 'pickup_addon', 'balance') then
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
  elsif v_purpose = 'balance' then
    -- THE BALANCE'S OWN PAYABILITY. The deposit has already CONFIRMED the booking, so a 'booking' row
    -- here would trip the guard above (booking_not_payable) — which is exactly why the balance is a
    -- separate purpose, the same reason the pickup add-on is. What is left to collect is the booking's
    -- balance_due_minor, the projection append_payment_event maintains (add-on-immune, the true amount
    -- still owed). Payable only on a confirmed booking that still owes something; a fully-paid booking
    -- (balance_due_minor = 0) has nothing to charge, so it is refused with a readable code of its own —
    -- distinct from booking_not_payable, which the balance row could never itself provoke.
    if v_booking.status <> 'confirmed' then
      raise exception 'booking_not_payable' using detail = 'balance:' || v_booking.status::text;
    end if;
    if coalesce(v_booking.balance_due_minor, 0) <= 0 then
      raise exception 'balance_already_paid';
    end if;
    -- A DATED INSTALLMENT LINK. It charges the amount that brings this booking's settlement up to the
    -- installment's RUNNING total (Σ amounts of it and every earlier installment) — so paying a later
    -- date also clears any earlier unpaid one, which is correct because activities are chronological and
    -- an earlier date is already overdue by then. settled = total − balance_due (the projection). Nothing
    -- to charge means it, and everything before it, is already covered. All server-derived from the
    -- booking row + the schedule, never caller input — exactly like the deposit and the FX pin. The plain
    -- balance link (no installmentSeq) skips all of this and pays the whole balance, unchanged.
    if v_installment_seq is not null then
      if not exists (
        select 1 from booking_installments bi
         where bi.booking_id = v_booking.id and bi.seq = v_installment_seq
      ) then
        raise exception 'installment_not_found' using detail = v_installment_seq::text;
      end if;
      v_charge := greatest(0, least(
        v_booking.balance_due_minor,
        (select coalesce(sum(bi.amount_minor), 0)
           from booking_installments bi
          where bi.booking_id = v_booking.id and bi.seq <= v_installment_seq)
          - (v_booking.total_minor - v_booking.balance_due_minor)
      ));
      if v_charge <= 0 then
        raise exception 'installment_already_paid' using detail = v_installment_seq::text;
      end if;
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
  elsif v_purpose = 'balance' then
    -- The newest STILL-OPEN 'balance' row for this booking — never a 'booking' row (that is the deposit,
    -- a distinct purpose). Under the booking-row FOR UPDATE above this is the single-open-session guard,
    -- and it is scoped to the BOOKING, NOT to installment_seq: a booking has at most ONE payable balance
    -- session at a time, whichever installment (or the plain whole-balance link) opened it. This is
    -- load-bearing because each installment charge is CUMULATIVE (seq k collects the running total up to
    -- it, minus what is settled) — so two installment links, or an installment link and the plain balance
    -- link, size to OVERLAPPING amounts. If each minted its own live Peach session (the per-seq scoping
    -- this replaces), completing both would settle the overlap twice and overcharge the guest. One open
    -- session per booking makes that unrepresentable: the second open reuses the first's row + checkout
    -- lease, and only once it settles (and balance_due drops) does the next open mint a fresh, correctly
    -- re-sized row.
    --
    -- "Still open" = paid_minor < amount_minor, so a DECLINED or PENDING row (paid_minor 0) is reused
    -- rather than orphaned by a second row — the original plain-balance behaviour, which for the plain
    -- link the balance_already_paid guard above already made equivalent (a fully-paid plain balance
    -- leaves balance_due = 0 and never reaches here). An installment booking DOES reach here with a
    -- fully-paid earlier row while balance_due is still > 0, and the filter is what lets seq k+1 mint its
    -- own session instead of re-minting on the settled seq k row. No `and status <> 'failed'`, exactly as
    -- the deposit path.
    select * into v_payment from payments
    where booking_id = v_booking.id and purpose = 'balance'
      and coalesce(paid_minor, 0) < amount_minor
    order by created_at desc
    limit 1;

    if not found then
      select * into v_payment from payments
      where idempotency_key = p ->> 'idempotencyKey' and booking_id = v_booking.id and purpose = 'balance';
    end if;
  else
    -- Exactly the row the open request points at — never "the newest add-on row", which after a
    -- superseded request could be a different, abandoned one.
    select * into v_payment from payments where id = v_req.payment_id and purpose = 'pickup_addon';
  end if;

  if not found then
    if v_purpose = 'pickup_addon' then
      -- api_request_pickup owns the add-on row (it is the only place that knows the fare). Never
      -- invent one here, or the amount would come from nowhere.
      raise exception 'pickup_request_not_found';
    elsif v_purpose = 'balance' then
      -- Mint the balance row. Its amount is the booking's CURRENT balance_due_minor — the SERVER's figure
      -- for what is still owed, read off the booking row (never caller input, exactly like the deposit
      -- and the FX pin) and snapshotted onto this row, so charging it drives balance_due_minor to 0. The
      -- balance-payability branch above has already proved it is > 0. From here everything is per-payment-
      -- row: this row takes its own FX pin, its own checkout lease and its own provider_checkout_id.
      -- Sized to the named installment's charge (v_charge, computed + proved > 0 above) when this is a
      -- dated link, else the WHOLE balance — the unchanged plain-balance path. installment_seq is RECORDED
      -- (which installment first opened this session), not used to scope the lease: the reuse lookup above
      -- is booking-wide, so this is the booking's one open balance session until it settles.
      insert into payments (booking_id, idempotency_key, amount_minor, purpose, installment_seq)
      values (v_booking.id, p ->> 'idempotencyKey',
              coalesce(v_charge, v_booking.balance_due_minor), 'balance', v_installment_seq)
      returning * into v_payment;
      insert into payment_events (payment_id, type, amount_minor)
      values (v_payment.id, 'intent', coalesce(v_charge, v_booking.balance_due_minor));
    else
      -- The first `booking` row is sized to the DEPOSIT when the booking carries one. A quote booking
      -- carries a positive deposit_minor (api_convert_quote sized it from deposit_bps), and a pay-in-full
      -- quote's is the whole total; an ordinary customer booking has none — deposit_minor DEFAULTS to 0,
      -- so nullif() falls the charge back to total_minor and the customer path is bit-for-bit what it was.
      -- Sized off the BOOKING ROW, never caller input, exactly like the FX pin below: what a card is
      -- charged is a server figure. append_payment_event then confirms the booking when THIS row is paid
      -- in full, so paying the deposit confirms it and reserves the seat with no change to that gate.
      -- installment_seq: 0 on a scheduled booking (the deposit IS installment 0), null otherwise — so the
      -- schedule's first row is settled by this payment, and an ordinary booking is bit-for-bit unchanged.
      -- The deposit SIZING (the pinned coalesce) is untouched.
      insert into payments (booking_id, idempotency_key, amount_minor, purpose, installment_seq)
      values (v_booking.id, p ->> 'idempotencyKey',
              coalesce(nullif(v_booking.deposit_minor, 0), v_booking.total_minor), 'booking',
              (select min(bi.seq) from booking_installments bi where bi.booking_id = v_booking.id))
      returning * into v_payment;
      insert into payment_events (payment_id, type, amount_minor)
      values (v_payment.id, 'intent', coalesce(nullif(v_booking.deposit_minor, 0), v_booking.total_minor));
    end if;
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

-- ── booking_json — winning body from 20260917000000, + an installments[] array ────────────────
create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'pickupPending', b.pickup_pending,
    'pickupHotelSlug', b.pickup_hotel_slug,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'supplements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', bs.name, 'qty', bs.qty,
        'unitEur', bs.unit_minor::float / 100, 'totalEur', bs.total_minor::float / 100
      ) order by bs.position, bs.name)
      from booking_supplements bs where bs.booking_id = b.id
    ), '[]'::jsonb),
    'pendingPickup', (
      select jsonb_build_object(
        'pickupLocation', r.pickup_location,
        'dropoffLocation', r.dropoff_location,
        'feeEur', r.fee_minor::float / 100,
        'paymentId', r.payment_id,
        'createdAt', r.created_at
      )
      from booking_pickup_requests r
      where r.booking_id = b.id and r.applied_at is null and r.fee_minor > 0
      order by r.created_at desc
      limit 1
    ),
    'pickupRegion', b.pickup_region,
    'tripType', b.trip_type,
    'tripDirection', b.trip_direction,
    'flightNumber', b.flight_number,
    'arrivalTime', b.arrival_time,
    'returnDate', b.return_date,
    'returnTime', b.return_time,
    'departureFlightNumber', b.departure_flight_number,
    'roomOrCabin', b.room_or_cabin,
    'luggageDetails', b.luggage_details,
    'childSeatAge', b.child_seat_age,
    'travellerGender', b.traveller_gender,
    'travellerCompany', b.traveller_company,
    'travellerCountry', b.traveller_country,
    'specialNotes', b.special_notes,
    'disruption', b.disruption,
    'partySize', coalesce((
      select sum(coalesce(bi.pax, bi.quantity))
        from booking_items bi where bi.booking_id = b.id
    ), 0),
    -- The BOOKING-UNIT count, the unit seatsLeft is denominated in. For a per-person option it equals
    -- partySize; for a vehicle/private one it is 1 (one van / one trip, any group size). The date
    -- picker must filter on THIS, not partySize, or a 6-guest transfer is offered nothing.
    'unitsNeeded', coalesce((
      select sum(bi.quantity)
        from booking_items bi where bi.booking_id = b.id
    ), 0),
    'activityOptionId', (
      select bi.activity_option_id
        from booking_items bi where bi.booking_id = b.id order by bi.id limit 1
    ),
    'activitySlug', (
      select a.slug
        from booking_items bi
        join activity_options ao on ao.id = bi.activity_option_id
        join activities a on a.id = ao.activity_id
       where bi.booking_id = b.id
       order by bi.id limit 1
    ),
    'cancellable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and (
        booking_awaiting_choice(b.disruption)
        or coalesce((
          select min(so.starts_at)
            from booking_items bi
            join session_occurrences so on so.id = bi.session_occurrence_id
           where bi.booking_id = b.id
        ), 'epoch'::timestamptz) > now() + interval '24 hours'
      )
    ),
    'reschedulable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and (
        booking_awaiting_choice(b.disruption)
        or coalesce((
          select min(so.starts_at)
            from booking_items bi
            join session_occurrences so on so.id = bi.session_occurrence_id
           where bi.booking_id = b.id
        ), 'epoch'::timestamptz) > now() + interval '24 hours'
      )
    ),
    'serviceDate', (
      select min(so.starts_at)
        from booking_items bi
        join session_occurrences so on so.id = bi.session_occurrence_id
       where bi.booking_id = b.id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb),
    -- ── A QUOTE BOOKING'S OWN LINES ─────────────────────────────────────────────────────────────
    -- api_convert_quote writes every non-occurrence line (custom, rental, transport) to
    -- booking_custom_items, so a booking minted from a quote has NO booking_items at all and the
    -- 'items' array above is empty. The guest's own page then showed a bare total with nothing
    -- explaining it. Ordered by `position` — the order the guest read the offer in.
    'customItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', ci.description,
        'quantity', ci.quantity,
        'unitAmountEur', ci.unit_amount_minor::float / 100,
        'subtotalEur', ci.subtotal_minor::float / 100,
        'startsAt', ci.starts_at
      ) order by ci.position)
      from booking_custom_items ci where ci.booking_id = b.id
    ), '[]'::jsonb),
    -- What was taken up front and what is still owed. payment_state reads 'paid' the moment the
    -- DEPOSIT clears, so without these the page calls a 10%-paid booking settled.
    'depositEur', b.deposit_minor::float / 100,
    'balanceDueEur', b.balance_due_minor::float / 100,
    -- The earliest thing the guest is booked on, across BOTH line tables — the balance falls due 24h
    -- before it. `serviceDate` above sees only session occurrences and is left alone (receipts read
    -- it); this is the quote-aware one. Null when no line carries a date, and the page then shows no
    -- deadline rather than inventing one.
    'firstActivityAt', least(
      (select min(so.starts_at) from booking_items bi
         join session_occurrences so on so.id = bi.session_occurrence_id
        where bi.booking_id = b.id),
      (select min(ci.starts_at) from booking_custom_items ci where ci.booking_id = b.id)
    ),
    -- The per-date payment schedule (empty on an ordinary deposit booking). `coveredEur` is a pure
    -- WATERFALL over the balance append_payment_event already maintains: settlement (total − balanceDue)
    -- fills the installments in seq order, so an installment is fully covered when settlement has reached
    -- its running total. No second ledger — just a dated view of the one balance.
    'installments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seq', bi.seq,
        'dueOn', bi.due_on,
        'label', bi.label,
        'amountEur', bi.amount_minor::float / 100,
        'coveredEur', greatest(0, least(
          bi.amount_minor,
          (b.total_minor - b.balance_due_minor)
            - coalesce((select sum(bi2.amount_minor) from booking_installments bi2
                         where bi2.booking_id = b.id and bi2.seq < bi.seq), 0)
        ))::float / 100
      ) order by bi.seq)
      from booking_installments bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- ── api_enqueue_installment_reminders — dated chase (guest) + overdue alert (owner) ───────────────
-- Modeled on api_enqueue_pickup_reminders: a service-role enqueuer the maintenance cron calls each tick.
-- For every UNCOVERED dated installment (seq > 0; seq 0 is the deposit, settled at confirmation): if it
-- is within `leadDays` (default 3) of its date, chase the guest; if its date has passed, alert the owner
-- that it is overdue (owner's call whether to run the activity — nothing auto-cancels). "Covered" and the
-- amount-still-due are the same waterfall over balance_due the pay-link uses, so a reminder never asks for
-- money already settled. Idempotency key is per installment, so each is chased at most once per bucket.
create or replace function api_enqueue_installment_reminders(p jsonb default '{}'::jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_lead int := coalesce((p ->> 'leadDays')::int, 3);
  v_c record;
  v_due_minor bigint;
  -- Today in MAURITIUS local time, not the session's UTC current_date. due_on is a Mauritius-local date
  -- (grouped `at time zone 'Indian/Mauritius'`), so comparing it to a UTC "today" would slide the chase
  -- and overdue windows by the +4h offset at every day boundary — chasing a few hours early, flagging
  -- overdue a few hours late. Mauritius keeps a fixed UTC+4 offset, so this is exact year-round.
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_c in (
    select b.id as booking_id, b.ref, q.ref as quote_ref,
           b.customer_email, b.customer_name, b.locale::text as locale,
           b.total_minor, b.balance_due_minor,
           bi.seq, bi.due_on, bi.label, bi.amount_minor,
           (select coalesce(sum(x.amount_minor), 0) from booking_installments x
             where x.booking_id = b.id and x.seq <= bi.seq) as cumulative_minor
      from booking_installments bi
      join bookings b on b.id = bi.booking_id
      -- The durable link + its HMAC token are keyed on the QUOTE ref + the booking id, so carry both.
      left join quotes q on q.booking_id = b.id
     where b.status = 'confirmed'
       and b.customer_email is not null
       and q.ref is not null
       and bi.seq > 0
       and coalesce(b.balance_due_minor, 0) > 0
  )
  loop
    -- settled = total − balance_due; covered once settlement reaches this installment's running total.
    if (v_c.total_minor - v_c.balance_due_minor) >= v_c.cumulative_minor then
      continue;
    end if;
    v_due_minor := greatest(0, least(
      v_c.balance_due_minor,
      v_c.cumulative_minor - (v_c.total_minor - v_c.balance_due_minor)
    ));

    if v_c.due_on >= v_today and v_c.due_on <= v_today + v_lead then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', v_c.customer_email, 'installment_reminder',
        jsonb_build_object(
          'ref', v_c.ref, 'quoteRef', v_c.quote_ref, 'bookingId', v_c.booking_id,
          'customerName', v_c.customer_name, 'seq', v_c.seq,
          'dueOn', v_c.due_on, 'label', v_c.label, 'amountDueMinor', v_due_minor, 'locale', v_c.locale
        ),
        v_c.booking_id,
        'installment_reminder:' || v_c.booking_id::text || ':' || v_c.seq::text
      )
      on conflict (idempotency_key) do nothing;
      v_count := v_count + 1;
    elsif v_c.due_on < v_today then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', 'owner', 'owner_installment_overdue',
        jsonb_build_object(
          'ref', v_c.ref, 'customerName', v_c.customer_name, 'seq', v_c.seq,
          'dueOn', v_c.due_on, 'label', v_c.label, 'amountDueMinor', v_due_minor
        ),
        v_c.booking_id,
        'installment_overdue:' || v_c.booking_id::text || ':' || v_c.seq::text
      )
      on conflict (idempotency_key) do nothing;
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function api_enqueue_installment_reminders(jsonb) from public, anon, authenticated;
grant execute on function api_enqueue_installment_reminders(jsonb) to service_role;
