-- Merchant transaction references — a booking's Peach order ids, as history rather than a derivation.
--
-- WHY. The id we hand Peach as `merchantTransactionId` used to be the bare booking ref, and Peach
-- permanently refuses an id that already carries a SUCCESSFUL transaction ("Order already has an
-- existing successful initial transaction"). That made every follow-on charge on a booking — a quote
-- balance, a dated installment, a pickup supplement, a tour-change difference — fail at the card step
-- with 800.100.156, which the guest reads as "incorrect card details". 20260901 (3823922) narrowed the
-- blast radius by appending a per-payment suffix, `<ref>-<8 hex of the payment row id>`.
--
-- That fix has a structural limit this table removes: the id is DERIVED, so it is fixed for the life of
-- the payment row. If an id is ever burned at Peach, that row is unpayable forever and the only escape
-- is abandoning the row entirely (withdraw the proposal, re-propose, re-issue the link to the guest —
-- which is exactly the dance BMTBF62F6FB4DF4A needed). An id we STORE can be reissued at will.
--
-- APPEND-ONLY, MANY-TO-ONE. One payment row accumulates an id per checkout session it opens. That is
-- the point: a burned id is replaced, not worked around. It also means a late or replayed webhook that
-- echoes an OLDER id still resolves to its booking — an overwritten single column would drop that
-- payment on the floor, and the money with it.
create table if not exists payment_merchant_refs (
  merchant_txn_id text primary key,
  payment_id uuid not null references payments (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table payment_merchant_refs is
  'Every merchantTransactionId issued to the provider, mapped to the payment row that issued it. '
  'Append-only: a payment may hold several over its life (one per checkout session), so a burned id '
  'can be reissued and an older id echoed by a late webhook still resolves.';

-- Reads go two ways, and both are indexed: by id (the primary key — resolving a settlement, and the
-- admin search box turning a Peach order id back into a booking), and by payment (the drawer's
-- history, oldest first).
create index if not exists payment_merchant_refs_payment_idx
  on payment_merchant_refs (payment_id, created_at);

alter table payment_merchant_refs enable row level security;

-- Grants, deliberately explicit. Supabase's defaults hand `anon` and `authenticated` the full
-- insert/update/delete set on a NEW table, so "I only granted select" is not what the database ends up
-- believing — revoke first, then grant back exactly what each role needs. This mirrors
-- booking_change_requests. Verify with has_table_privilege(), never information_schema.role_table_grants,
-- which has previously reported a live anon grant as absent.
revoke all on payment_merchant_refs from public, anon, authenticated;
grant select on payment_merchant_refs to authenticated;
grant select, insert on payment_merchant_refs to service_role;

-- Staff only. This is payment-adjacent metadata: it names the ids money moved under, so it never goes
-- near the `seo` content role, and a customer has no use for it. No owner-select policy — unlike a
-- booking, an order id tells the guest nothing they can act on.
drop policy if exists pmr_staff_select on payment_merchant_refs;
create policy pmr_staff_select on payment_merchant_refs for select
  using (is_staff());

-- Record one issued id. Called by the service immediately BEFORE the provider call, never after: if we
-- called Peach first and this write then failed, a settlement could arrive carrying an id we cannot
-- resolve — money taken, booking left unconfirmed. An orphan row (written here, provider call then
-- failed) is harmless by comparison: nothing ever settles against it.
create or replace function api_record_merchant_ref(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(payload->>'paymentId', '')::uuid;
  v_mtid       text := nullif(payload->>'merchantTxnId', '');
  v_owner      uuid;
begin
  if v_payment_id is null or v_mtid is null then
    raise exception 'api_record_merchant_ref: paymentId and merchantTxnId are required';
  end if;

  insert into payment_merchant_refs (merchant_txn_id, payment_id)
  values (v_mtid, v_payment_id)
  on conflict (merchant_txn_id) do nothing;

  if not found then
    -- Already recorded. A retry of the same mint is fine and idempotent, but the same id pointing at a
    -- DIFFERENT payment would silently resolve one booking's settlement onto another's money. The ids
    -- are 65 bits of randomness so this should never fire; if it ever does, failing loudly is the only
    -- safe answer.
    select payment_id into v_owner
      from payment_merchant_refs
     where merchant_txn_id = v_mtid;
    if v_owner is distinct from v_payment_id then
      raise exception 'api_record_merchant_ref: % already belongs to payment %', v_mtid, v_owner;
    end if;
  end if;
end;
$$;

revoke execute on function api_record_merchant_ref(jsonb) from public, anon, authenticated;
grant execute on function api_record_merchant_ref(jsonb) to service_role;
