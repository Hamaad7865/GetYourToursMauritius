-- 20260807000000_lockdown_public_revoke
-- Follow-up to 20260806000000_security_lockdown (external review round 2):
--  1. The 20260806 revokes named anon/authenticated but not PUBLIC; privileges are additive and
--     anon/authenticated are PUBLIC members, so the implicit create-function PUBLIC grant kept the
--     'locked' RPCs executable with the anon key. Re-revoke naming public + members explicitly.
--  2. api_create_hold: the service-role route path made auth.uid() null inside create_hold, so
--     signed-in customers' holds landed ownerless (unreleasable, missing from their pending list).
--     The re-applied body stamps created_by from the route's JWKS-verified p.userId.
--  3. api_record_payment_charge / api_record_payment_checkout: locked to service_role -- the old
--     owner-or-staff guard checked WHO but not WHAT, letting a booking owner falsify the charge
--     figures on their own VAT invoice / the sweep's stored checkout id.
-- Re-run supabase/catch-up.sql after applying (idempotent).

-- api_create_hold: re-applied (winning body from 20260801000000_private_option) + ownership stamping.
-- The holds route now calls this through a SERVICE-ROLE client (the anon/authenticated grants are
-- revoked below), so auth.uid() inside create_hold is null and every hold landed OWNERLESS
-- (created_by null) -- breaking the signed-in customer's pending list and release, because
-- api_release_hold requires created_by = auth.uid(). The route passes the JWKS-verified user id as
-- p.userId; it is trustworthy because only the server (service_role) can execute this function. An
-- existing owner is never overwritten, so a replayed idempotency key cannot re-assign someone's hold.
create or replace function api_create_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_people bigint := coalesce((p ->> 'people')::bigint, 0);
  v_mode text := 'per_person';
  v_is_private boolean := false;
  v_qty int;
  v_hold booking_holds;
  v_uid uuid;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;
  if v_people <= 0 or v_people > 1000000 then
    raise exception 'invalid_party';
  end if;
  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  select a.pricing_mode, (o.private_base_minor is not null)
    into v_mode, v_is_private
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_qty := case when coalesce(v_mode, 'per_person') in ('vehicle', 'vehicle_custom')
                  or coalesce(v_is_private, false) then 1 else v_people::int end;

  v_hold := create_hold(v_occ, v_qty, v_key);

  -- Stamp ownership for the server-mediated path (see the function comment). Prefer a real JWT
  -- identity when one exists; only ever fill a NULL created_by (idempotent replays keep the original).
  v_uid := coalesce(auth.uid(), nullif(p ->> 'userId', '')::uuid);
  if v_uid is not null and v_hold.created_by is null then
    update booking_holds set created_by = v_uid where id = v_hold.id and created_by is null;
    select * into v_hold from booking_holds where id = v_hold.id;
  end if;

  return jsonb_build_object('holdId', v_hold.id, 'quantity', v_hold.quantity, 'expiresAt', v_hold.expires_at);
end;
$$;

-- api_record_payment_charge: service-role only. The recorded charge feeds the customer's VAT
-- invoice/receipt; the amount/currency arrive as caller input, so an authenticated booking owner could
-- previously falsify their own invoice's charge figures (the old guard checked WHO, never WHAT). The
-- only legitimate writer is the server (createPaymentLink), which derives the values from the
-- provider charge it just created -- so the grants below lock execution to service_role and the body
-- keeps a defence-in-depth role check. Record-once (FX drift) semantics unchanged.
create or replace function api_record_payment_charge(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
  v_minor int := (p ->> 'chargedAmountMinor')::int;
  v_currency text := nullif(p ->> 'chargedCurrency', '');
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_charge: paymentId required';
  end if;

  -- Grants are the primary gate (service_role only). Defence in depth against a future accidental
  -- re-grant: refuse any PostgREST caller that is not the service role (or staff). A direct DB session
  -- (the owner in psql / the SQL editor / test seeding) carries no JWT claims and stays allowed.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;

  -- Record the charge ONCE (FX-drift fix): a later re-pay at a different rate must not overwrite it.
  update payments
  set charged_amount_minor = v_minor,
      charged_currency = v_currency
  where id = v_payment_id and charged_amount_minor is null;

  return jsonb_build_object('ok', true);
end;
$$;

-- api_record_payment_checkout: service-role only, same reasoning -- the stored checkout id drives the
-- reconcile sweep's Peach status queries, so only the server (which just created the checkout) may
-- write it. Latest-checkout-wins overwrite semantics unchanged.
create or replace function api_record_payment_checkout(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p ->> 'paymentId', '')::uuid;
begin
  if v_payment_id is null then
    raise exception 'invalid_request' using detail = 'record_payment_checkout: paymentId required';
  end if;

  -- Grants are the primary gate (service_role only); defence in depth as in api_record_payment_charge.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;

  -- OVERWRITE (latest checkout wins): a re-pay opens a new checkout the sweep must query, so the most
  -- recent checkout id replaces any prior one -- no record-once guard here.
  update payments
  set prev_provider_checkout_id = case
        when provider_checkout_id is not null
             and provider_checkout_id is distinct from left(btrim(p ->> 'checkoutId'), 128)
        then provider_checkout_id
        else prev_provider_checkout_id
      end,
      provider_checkout_id = left(btrim(p ->> 'checkoutId'), 128)
  where id = v_payment_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grant lockdown, take 2. The 20260806000000 revokes named anon/authenticated but NOT public -- and
-- Postgres privileges are ADDITIVE: `create function` implicitly grants EXECUTE to PUBLIC, and anon /
-- authenticated are members of PUBLIC, so they kept executing straight through the implicit grant.
-- Every revoke below therefore names public AND the member roles; the paired grants restore exactly
-- the callers each function is supposed to have. (Verified against the live catalog: pg_proc.proacl
-- showed `=X/postgres` -- the PUBLIC entry -- on every one of these functions.)
-- ---------------------------------------------------------------------------

-- Server-only mutations (the Next routes call these through a service-role client).
revoke execute on function api_rate_limit(jsonb) from public, anon, authenticated;
revoke execute on function api_create_hold(jsonb) from public, anon, authenticated;
revoke execute on function create_hold(uuid, int, text) from public, anon, authenticated;
revoke execute on function api_capture_lead(jsonb) from public, anon, authenticated;
revoke execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  from public, anon, authenticated;
revoke execute on function api_record_payment_charge(jsonb) from public, anon, authenticated;
revoke execute on function api_record_payment_checkout(jsonb) from public, anon, authenticated;
grant execute on function api_rate_limit(jsonb) to service_role;
grant execute on function api_create_hold(jsonb) to service_role;
grant execute on function create_hold(uuid, int, text) to service_role;
grant execute on function api_capture_lead(jsonb) to service_role;
grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to service_role;
grant execute on function api_record_payment_charge(jsonb) to service_role;
grant execute on function api_record_payment_checkout(jsonb) to service_role;

-- Signed-in customer mutations (checkout forces sign-in; ownership is re-checked in-body).
revoke execute on function api_book(jsonb) from public, anon;
revoke execute on function api_create_payment(jsonb) from public, anon;
grant execute on function api_book(jsonb) to authenticated, service_role;
grant execute on function api_create_payment(jsonb) to authenticated, service_role;

-- Strip the stray PUBLIC grant from the remaining guarded writers (their earlier revokes named only
-- anon); authenticated stays -- the staff browser client and the self-serve privacy flow use them.
revoke execute on function api_erase_user(jsonb) from public;
revoke execute on function api_reorder_activities(jsonb) from public;
