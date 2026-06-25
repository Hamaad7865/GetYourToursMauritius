-- Bell-badge unread count for the notifications feed. Owner-scoped, SECURITY DEFINER seam mirroring
-- api_my_notifications. Returns { count } of the caller's notifications with read_at is null.
create or replace function api_notifications_unread_count(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select count(*)::int into v_count
  from notifications
  where user_id = v_uid and read_at is null;
  return jsonb_build_object('count', v_count);
end;
$$;

revoke execute on function api_notifications_unread_count(jsonb) from public;
grant execute on function api_notifications_unread_count(jsonb) to authenticated;
