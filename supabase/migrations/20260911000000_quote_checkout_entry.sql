-- ---------------------------------------------------------------------------
-- The quote path's own way into the checkout — WITHOUT relaxing the customer path.
--
-- THE DEFECT. api_create_payment ends its guard with
--     if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid()))
-- which is exactly right for a customer checkout: the public booking ref travels in emails and URLs
-- and is NOT a bearer credential, so only the booking's owner (or staff) may open a payable session
-- against it. A QUOTE booking has `user_id` null — the guest has no account, which is the entire point
-- of an emailed offer — and POST /api/v1/quotes/{ref}/pay calls as service_role, for which auth.uid()
-- is null. Every quote payment was therefore refused with `forbidden`, and the module could not take a
-- cent end to end.
--
-- THE SHAPE OF THE FIX, decided by the owner: a SEPARATE entry point, not a softened guard. The path
-- every normal customer checkout takes is bit-for-bit what it was.
--
--   1. `create_payment(p, p_enforce_caller_identity)` — the WHOLE of the previous api_create_payment
--      body, moved here verbatim, with the caller-identity check made conditional and NOTHING else
--      changed: the same booking-payability guard, the same add-on branch, the same first-write-wins
--      FX pin, the same 25-minute reuse window and the same 90-second single-flight checkout lease.
--   2. `api_create_payment(p)` — a wrapper that calls it with the check ON. Same name, same signature,
--      same grants (authenticated + service_role), same behaviour for every existing caller.
--   3. `api_create_quote_payment(p)` — a wrapper that calls it with the check OFF, granted to
--      service_role ONLY.
--
-- WHY THE QUOTE PATH MAY SKIP THE CALLER-IDENTITY CHECK. Authorization for a quote is the LINK TOKEN,
-- not a session. The route reads the token from the httpOnly cookie the open route set (scoped to
-- `/api/v1/quotes/{ref}`), and `resolveQuoteForToken` verifies it against the stored SHA-256 and
-- collapses unknown ref / wrong token / unsent draft / withdrawn offer / lapsed validity into a single
-- refusal — all of that BEFORE this function is reached. So the identity check is not being waived;
-- a different, stronger credential has already been checked. Two things keep that sound in SQL:
--
--   * this entry point is SERVICE-ROLE ONLY. `revoke ... from public, anon, authenticated` (all three
--      roles named — `from public` alone leaves Supabase's stock direct grants in place, an omission
--      that has shipped a live hole from this repo three times), so nothing reachable from a browser
--      can call it and skip the token check that authorizes it;
--   * and it is narrowed to the quote path even for a server caller: a booking that no `quotes` row
--      points at is refused, so the bypass can never be aimed at an ordinary customer's booking.
--
-- WHY ONE SHARED BODY RATHER THAN A SECOND FUNCTION. The single-flight lease is what stops one booking
-- having two payable Peach sessions — Peach's nonce is per-REQUEST and never dedupes — and this repo
-- has shipped that exact defect once already (a declined card forked a second payable session, fixed in
-- ec5ebcf). A second copy of the lease is a second copy free to drift from the first the next time
-- either is edited. Sharing the body makes drift impossible: both entry points contend for the SAME
-- `payments.checkout_claimed_until` on the SAME payments row, which
-- tests/integration/quote-checkout-entry.test.ts asserts directly by having staff claim the lease
-- through api_create_payment and the quote entry point be told `checkoutPending`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) create_payment — the shared body. INTERNAL: service_role only, and never called from the app
--    directly. The `p_enforce_caller_identity` argument IS the authorization decision, so a caller
--    able to reach this function could pass `false` for any booking; that is precisely why the grant
--    below names anon and authenticated.
--
--    The body is 20260910000000's api_create_payment verbatim apart from the one wrapped `if`.
-- ---------------------------------------------------------------------------
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
    insert into payments (booking_id, idempotency_key, amount_minor, purpose)
    values (v_booking.id, p ->> 'idempotencyKey', v_booking.total_minor, 'booking')
    returning * into v_payment;
    insert into payment_events (payment_id, type, amount_minor)
    values (v_payment.id, 'intent', v_booking.total_minor);
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

-- ---------------------------------------------------------------------------
-- 2) api_create_payment — the customer entry point. UNCHANGED in name, signature, grants and
--    behaviour; it is now a wrapper so there is exactly one copy of the money logic.
--
--    SECURITY DEFINER is load-bearing on the wrapper, not decoration: `authenticated` deliberately
--    has no EXECUTE on create_payment, so the privilege check for the inner call has to run as the
--    (shared) owner of both functions.
-- ---------------------------------------------------------------------------
create or replace function api_create_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return create_payment(p, true);
end;
$$;

revoke execute on function api_create_payment(jsonb) from public, anon;
grant execute on function api_create_payment(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) api_create_quote_payment — the quote entry point. Service-role only.
--
--    Authorization is the LINK TOKEN, verified by resolveQuoteForToken in POST
--    /api/v1/quotes/{ref}/pay before this is ever reached; see the file header for why that is a
--    stronger credential than the session this skips, and why the grant is what keeps it sound.
--
--    TWO NARROWINGS, both so the identity bypass stays pointed at the quote path alone:
--      a. the booking must be one a `quotes` row points at (and `source = 'quote'`, which
--         api_convert_quote sets on the same row it links). A customer's own booking is refused here
--         no matter who is calling;
--      b. only a 'booking' payment. The pickup add-on is a supplement on a CONFIRMED booking, paid
--         from the booking page by its signed-in owner — a quote guest has no such page and no
--         account, so there is no case where this entry point should be opening one.
--
--    Both refusals raise `forbidden` rather than a new token: mapDbError already turns that into a
--    403, and neither is reachable from the route (which only ever passes a quote booking, and never
--    a purpose), so a bespoke guest-facing sentence would be one nobody can ever read.
-- ---------------------------------------------------------------------------
create or replace function api_create_quote_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purpose text := coalesce(nullif(p ->> 'purpose', ''), 'booking');
begin
  if v_purpose <> 'booking' then
    raise exception 'forbidden' using detail = 'quote_payment_purpose:' || v_purpose;
  end if;

  if not exists (
    select 1
      from bookings b
      join quotes q on q.booking_id = b.id
     where b.ref = p ->> 'bookingRef'
       and b.source = 'quote'
  ) then
    raise exception 'forbidden' using detail = 'not_a_quote_booking';
  end if;

  return create_payment(p, false);
end;
$$;

revoke execute on function api_create_quote_payment(jsonb) from public, anon, authenticated;
grant execute on function api_create_quote_payment(jsonb) to service_role;

comment on function api_create_quote_payment(jsonb) is
  'Opens a checkout for a QUOTE booking, which has no owner to check (the guest has no account). '
  'Authorization is the emailed link token, verified by resolveQuoteForToken before the route calls '
  'this; service_role only, and refuses any booking no quote points at. Shares api_create_payment''s '
  'body, so both take the same single-flight checkout lease.';
