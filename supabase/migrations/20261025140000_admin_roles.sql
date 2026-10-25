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

-- ── 5) Money locks ──────────────────────────────────────────────────────────────────────────────
-- (a) Tables that are nothing but prices: writing needs money.prices. Reads are unchanged — each
--     table keeps its own `_read` policy (public, or published-or-staff).
drop policy if exists aop_staff on activity_option_prices;
create policy aop_staff on activity_option_prices for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists activity_supplements_staff on activity_supplements;
create policy activity_supplements_staff on activity_supplements for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists sightseeing_pricing_staff on sightseeing_pricing;
create policy sightseeing_pricing_staff on sightseeing_pricing for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists planner_pricing_staff on planner_pricing;
create policy planner_pricing_staff on planner_pricing for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists transport_band_pricing_staff on transport_band_pricing;
create policy transport_band_pricing_staff on transport_band_pricing for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists airport_transfer_fare_staff on airport_transfer_fare;
create policy airport_transfer_fare_staff on airport_transfer_fare for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists hotel_transfer_fare_staff on hotel_transfer_fare;
create policy hotel_transfer_fare_staff on hotel_transfer_fare for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists airport_transfer_config_staff on airport_transfer_config;
create policy airport_transfer_config_staff on airport_transfer_config for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists hotel_transfer_config_staff on hotel_transfer_config;
create policy hotel_transfer_config_staff on hotel_transfer_config for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists region_zone_distance_staff on region_zone_distance;
create policy region_zone_distance_staff on region_zone_distance for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

-- Not a fare, but a price INPUT: `zone` picks the airport fare and `region` the hotel-to-hotel band
-- a hotel is priced in, so whoever edits a row here re-prices every transfer to that hotel.
drop policy if exists airport_transfer_hotels_staff on airport_transfer_hotels;
create policy airport_transfer_hotels_staff on airport_transfer_hotels for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

-- (b) Tables that mix prices with fields a worker may edit: RLS cannot split columns, so a trigger
--     refuses a client caller without the permission who CHANGES a price column (update: new value
--     differs; insert: a non-null, non-zero value). Unchanged re-saves pass — the editors send rows
--     back whole. TG_ARGV[0] is the permission, the rest are the guarded columns.
--
--     The INSERT rule is deliberately crude and has limits. It would refuse a column whose NON-price
--     default is non-null and not '0' (a text default such as 'MUR', a boolean, a pricing_mode
--     of 'per_person'), and a numeric rendered as '0.000000' (numeric(18,6) prints its scale, so it
--     is not equal to '0'). Such a column MUST NOT be passed to a trigger that fires on INSERT: a
--     worker creating a new tour or option would be refused. Guard it with an UPDATE-only trigger
--     instead (see the *_money_guard_update triggers below) — there the rule is simply
--     "new value differs from old", which has no such limit.
create or replace function enforce_money_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_perm text := tg_argv[0];
  v_new jsonb;
  v_old jsonb;
  v_col text;
  i int;
