-- Atomic admin writes. Three SECURITY DEFINER, staff-only RPCs that wrap operations the admin client
-- used to orchestrate as several separate browser calls. A failure mid-sequence could leave partial
-- state (a category order with duplicate positions; an activity with capacity enabled but no slots, or
-- slots still bookable after "stop availability"). Each RPC runs in one transaction, so it fully
-- succeeds or fully rolls back. Logic is otherwise identical to the previous client orchestration.

-- 1) Category reorder — swap two categories' positions atomically (was two separate UPDATEs).
create or replace function api_swap_category_positions(p_id_a uuid, p_id_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos_a int;
  v_pos_b int;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  select position into v_pos_a from categories where id = p_id_a;
  if not found then raise exception 'category_not_found'; end if;
  select position into v_pos_b from categories where id = p_id_b;
  if not found then raise exception 'category_not_found'; end if;
  -- categories.position has no unique constraint, so a direct two-row swap is safe.
  update categories set position = v_pos_b where id = p_id_a;
  update categories set position = v_pos_a where id = p_id_b;
end;
$$;
revoke execute on function api_swap_category_positions(uuid, uuid) from public;
grant execute on function api_swap_category_positions(uuid, uuid) to authenticated, service_role;

-- 2) Enable/raise daily capacity — update the activity, propagate to upcoming slots, and materialize
--    the open-ended window, all in one transaction (was three sequential client writes).
create or replace function set_daily_capacity_atomic(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id uuid := nullif(p ->> 'activityId', '')::uuid;
  v_capacity int := (p ->> 'capacity')::int;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_activity_id is null or v_capacity is null or v_capacity < 0 then
    raise exception 'invalid_request';
  end if;

  update activities set daily_capacity = v_capacity where id = v_activity_id;

  update session_occurrences so
     set capacity = v_capacity
    from activity_options o
   where so.activity_option_id = o.id
     and o.activity_id = v_activity_id
     and so.starts_at >= now();

  -- materialize_availability is itself staff/service-role gated; called from this staff frame it passes.
  perform materialize_availability(jsonb_build_object('activityId', v_activity_id::text));
end;
$$;
revoke execute on function set_daily_capacity_atomic(jsonb) from public;
grant execute on function set_daily_capacity_atomic(jsonb) to authenticated, service_role;

-- 3) Stop availability — clear capacity, CLOSE future slots that have a booking/active hold (keep the
--    row + its booking intact), DELETE empty future slots — all in one transaction.
create or replace function stop_availability_atomic(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id uuid := nullif(p ->> 'activityId', '')::uuid;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_activity_id is null then
    raise exception 'invalid_request';
  end if;

  update activities set daily_capacity = null where id = v_activity_id;

  -- Close future slots with a booking item OR an active hold (never strand a confirmed booking / live hold).
  update session_occurrences so
     set status = 'closed'
    from activity_options o
   where so.activity_option_id = o.id
     and o.activity_id = v_activity_id
     and so.starts_at >= now()
     and (
       exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
       or exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active')
     );

  -- Delete empty future slots (no booking, no active hold).
  delete from session_occurrences so
   using activity_options o
   where so.activity_option_id = o.id
     and o.activity_id = v_activity_id
     and so.starts_at >= now()
     and not exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
     and not exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active');
end;
$$;
revoke execute on function stop_availability_atomic(jsonb) from public;
grant execute on function stop_availability_atomic(jsonb) to authenticated, service_role;
