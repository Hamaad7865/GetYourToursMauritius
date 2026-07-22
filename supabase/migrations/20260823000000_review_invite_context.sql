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

-- Public feed for the /reviews page merge (guest-reviews-live.ts). Approved only — RLS on
-- guest_reviews already restricts anon to approved rows, but the RPC makes the intent explicit and
-- returns exactly the shape the merge needs, capped so the page can't be made to load thousands.
create or replace function api_list_approved_guest_reviews(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rating', rating, 'body', body, 'customerName', customer_name, 'submittedAt', submitted_at
  ) order by submitted_at desc), '[]'::jsonb)
  from (select * from guest_reviews where status = 'approved' order by submitted_at desc limit 50) g;
$$;

revoke execute on function api_list_approved_guest_reviews(jsonb) from public;
grant execute on function api_list_approved_guest_reviews(jsonb) to anon, authenticated;
