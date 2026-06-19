-- Cart & Hold Lifecycle, Task 4: give holds an owner so a leaked hold id can't cancel
-- someone else's reservation, and add an owner-scoped release path.
--
--   1. booking_holds gains a `created_by` owner column.
--   2. create_hold stamps created_by = auth.uid() on INSERT. It is re-applied from its
--      WINNING body (20260719120000_audit_fixes.sql) VERBATIM, changing ONLY the INSERT
--      column list/values — so the occurrence_in_past / occurrence_too_soon / oversell
--      guards are preserved (avoids the migration-revert-drift class). api_create_hold and
--      api_book delegate their INSERT to create_hold, so stamping here covers both paths.
--   3. An owner SELECT RLS policy lets a user read their own holds (the staff policy and the
--      already-enabled RLS on booking_holds are left intact).
--   4. api_release_hold(holdId): owner-or-staff only, idempotent, replaces the revoked
--      ownerless release_hold for the `authenticated` role.

-- 1. Owner column. Nullable: anonymous holds (auth.uid() is null) and pre-existing rows have none.
alter table booking_holds add column if not exists created_by uuid;

-- 2. create_hold: winning body from 20260719120000_audit_fixes.sql, VERBATIM except the INSERT
--    now also sets created_by = auth.uid(). Do not hand-edit the guards below.
create or replace function create_hold(
  p_occurrence_id uuid,
  p_quantity int,
  p_idempotency_key text
)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing booking_holds;
  v_occ session_occurrences;
  v_available int;
  v_hold booking_holds;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity' using detail = 'quantity must be > 0';
  end if;

  select * into v_existing from booking_holds where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_occ from session_occurrences where id = p_occurrence_id for update;
  if not found then
    raise exception 'occurrence_not_found';
  end if;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  if v_occ.starts_at <= now() then
    raise exception 'occurrence_in_past';
  end if;
  -- We don't fulfil same-day bookings: the earliest bookable day is tomorrow (Mauritius local time).
  if v_occ.starts_at < (((now() at time zone 'Indian/Mauritius')::date + 1)::timestamp at time zone 'Indian/Mauritius') then
    raise exception 'occurrence_too_soon';
  end if;

  v_available := v_occ.capacity - used_capacity(p_occurrence_id);
  if p_quantity > v_available then
    raise exception 'insufficient_capacity'
      using detail = format('requested %s, available %s', p_quantity, v_available);
  end if;

  insert into booking_holds (session_occurrence_id, quantity, idempotency_key, created_by)
  values (p_occurrence_id, p_quantity, p_idempotency_key, auth.uid())
  returning * into v_hold;
  return v_hold;
end;
$$;

-- 3. Owner SELECT policy. RLS is already enabled on booking_holds (20260615120800_rls.sql) and the
--    staff-all policy (holds_staff) stays in place; this only ADDS owner read access for Task-5's
--    hold-status endpoint.
drop policy if exists holds_owner_select on booking_holds;
create policy holds_owner_select on booking_holds for select
  using (created_by is not null and created_by = auth.uid());

-- 4. api_release_hold: owner-or-staff, idempotent. Replaces the ownerless release_hold for the
--    authenticated role (release_hold was revoked from authenticated in the audit fixes).
create or replace function api_release_hold(p_hold_id uuid)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold booking_holds;
begin
  select * into v_hold from booking_holds where id = p_hold_id;
  if not found then
    raise exception 'hold_not_found';
  end if;

  if not (is_staff() or (auth.uid() is not null and v_hold.created_by = auth.uid())) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: only an active hold is flipped; an already-released hold is a no-op.
  update booking_holds set status = 'released'
  where id = p_hold_id and status = 'active'
  returning * into v_hold;
  if not found then
    select * into v_hold from booking_holds where id = p_hold_id;
  end if;

  return v_hold;
end;
$$;

revoke execute on function api_release_hold(uuid) from public;
grant execute on function api_release_hold(uuid) to authenticated, service_role;
