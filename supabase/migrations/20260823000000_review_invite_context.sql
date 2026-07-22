-- A minimal, public, token-gated read so the write-a-review page can show "Reviewing: X, on Y" before
-- submission — separate from api_submit_guest_review so a page LOAD never marks a token used.
create or replace function api_review_invite_context(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := nullif(p ->> 'token', '');
  v_invite review_invites;
  v_title text;
  v_starts_at timestamptz;
begin
  if v_token is null then
    return null;
  end if;
  select * into v_invite from review_invites where token = v_token;
  if v_invite is null or v_invite.used_at is not null or v_invite.expires_at < now() then
    return null;
  end if;
  select a.title into v_title from activities a where a.id = v_invite.activity_id;
  select min(so.starts_at) into v_starts_at
    from booking_items bi join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_invite.booking_id;
  return jsonb_build_object('activityTitle', v_title, 'tripDate', v_starts_at);
end;
$$;

revoke execute on function api_review_invite_context(jsonb) from public;
grant execute on function api_review_invite_context(jsonb) to anon, authenticated;
