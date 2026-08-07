-- Saved cards — Peach card-on-file tokens for the signed-in customer (one-click reuse).
--
-- Card data NEVER touches our server (PCI SAQ A unchanged): the embedded Peach widget captures the PAN
-- client-side and returns only an opaque `registrationId` token, which we harvest server-side from the
-- checkout STATUS payload (never the webhook — it omits card.*) and store here with brand/last4/expiry.
--
-- Owner-scoped in BOTH RLS (defense in depth) and the api_* seam. Writes happen server-side only
-- (api_save_card is service_role-only, called from the confirm/harvest path); the customer-facing RPCs
-- list (metadata only — never the token) and delete their own cards. Idempotent DDL so catch-up.sql
-- can reuse this exact text.

create table if not exists saved_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'peach',
  provider_registration_id text not null,
  brand text,
  last4 text,
  exp_month int,
  exp_year int,
  created_at timestamptz not null default now(),
  unique (user_id, provider_registration_id)
);
create index if not exists saved_cards_user_idx on saved_cards (user_id, created_at desc);

-- The blanket "grant on all tables to authenticated" ran in the original RLS migration, before this
-- table existed, so grant explicitly. No INSERT for authenticated — cards are only ever written by the
-- service-role harvest path (api_save_card). RLS still gates every row to its owner.
grant select, delete on saved_cards to authenticated;

alter table saved_cards enable row level security;
drop policy if exists saved_cards_select on saved_cards;
drop policy if exists saved_cards_delete on saved_cards;
drop policy if exists saved_cards_staff on saved_cards;
create policy saved_cards_select on saved_cards for select using (user_id = auth.uid());
create policy saved_cards_delete on saved_cards for delete using (user_id = auth.uid());
create policy saved_cards_staff on saved_cards for all using (is_staff()) with check (is_staff());

-- api_save_card — SERVER-ONLY harvest write. Called from the confirm/status path (service-role) when a
-- checkout came back with a registrationId (the customer ticked "save card" in the widget). Upserts on
-- (user, token) so re-paying with the same stored card refreshes its metadata rather than duplicating.
create or replace function api_save_card(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := nullif(p ->> 'userId', '')::uuid;
  v_reg   text := nullif(p ->> 'registrationId', '');
  v_brand text := nullif(p ->> 'brand', '');
  v_last4 text := nullif(p ->> 'last4', '');
  v_em    int  := nullif(p ->> 'expMonth', '')::int;
  v_ey    int  := nullif(p ->> 'expYear', '')::int;
  v_row   saved_cards;
begin
  -- Grants are the primary gate (service_role only); this is defense in depth. A present-but-non-service
  -- JWT that somehow reaches here (staff excepted) is refused; a null claims context is the trusted
  -- server path (pg owner / service-role rpc).
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_uid is null or v_reg is null then
    raise exception 'invalid_request' using detail = 'save_card: userId and registrationId required';
  end if;
  insert into saved_cards (user_id, provider, provider_registration_id, brand, last4, exp_month, exp_year)
  values (v_uid, 'peach', v_reg, v_brand, v_last4, v_em, v_ey)
  on conflict (user_id, provider_registration_id) do update
    set brand = excluded.brand, last4 = excluded.last4,
        exp_month = excluded.exp_month, exp_year = excluded.exp_year
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'saved', true);
end;
$$;

-- api_list_saved_cards — the caller's own cards for the account screen. METADATA ONLY: the opaque
-- provider_registration_id (the reusable token) is DELIBERATELY not returned to the browser — the reuse
-- flow reads it server-side. Owner-scoped DEFINER seam.
create or replace function api_list_saved_cards(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'brand', c.brand, 'last4', c.last4,
      'expMonth', c.exp_month, 'expYear', c.exp_year, 'createdAt', c.created_at
    ) order by c.created_at desc), '[]'::jsonb) into v_items
  from saved_cards c
  where c.user_id = v_uid;
  return v_items;
end;
$$;

-- api_delete_saved_card — remove one of the caller's own cards (idempotent). Deleting the local row does
-- NOT revoke the token at Peach; that's acceptable for a "forget this card" affordance.
create or replace function api_delete_saved_card(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid := nullif(p ->> 'id', '')::uuid;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'invalid_request' using detail = 'delete_saved_card: id required';
  end if;
  delete from saved_cards where id = v_id and user_id = v_uid;
  return jsonb_build_object('id', v_id, 'deleted', true);
end;
$$;

-- api_list_card_tokens — the OPAQUE reusable tokens for one user, to hand the Peach widget as
-- `cardTokens` for one-click reuse. SERVER-ONLY (returns the tokens the browser must never see):
-- createPaymentLink calls it under the service-role port when building a checkout for a signed-in user.
create or replace function api_list_card_tokens(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := nullif(p ->> 'userId', '')::uuid;
  v_tokens jsonb;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_uid is null then
    raise exception 'invalid_request' using detail = 'list_card_tokens: userId required';
  end if;
  select coalesce(jsonb_agg(c.provider_registration_id order by c.created_at desc), '[]'::jsonb)
    into v_tokens
  from saved_cards c
  where c.user_id = v_uid;
  return v_tokens;
end;
$$;

-- Lock down grants. Postgres implicitly grants EXECUTE to PUBLIC (and anon/authenticated are members),
-- so revoke from PUBLIC by name, then grant only the intended roles.
revoke execute on function api_save_card(jsonb)         from public, anon, authenticated;
revoke execute on function api_list_saved_cards(jsonb)  from public;
revoke execute on function api_delete_saved_card(jsonb) from public;
revoke execute on function api_list_card_tokens(jsonb)  from public, anon, authenticated;
grant  execute on function api_save_card(jsonb)         to service_role;
grant  execute on function api_list_saved_cards(jsonb)  to authenticated, service_role;
grant  execute on function api_delete_saved_card(jsonb) to authenticated, service_role;
grant  execute on function api_list_card_tokens(jsonb)  to service_role;

-- GDPR erasure. `api_erase_user` deletes the caller's `profiles` row in its GUARANTEED data-erasure
-- step; the `auth.users` removal is a SEPARATE, later step in the delete route that can fail (the row
-- is then banned but retained). So the auth.users ON DELETE CASCADE above is not enough on its own —
-- tie the token deletion to the profiles delete instead, which is the erase signal that always fires.
-- Deliberately NOT a redefine of the large api_erase_user (avoids the migration-revert-drift trap).
create or replace function erase_saved_cards_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from saved_cards where user_id = old.id;
  return old;
end;
$$;
drop trigger if exists saved_cards_erase_with_profile on profiles;
create trigger saved_cards_erase_with_profile
  before delete on profiles
  for each row execute function erase_saved_cards_for_profile();
