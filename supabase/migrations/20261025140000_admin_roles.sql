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
-- Only ever ADD keys: removing one leaves stored rows that violate the CHECK — strip it from
-- team_roles in the same migration first.
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
-- everyone else (no profile, no team role, a customer, anonymous) — fail closed. An unknown or NULL
-- key is false for EVERYONE, the Owner included, so a typo'd key in a later policy is caught by
-- owner-run tests instead of silently granting. A team role only counts while its base matches the
-- profile's role (staff <-> team, seo <-> content): defence in depth against a slipped pairing.
create or replace function has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_key = any(permission_catalogue()), false)
     and coalesce((
       select pr.role::text = 'admin'
              or (    (   (pr.role::text = 'staff' and tr.base = 'team')
                       or (pr.role::text = 'seo' and tr.base = 'content'))
                  and p_key = any(tr.permissions))
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
  -- Stamp the editor only when the role's content actually changed. The updated_by FK's ON DELETE SET
  -- NULL is itself an UPDATE that passes through here: re-stamping auth.uid() on it would write the
  -- just-erased profile's id straight back (a dangling reference).
  if tg_op = 'INSERT'
     or (new.name, new.description, new.permissions)
        is distinct from (old.name, old.description, old.permissions) then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  elsif new.updated_by is not null then
    new.updated_by := old.updated_by; -- a client may not forge the editor
  end if;
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
-- default privileges hand anon AND authenticated ALL on a new table — TRUNCATE included, which
-- bypasses RLS — so revoke everything first and grant back only what the policies mediate.
revoke all on team_roles from public, anon, authenticated;
grant select, insert, update, delete on team_roles to authenticated;
grant all on team_roles to service_role;

-- ── 3) The profile guard ────────────────────────────────────────────────────────────────────────
-- Replaces 20260615121000's body, which let any is_staff() caller assign roles.
create or replace function enforce_profile_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base text;
begin
  -- 0) A PROFILE IS NEVER RE-KEYED, by anyone. Staff can UPDATE any non-Owner row, and the role /
  --    team_role_id pin below guards the row's CONTENT, not its identity: `set id = <spare account>`
  --    would carry a staff member's role and team role onto another account, and a two-row swap
  --    would trade two members' roles. Nothing legitimate ever rewrites profiles.id.
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'profile_id_immutable';
  end if;

  -- 1) WHO MAY CHANGE ACCESS: only the Owner, from a client. Everyone else's insert is forced to a
  --    plain customer and their updates keep the old values. service_role and the table owner (the
  --    definer RPCs below, migrations) pass through to the checks that bind everyone.
  if current_user in ('anon', 'authenticated') and not is_admin() then
    if tg_op = 'INSERT' then
      new.role := 'customer';
      new.team_role_id := null;
    else
      new.role := old.role;
      new.team_role_id := old.team_role_id;
    end if;
  end if;

  -- 2) THE PAIRING RULE, for every writer: a team role sits only on a 'staff' (base 'team') or 'seo'
  --    (base 'content') profile; Owner and customer profiles never carry one. v_base is null only when
  --    the caller cannot read the role (a non-admin re-saving someone else's unchanged row).
  if new.team_role_id is not null then
    select base into v_base from team_roles where id = new.team_role_id;
    if not (   (v_base = 'team' and new.role::text = 'staff')
            or (v_base = 'content' and new.role::text = 'seo')
            or (v_base is null and new.role::text in ('staff', 'seo'))) then
      raise exception 'team_role_mismatch';
    end if;
  end if;

  -- 3) THE LAST OWNER: nobody — the Owner included — demotes the only remaining Owner. The advisory
  --    lock serialises Owner demotions and deletions: two Owners demoting each other at once would
  --    each still see the other as an Owner and leave none. The lock is held to commit, so the second
  --    transaction's next statement (a fresh READ COMMITTED snapshot) sees the first demotion. (It
  --    serialises only under READ COMMITTED, the app's default; a REPEATABLE READ caller would not.)
  if tg_op = 'UPDATE' and old.role::text = 'admin' and new.role::text <> 'admin' then
    perform pg_advisory_xact_lock(hashtext('profiles_last_owner'));
    if not exists (select 1 from profiles where role::text = 'admin' and id <> old.id) then
      raise exception 'last_owner';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on profiles;