begin
  -- Cheap exit first: the Owner, a permitted member and every non-client role (service_role, the
  -- definer functions' owner, migrations) never need the row serialised.
  if current_user not in ('anon', 'authenticated') or has_permission(v_perm) then
    return new;
  end if;
  v_new := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;
  for i in 1 .. tg_nargs - 1 loop
    v_col := tg_argv[i];
    if (tg_op = 'INSERT' and nullif(v_new ->> v_col, '0') is not null)
       or (tg_op = 'UPDATE' and (v_new -> v_col) is distinct from (v_old -> v_col)) then
      raise exception 'forbidden'
        using detail = format('changing %s needs the %s permission', v_col, v_perm);
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function enforce_money_columns() from public, anon, authenticated;
grant execute on function enforce_money_columns() to service_role;

drop trigger if exists activity_options_money_guard on activity_options;
create trigger activity_options_money_guard
  before insert or update on activity_options
  for each row execute function enforce_money_columns(
    'money.prices', 'private_base_minor', 'private_included', 'private_extra_minor');

drop trigger if exists activities_money_guard on activities;
create trigger activities_money_guard
  before insert or update on activities
  for each row execute function enforce_money_columns('money.prices', 'supplement_minor');

drop trigger if exists rental_vehicles_money_guard on rental_vehicles;
create trigger rental_vehicles_money_guard
  before insert or update on rental_vehicles
  for each row execute function enforce_money_columns('money.prices', 'daily_rate_minor', 'deposit_minor');

drop trigger if exists business_settings_money_guard on business_settings;
create trigger business_settings_money_guard
  before insert or update on business_settings
  for each row execute function enforce_money_columns(
    'money.currency', 'charge_currency', 'eur_mur_rate', 'eur_mur_rate_updated_at');

-- Columns that change what a booking costs but MUST stay settable on INSERT (a worker creating a new
-- tour or option sends pricing_mode, the transfer flags and the option's activity_id on INSERT, and
-- none of them is null or '0'). They get UPDATE-only triggers: enforce_money_columns() applies its crude INSERT rule only
-- when tg_op = 'INSERT', so an update-only trigger never sees it — and an update is refused only when
-- the value actually changes. Moving an option to another activity re-prices it (it inherits that
-- activity's pricing_mode and fares).
drop trigger if exists activities_money_guard_update on activities;
create trigger activities_money_guard_update
  before update on activities
  for each row execute function enforce_money_columns(
    'money.prices', 'pricing_mode', 'is_airport_transfer', 'is_hotel_transfer');

drop trigger if exists activity_options_money_guard_update on activity_options;
create trigger activity_options_money_guard_update
  before update on activity_options
  for each row execute function enforce_money_columns('money.prices', 'activity_id');

-- ── 6) Refunds need money.refunds ───────────────────────────────────────────────────────────────
-- Both bodies are the WINNING definitions VERBATIM (20260916000000 and 20261006000000), with exactly
-- one change each: the staff guard also requires has_permission('money.refunds'). Pinned by
-- tests/integration/resolved-function-bodies.test.ts.
create or replace function api_mark_refunded(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid := nullif(p ->> 'bookingId', '')::uuid;
  v_booking bookings;
  v_payment payments;
  v_amount bigint;
  v_reversed int := 0;
  v_reversed_minor bigint := 0;
  v_partial_deposit boolean;
begin
  if not is_staff() or not has_permission('money.refunds') then
    raise exception 'forbidden';
  end if;
  if v_booking_id is null then
    raise exception 'invalid_request' using detail = 'mark_refunded: bookingId required';
  end if;

  select * into v_booking from bookings where id = v_booking_id;
  if not found then
    raise exception 'booking_not_found';
  end if;

  if not exists (select 1 from payments where booking_id = v_booking_id) then
    raise exception 'payment_not_found';
  end if;

  -- THE QUOTE DEPOSIT IS NON-REFUNDABLE. A genuine PARTIAL deposit (0 < deposit_minor < total_minor) is
  -- the first `booking` payments row sized to the deposit — money the guest agreed is forfeit. A
  -- pay-in-full quote (deposit_minor = total_minor) and every ordinary booking (deposit_minor = 0) are
  -- NOT partial, so this is false and every branch below stays byte-for-byte the pre-forfeit behaviour.
  v_partial_deposit := v_booking.deposit_minor > 0 and v_booking.deposit_minor < v_booking.total_minor;

  -- Already handled -> no-op (idempotent: a repeat click must not error, re-reverse or re-email). For an
  -- ordinary booking that is "no row still holds money" (every row reversed, status rolled to
  -- 'refunded'). For a PARTIAL-DEPOSIT booking the forfeit deposit row holds money FOREVER by design, so
  -- that test is never true and the function would re-run on every click; its handled signal is instead
  -- the terminal 'cancelled' this function drives it to below.
  if v_partial_deposit then
    if v_booking.status = 'cancelled' then
      return jsonb_build_object('ok', true, 'alreadyRefunded', true);
    end if;
  elsif not exists (
    select 1 from payments
     where booking_id = v_booking_id
       and (status in ('paid', 'partially_refunded') or paid_minor > refunded_minor)
  ) then
    return jsonb_build_object('ok', true, 'alreadyRefunded', true);
  end if;

  -- Only a booking whose money is actually held may be refunded: the cancel path lands it in
  -- refund_pending (payment_state stays paid), or staff refund a confirmed/completed paid booking
  -- directly. Anything else (unpaid, draft, already cancelled with no money) is rejected. The payment
  -- half of the gate is the `not exists` above - a pending sibling row must not veto the refund.
  if v_booking.status not in ('refund_pending', 'confirmed', 'completed') then
    raise exception 'not_refundable'
      using detail = format('booking %s', v_booking.status);
  end if;

  -- Reverse the full outstanding (paid - already-refunded) amount of EVERY row that still holds money,
  -- oldest first, so the booking-level roll-up inside append_payment_event only reaches 'refunded' on
  -- the last one. append_payment_event derives the refunded state from the SUM of refund events.
  --
  -- EXCEPT the non-refundable deposit. A partial-deposit booking's deposit is its single `booking` row
  -- (the balance is a distinct 'balance' purpose, a pickup supplement a distinct 'pickup_addon'), so
  -- `not (v_partial_deposit and purpose = 'booking')` keeps the deposit while still reversing the
  -- balance and any supplement. For a non-partial booking the flag is false and the WHERE is unchanged.
  for v_payment in
    select * from payments
     where booking_id = v_booking_id
       and (status in ('paid', 'partially_refunded') or paid_minor > refunded_minor)
       and not (v_partial_deposit and purpose = 'booking')
     order by created_at
  loop
    v_amount := greatest(v_payment.paid_minor - v_payment.refunded_minor, 0);
    if v_amount > 0 then
      -- Record through the SAME path the webhook uses. The synthesised provider_event_id makes it
      -- idempotent at the ledger: a second call with the same id hits the
      -- (payment_id, provider_event_id, type) conflict and is a no-op, so the booking_refunded enqueue
      -- (which also guards old.status is distinct from 'refunded') never double-fires.
      perform append_payment_event(
        v_payment.id,
        'refunded',
        'manual:refund:' || v_payment.id::text,
        v_amount,
        now(),
        jsonb_build_object('source', 'admin_mark_refunded', 'bookingId', v_booking_id)
      );
      v_reversed := v_reversed + 1;
      v_reversed_minor := v_reversed_minor + v_amount;
    end if;
  end loop;

  -- FORFEIT FINALISATION (partial deposit only). append_payment_event cannot drive this booking terminal
  -- — the kept deposit row keeps the roll-up at 'paid', so status would sit in refund_pending forever.
  -- Drive it to the honest terminal state, kill the durable balance link, and send the forfeit notice.
  if v_partial_deposit then
    -- 'cancelled', NOT 'refunded': the trip is off and the deposit is KEPT, so "refunded" would be a
    -- false claim and would fire booking_refunded. 'cancelled' also fails resolveBalanceForToken's
    -- status='confirmed' gate, so the durable balance link is dead even though refunding the balance
    -- rebounds balance_due_minor 0 -> balance. (Guarded on status so a re-run is a clean no-op; the
    -- alreadyRefunded return above already short-circuits before here, this is belt-and-braces.)
    update bookings set status = 'cancelled', updated_at = now()
     where id = v_booking_id and status <> 'cancelled';

    -- Clear the balance link's CREDENTIAL too, so it is dead at the token, not only via the status gate.
    -- ONLY balance_token_hash — never token_hash, which is the guest's original quote/deposit link and
    -- their route to their own booking record.
    update quotes set balance_token_hash = null, updated_at = now()
     where booking_id = v_booking_id and balance_token_hash is not null;

    -- The guest's FORFEIT notice — the ONE email they get (the 'cancelled' transition mails no guest).
    -- refundedMinor tells the copy whether any balance was returned (both-paid) or not (deposit-only).
    -- Keyed on the booking id + the alreadyRefunded guard above, so a repeat click cannot double-send.
    if v_booking.customer_email is not null then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', v_booking.customer_email, 'deposit_forfeited',
        jsonb_build_object(
          'ref', v_booking.ref, 'customerName', v_booking.customer_name,
          'depositMinor', v_booking.deposit_minor, 'refundedMinor', v_reversed_minor,
          'currency', v_booking.currency
        ),
        v_booking_id, 'deposit_forfeited:' || v_booking_id
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'paymentsReversed', v_reversed);
end;
$$;

revoke execute on function api_mark_refunded(jsonb) from public, anon;
grant execute on function api_mark_refunded(jsonb) to authenticated, service_role;

create or replace function api_record_change_refund(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req_id uuid := nullif(p ->> 'requestId', '')::uuid;
  v_req booking_change_requests;
  v_payment payments;
  v_amount bigint;
begin
  if not is_staff() or not has_permission('money.refunds') then
    raise exception 'forbidden';
  end if;
  if v_req_id is null then
    raise exception 'invalid_request' using detail = 'record_change_refund: requestId required';
  end if;

  select * into v_req from booking_change_requests where id = v_req_id for update;
  if not found then
    raise exception 'change_request_not_found';
  end if;
  if v_req.applied_at is null then
    raise exception 'change_not_applied';
  end if;
  if v_req.difference_minor >= 0 then
    raise exception 'no_refund_due';
  end if;
  -- Idempotent: a repeat click must not error or reverse a second time.
  if v_req.refunded_at is not null then
    return jsonb_build_object('ok', true, 'alreadyRecorded', true);
  end if;

  v_amount := -v_req.difference_minor;

  -- Reverse against the row that actually holds the guest's money for the booking itself. Scoped to
  -- purpose 'booking' on purpose: an unscoped "newest payment" would pick the change/pickup add-on row
  -- and reverse the wrong money, which is the exact shape of an earlier bug in this schema.
  select * into v_payment from payments
   where booking_id = v_req.booking_id and purpose = 'booking'
     and paid_minor > refunded_minor
   order by created_at
   limit 1;
  if not found then
    raise exception 'payment_not_found';
  end if;

  v_amount := least(v_amount, v_payment.paid_minor - v_payment.refunded_minor);
  if v_amount <= 0 then
    raise exception 'no_refund_due';
  end if;

  perform append_payment_event(
    v_payment.id,
    'refunded',
    'change:refund:' || v_req.id::text,
    v_amount,
    now(),
    jsonb_build_object('source', 'admin_change_refund', 'requestId', v_req.id)
  );

  update booking_change_requests set refunded_at = now(), updated_at = now() where id = v_req.id;

  perform notify_booking_change_refunded(v_req.id);

  return jsonb_build_object('ok', true, 'refundedMinor', v_amount);
end;
$$;

revoke execute on function api_record_change_refund(jsonb) from public, anon;
grant execute on function api_record_change_refund(jsonb) to authenticated, service_role;

-- ── 6b) Staff cannot rewrite a booking's deposit, balance or add-on amounts ─────────────────────
-- bookings_staff is `for all using (is_staff())`, so enforce_booking_admin_update (BEFORE UPDATE) is the
-- only thing between a bookings-only staff member and a hand-rolled PATCH of the row. It pinned the
-- money columns that existed in June 2026 and none added since. deposit_minor is the dangerous one:
-- 0 < deposit_minor < total_minor makes api_mark_refunded treat the paid `booking` row as the
-- NON-REFUNDABLE deposit — it reverses nothing and emails the guest deposit_forfeited — so
-- money.refunds would guard the front door while this stood open. The browser only ever writes
-- `status` and `notes` on bookings (src/lib/admin/bookings.ts), so nothing legitimate loses a write.
-- The body is the WINNING definition VERBATIM (20260617120400_booking_cancel_refund) plus exactly
-- these `new.<col> := old.<col>` pins, in the same caller condition (anon/authenticated only: the
-- owner, service_role and the SECURITY DEFINER RPCs that legitimately write these are untouched).
-- `create or replace` keeps the existing bookings_admin_update_guard trigger bound; none is re-created.
-- Pinned by tests/integration/resolved-function-bodies.test.ts.
create or replace function enforce_booking_admin_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new; -- service_role / owner / SECURITY DEFINER RPCs (webhook, create_booking)
  end if;

  -- Immutable from a browser session — owned by the booking/ledger RPCs.
  new.payment_state           := old.payment_state;
  new.total_minor             := old.total_minor;
  new.agency_commission_minor := old.agency_commission_minor;
  new.operator_payout_minor   := old.operator_payout_minor;
  new.currency                := old.currency;
  new.ref                     := old.ref;
  new.idempotency_key         := old.idempotency_key;
  new.user_id                 := old.user_id;
  new.customer_name           := old.customer_name;
  new.customer_email          := old.customer_email;
  new.customer_phone          := old.customer_phone;
  new.source                  := old.source;
  new.created_at              := old.created_at;
  new.deposit_minor           := old.deposit_minor;
  new.balance_due_minor       := old.balance_due_minor;
  new.transport_minor         := old.transport_minor;
  new.supplement_minor        := old.supplement_minor;
  new.supplement_qty          := old.supplement_qty;
  new.child_seats             := old.child_seats;

  -- A cancel on a paid booking becomes a refund_pending (money is owed back).
  if new.status = 'cancelled' and old.payment_state in ('paid', 'partially_refunded') then
    new.status := 'refund_pending';
  end if;

  -- Status may only move through the operational transitions staff are allowed to make.
  if new.status is distinct from old.status then
    if not (
      (new.status = 'completed' and old.status = 'confirmed') or
      (new.status = 'cancelled' and old.status in ('draft', 'held', 'payment_pending', 'confirmed')) or
      (new.status = 'refund_pending' and old.status = 'confirmed')
    ) then
      raise exception 'forbidden_booking_status_transition'
        using detail = format('%s -> %s', old.status, new.status);
    end if;
  end if;

  return new;
end;
$$;

-- ── 7) Backfill: the existing seo account(s) keep exactly what they had ─────────────────────────
insert into team_roles (name, description, base, permissions)
select 'Content',
       'Tour pages, places, SEO, blog and redirects. Never sees guests or money.',
       'content',
       content_permission_catalogue()
 where not exists (select 1 from team_roles where lower(btrim(name)) = 'content');

-- Only a content-base role named Content qualifies: a hand-made team-base "Content" role would
-- otherwise abort this whole transaction with team_role_mismatch; here the UPDATE is a no-op instead.
-- If the built-in role is renamed or deleted, a rerun re-creates it (by design).
update profiles
   set team_role_id = (select id from team_roles where lower(btrim(name)) = 'content' and base = 'content')
 where role::text = 'seo' and team_role_id is null;
