-- Emulates the Supabase-managed environment so our real migrations can be applied
-- and RLS exercised under PGlite (no Docker). On a real Supabase project this
-- schema/roles already exist and are NOT created by our migrations.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

-- Supabase helper functions: read the request JWT claims set per request.
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(nullif(current_setting('request.jwt.claims', true), ''), 'null')::json ->> 'sub')::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), ''), 'null')::json ->> 'role',
    'anon'
  );
$$;

create or replace function auth.jwt() returns json language sql stable as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), ''), 'null')::json,
    '{}'::json
  );
$$;

-- Supabase roles. service_role bypasses RLS (used by the webhook / trusted ops).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- Stock Supabase ALTER DEFAULT PRIVILEGES. Every function created in `public` is handed a DIRECT
-- EXECUTE grant to anon + authenticated (verified live: pg_default_acl for objtype 'f' in schema
-- public is {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}).
--
-- This matters for detection, not just fidelity. `revoke execute ... from public` does NOT strip a
-- direct role grant, so without this line a function locked down with only `from public` LOOKS closed
-- under PGlite — anon genuinely loses the privilege, because nothing ever granted it directly — while
-- on the real project anon/authenticated keep EXECUTE and the function stays wide open. That blind
-- spot hid two live holes (api_booking_receipt, api_pending_payment_checkouts) from CI until
-- 20260818000000. Replicating the default privileges makes has_function_privilege() in
-- tests/integration/definer-grants-lockdown.test.ts mean the same thing here as in production.
--
-- Scope: functions only. Supabase sets the same defaults for tables and sequences; replicating those
-- would be more faithful still, but RLS (not the table grant) is the real gate there, so it is a
-- separate change with a much wider blast radius.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