create trigger profiles_role_guard
  before insert or update on profiles
  for each row execute function enforce_profile_role();

create or replace function enforce_last_owner_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- WHO MAY ERASE A TEAM PROFILE: profiles_owner_delete stops a client DELETE, but api_erase_user
  -- (SECURITY DEFINER, open to any is_staff() caller for GDPR) deletes as the table owner and so
  -- bypasses RLS. Here auth.uid() is still the caller's JWT. A non-Owner may therefore erase only
  -- themselves or a customer — never a co-Owner or a team member. auth.uid() is null for
  -- service_role, the SQL editor and migrations, which stay unrestricted.
  if auth.uid() is not null and auth.uid() <> old.id and old.role::text <> 'customer'
     and not is_admin() then
    raise exception 'forbidden';
  end if;

  if old.role::text = 'admin' then
    perform pg_advisory_xact_lock(hashtext('profiles_last_owner')); -- same lock as enforce_profile_role
    if not exists (select 1 from profiles where role::text = 'admin' and id <> old.id) then
      raise exception 'last_owner';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_last_owner_guard on profiles;
create trigger profiles_last_owner_guard
  before delete on profiles
  for each row execute function enforce_last_owner_delete();

revoke execute on function enforce_last_owner_delete() from public, anon, authenticated;
grant execute on function enforce_last_owner_delete() to service_role;

-- Policies. profiles_staff (FOR ALL using is_staff()) let staff DELETE any profile — including the
-- Owner's, which AuthProvider would then re-create as a customer. Reads stay with profiles_select;
-- updates move into profiles_update, which no longer reaches an Owner's row unless you are an Owner;
-- deletes are Owner-only.
drop policy if exists profiles_staff on profiles;
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = auth.uid() or ((select is_staff()) and (role::text <> 'admin' or (select is_admin()))))
  with check (id = auth.uid() or (select is_staff()));
drop policy if exists profiles_owner_delete on profiles;
create policy profiles_owner_delete on profiles for delete using ((select is_admin()));

-- ── 4) The team RPCs ────────────────────────────────────────────────────────────────────────────
-- What the signed-in caller may do in /admin. The browser loads this once per admin visit.
create or replace function api_my_access(p jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'role', pr.role::text,
      'teamRoleId', pr.team_role_id,
      'teamRoleName', tr.name,
      'base', tr.base,
      'permissions', case
        when pr.role::text = 'admin' then to_jsonb(permission_catalogue())
        -- Same rule as has_permission(): a team role counts only when its base matches the profile.
        when (pr.role::text = 'staff' and tr.base = 'team')
          or (pr.role::text = 'seo' and tr.base = 'content') then to_jsonb(tr.permissions)
        else '[]'::jsonb
      end
    )
      from profiles pr
      left join team_roles tr on tr.id = pr.team_role_id
     where pr.id = auth.uid()
  ), jsonb_build_object(
    'role', null, 'teamRoleId', null, 'teamRoleName', null, 'base', null, 'permissions', '[]'::jsonb
  ));
$$;

-- Everyone in the back office, with their sign-in email (auth.users — profiles has no email). Owner only.
create or replace function api_team_list(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'userId', pr.id,
             'fullName', pr.full_name,
             'email', u.email,
             'role', pr.role::text,
             'teamRoleId', pr.team_role_id,
             'teamRoleName', tr.name
           ) order by (pr.role::text = 'admin') desc, lower(coalesce(pr.full_name, u.email, '')))
      from profiles pr
      join auth.users u on u.id = pr.id
      left join team_roles tr on tr.id = pr.team_role_id
     where pr.role::text <> 'customer'
  ), '[]'::jsonb);
end;
$$;

