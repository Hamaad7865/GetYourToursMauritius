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
