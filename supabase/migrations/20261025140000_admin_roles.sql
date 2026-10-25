-- 20261025140000_admin_roles
--
-- Owner-managed roles for the back office. Spec: docs/superpowers/specs/2026-10-25-admin-roles-design.md
--
-- Until now `staff` and `admin` were identical everywhere (is_staff() = role in ('staff','admin')), so
-- the owner could not give the people who work with them access to quotes and bookings without also
-- giving them revenue, the P&L/VAT report, fares, the exchange rate and refunds. And enforce_profile_role
-- let ANY is_staff() caller set ANY profile's role — a staff member could make themselves admin.
--
-- This migration:
--   1. a fixed permission catalogue (mirrored by src/lib/admin/permissions.ts; a test pins the two);
--   2. team_roles — owner-defined bundles of those keys; profiles.team_role_id points at one;
--      is_admin() / has_permission(key) for RLS and RPCs;
--   3. the profile guard: only the Owner (role 'admin') changes role / team_role_id; a team role must
--      match its base; the last Owner can never be demoted or deleted;
--   4. the owner-only team RPCs (api_my_access, api_team_list, api_team_assign, api_team_remove);
--   5. money locks: price tables need money.prices to write; price columns on mixed tables need it too;
--      the charge currency and rate need money.currency;
--   6. refunds need money.refunds (api_mark_refunded, api_record_change_refund);
--   7. a "Content" role for the existing seo account(s).
--
-- user_role stays the DATA floor: a team role's members are 'staff' (base 'team', is_staff()) or 'seo'
-- (base 'content', is_content_editor() only). Nothing here widens what any role could read before.
-- Role comparisons use role::text: Postgres forbids USING an enum value added in the same transaction
-- ('seo' was added by 20260810000000), and catch-up.sql runs as one script.
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

-- ── 1) The permission catalogue ─────────────────────────────────────────────────────────────────
create or replace function permission_catalogue()
returns text[]
language sql
immutable
as $$
  select array[
    'section.bookings', 'section.calendar', 'section.quotes', 'section.documents',
    'section.leads', 'section.reviews', 'section.assistant', 'section.tours',
    'section.categories', 'section.content', 'section.rental', 'section.places',
    'section.seo', 'section.blog', 'section.redirects',
    'money.reports', 'money.revenue', 'money.prices', 'money.currency', 'money.refunds',
    'money.notes'
  ]::text[];
$$;

-- The keys a content-only role may hold — the sections the seo role could already reach.
create or replace function content_permission_catalogue()
returns text[]
language sql
immutable
as $$
  select array['section.tours', 'section.places', 'section.seo', 'section.blog', 'section.redirects']::text[];
$$;

-- ── 2) team_roles + profiles.team_role_id ───────────────────────────────────────────────────────
create table if not exists team_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  description text check (description is null or length(description) <= 300),
  base text not null check (base in ('team', 'content')),
  permissions text[] not null default '{}' check (permissions <@ permission_catalogue()),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null
);
create unique index if not exists team_roles_name_key on team_roles (lower(btrim(name)));

-- ON DELETE RESTRICT is the "a role with members cannot be deleted" rule.
alter table profiles
  add column if not exists team_role_id uuid references team_roles (id) on delete restrict;
create index if not exists profiles_team_role_idx on profiles (team_role_id)
  where team_role_id is not null;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role::text = 'admin');
$$;

-- True for the Owner; for a 'staff'/'seo' member, when their team role holds the key; false for
-- everyone else (no profile, no team role, a customer, anonymous) — fail closed.
create or replace function has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select pr.role::text = 'admin'
           or (pr.role::text in ('staff', 'seo')
               and p_key = any(coalesce(tr.permissions, '{}'::text[])))
      from profiles pr
      left join team_roles tr on tr.id = pr.team_role_id
     where pr.id = auth.uid()
  ), false);
$$;

-- Both are read inside RLS policies, which anon and authenticated evaluate, so both may execute them.
-- They only ever answer about the caller.
revoke execute on function is_admin() from public;
revoke execute on function has_permission(text) from public;
grant execute on function is_admin() to anon, authenticated, service_role;
grant execute on function has_permission(text) to anon, authenticated, service_role;

-- Normalise and police every team_roles write: trimmed name, de-duplicated sorted keys, a content role
-- holds only content keys, and `base` is fixed once the role exists (its members' profiles.role
-- depends on it).
create or replace function enforce_team_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.base is distinct from old.base then
    raise exception 'team_role_base_immutable';
  end if;
  new.name := btrim(new.name);
  new.permissions := array(
    select distinct k from unnest(coalesce(new.permissions, '{}'::text[])) k order by k
  );
  if new.base = 'content' and not (new.permissions <@ content_permission_catalogue()) then
    raise exception 'content_role_permission'
      using detail = 'a content-only role can hold only Tours, Places, SEO, Blog and Redirects';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists team_roles_guard on team_roles;
create trigger team_roles_guard
  before insert or update on team_roles
  for each row execute function enforce_team_role();

revoke execute on function enforce_team_role() from public, anon, authenticated;
grant execute on function enforce_team_role() to service_role;

alter table team_roles enable row level security;

-- The Owner reads every role; a member reads their own (the browser shows its name).
drop policy if exists team_roles_read on team_roles;
create policy team_roles_read on team_roles for select using (
  (select is_admin())
  or id = (select pr.team_role_id from profiles pr where pr.id = auth.uid())
);
drop policy if exists team_roles_owner_write on team_roles;
create policy team_roles_owner_write on team_roles for all
  using ((select is_admin())) with check ((select is_admin()));

-- A table created after 20260615120800's one-time blanket grant states its own privileges. Supabase's
-- default privileges hand anon ALL on a new table (DELETE included), so revoke it explicitly.
revoke all on team_roles from anon;
grant select, insert, update, delete on team_roles to authenticated;
grant all on team_roles to service_role;
