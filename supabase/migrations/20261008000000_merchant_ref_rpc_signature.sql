-- HOTFIX: api_record_merchant_ref took `payload jsonb`; the port calls every api_* function with a
-- single jsonb argument NAMED `p` (src/lib/supabase/rpc.ts: `client.rpc(fn, { p: params })`).
--
-- PostgREST resolves overloads by ARGUMENT NAME, so `api_record_merchant_ref(payload jsonb)` was
-- simply not found. createPaymentLink records the merchant ref BEFORE calling Peach, so the throw
-- landed in front of every checkout mint on the site — bookings, quotes, balances, installments,
-- supplements and tour-change differences alike. Live symptom: "An upstream service is unavailable"
-- on the pay button, `error_logs` filling with "Database error" / provider_error, and payments rows
-- created with `provider_checkout_id` null and no merchant ref recorded.
--
-- WHY THE TESTS WERE GREEN. The PGlite shim in tests/db/rpc.ts binds POSITIONALLY —
-- `select ${fn}($1::jsonb)` — so it resolves the function whatever its parameter is called. The
-- parameter NAME is the one part of the contract the integration tests structurally cannot see,
-- despite that file's "zero mock divergence" claim. tests/unit/api-rpc-signature.test.ts now asserts
-- every api_* function in supabase/migrations declares `(p jsonb)`, which is a check that would have
-- caught this before it ever reached a customer.
--
-- CREATE OR REPLACE cannot rename an input parameter ("cannot change name of input parameter"), so
-- the old function has to be dropped first. Nothing depends on it but the service layer, which is
-- failing on it right now.
drop function if exists api_record_merchant_ref(jsonb);

create or replace function api_record_merchant_ref(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := nullif(p->>'paymentId', '')::uuid;
  v_mtid       text := nullif(p->>'merchantTxnId', '');
  v_owner      uuid;
begin
  if v_payment_id is null or v_mtid is null then
    raise exception 'api_record_merchant_ref: paymentId and merchantTxnId are required';
  end if;

  insert into payment_merchant_refs (merchant_txn_id, payment_id)
  values (v_mtid, v_payment_id)
  on conflict (merchant_txn_id) do nothing;

  if not found then
    -- Already recorded. A retry of the same mint is idempotent and fine, but the same id pointing at
    -- a DIFFERENT payment would resolve one booking's settlement onto another's money. The ids carry
    -- 65 bits of randomness so this should never fire; if it ever does, failing loudly is the only
    -- safe answer.
    select payment_id into v_owner
      from payment_merchant_refs
     where merchant_txn_id = v_mtid;
    if v_owner is distinct from v_payment_id then
      raise exception 'api_record_merchant_ref: % already belongs to payment %', v_mtid, v_owner;
    end if;
  end if;

  return jsonb_build_object('merchantTxnId', v_mtid, 'paymentId', v_payment_id);
end;
$$;

revoke execute on function api_record_merchant_ref(jsonb) from public, anon, authenticated;
grant execute on function api_record_merchant_ref(jsonb) to service_role;