-- Put an account into a role (or make it an Owner: teamRoleId = 'owner'). role + team_role_id are set
-- together so the profile guard's pairing rule always holds; the guard's last-Owner check still applies
-- (this runs as the table owner, so an Owner assigning the only Owner seat away is refused).
--
-- The account is named by userId or by email; when BOTH are given, userId wins and email is ignored.
-- An EMAIL names an account only under the same rule as quote_owner_for_email (20260909000000), because
-- this call can hand out the whole back office:
--   * normalised through quote_email_key on BOTH sides (case and surrounding spaces do not matter);
--   * EXACTLY ONE auth.users row may hold the address — auth.users does not constrain email to be
--     unique, and picking "the oldest" of two would be a coin toss on who becomes an Owner:
--     none → not_found, several → ambiguous_email;
--   * that one account must be CONFIRMED (email_confirmed_at set) — anyone can register a stranger's
--     address and never confirm it, so an unconfirmed match is refused: not_confirmed.
-- A userId was chosen from the team screen or a known account, so it is not held to the confirmed rule;
-- it is cast to uuid (primary-key lookup; any letter case) and a malformed one is invalid_request.
create or replace function api_team_assign(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user_text text := nullif(btrim(coalesce(p ->> 'userId', '')), '');
  v_email text := quote_email_key(p ->> 'email');
  v_target text := nullif(btrim(coalesce(p ->> 'teamRoleId', '')), '');
  v_user uuid;
  v_matches int;
  v_confirmed boolean;
  v_role_id uuid;
  v_role team_roles;
  v_new_role text;
  v_new_team uuid;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  if v_target is null or (v_user_text is null and v_email is null) then
    raise exception 'invalid_request' using detail = 'team_assign: teamRoleId and userId or email required';
  end if;

  if v_user_text is not null then
    begin
      v_user := v_user_text::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_request' using detail = 'team_assign: userId is not a uuid';
    end;
    if not exists (select 1 from auth.users where id = v_user) then
      raise exception 'not_found' using detail = 'no such account';
    end if;
  else
    select count(*)::int, (array_agg(u.id))[1], bool_or(u.email_confirmed_at is not null)
      into v_matches, v_user, v_confirmed
      from auth.users u
     where quote_email_key(u.email) = v_email;
    if v_matches = 0 then
      raise exception 'not_found' using detail = 'no account with that email';
    elsif v_matches > 1 then
      raise exception 'ambiguous_email' using detail = 'more than one account holds that email';
    elsif not v_confirmed then
      raise exception 'not_confirmed' using detail = 'that account has not confirmed its email';
    end if;
  end if;

  if v_target = 'owner' then
    v_new_role := 'admin';
    v_new_team := null;
  else
    begin
      v_role_id := v_target::uuid;
    exception when invalid_text_representation then
      raise exception 'team_role_not_found';
    end;
    select * into v_role from team_roles where id = v_role_id;
    if not found then
      raise exception 'team_role_not_found';
    end if;
    v_new_role := case when v_role.base = 'content' then 'seo' else 'staff' end;
    v_new_team := v_role.id;
  end if;

  insert into profiles (id, role, team_role_id)
  values (v_user, v_new_role::user_role, v_new_team)
  on conflict (id) do update set role = excluded.role, team_role_id = excluded.team_role_id;

  return jsonb_build_object('ok', true, 'userId', v_user, 'role', v_new_role, 'teamRoleId', v_new_team);
end;
$$;

-- Take someone out of the back office: back to an ordinary customer account. Needs a userId (a
-- missing or malformed one is invalid_request, an unknown profile is not_found); the profile guard
-- still refuses removing the last Owner (last_owner).
create or replace function api_team_remove(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user_text text := nullif(btrim(coalesce(p ->> 'userId', '')), '');
  v_user uuid;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  if v_user_text is null then
    raise exception 'invalid_request' using detail = 'team_remove: userId required';
  end if;
  begin
    v_user := v_user_text::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_request' using detail = 'team_remove: userId is not a uuid';
  end;
  update profiles set role = 'customer', team_role_id = null where id = v_user;
  if not found then
    raise exception 'not_found';
  end if;
  return jsonb_build_object('ok', true, 'userId', v_user);
end;
$$;

revoke execute on function api_my_access(jsonb) from public, anon;
revoke execute on function api_team_list(jsonb) from public, anon;
revoke execute on function api_team_assign(jsonb) from public, anon;
revoke execute on function api_team_remove(jsonb) from public, anon;
grant execute on function api_my_access(jsonb) to authenticated, service_role;
grant execute on function api_team_list(jsonb) to authenticated, service_role;
grant execute on function api_team_assign(jsonb) to authenticated, service_role;
grant execute on function api_team_remove(jsonb) to authenticated, service_role;
