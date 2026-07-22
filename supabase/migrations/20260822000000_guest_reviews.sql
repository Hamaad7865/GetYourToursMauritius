-- Post-trip review requests: a guest-safe (no-login) submission flow gated by a single-use token,
-- with admin moderation before anything is public. On approval, the review is also mirrored into
-- the existing per-activity `reviews` table (user_id = null, an already-supported case — see
-- 20260742000000_reviews.sql) so the specific activity's rating_avg/rating_count benefits too, not
-- just the site-wide /reviews page. See docs/superpowers/specs/2026-07-21-guest-review-requests-design.md.

create table review_invites (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings (id) on delete cascade,
  activity_id uuid not null references activities (id),
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz
);
create index review_invites_token_idx on review_invites (token);

create table guest_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings (id) on delete cascade,
  activity_id uuid not null references activities (id),
  customer_name text not null,
  rating int not null check (rating between 1 and 5),
  body text not null check (char_length(body) >= 5),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references profiles (id)
);
create index guest_reviews_status_idx on guest_reviews (status, submitted_at);

alter table review_invites enable row level security;
alter table guest_reviews enable row level security;

-- No anon/authenticated policy on review_invites at all — reached only through the token-gated RPC
-- below (SECURITY DEFINER bypasses RLS). Staff can see it for support/debugging.
create policy review_invites_staff on review_invites for all using (is_staff()) with check (is_staff());

create policy guest_reviews_staff on guest_reviews for all using (is_staff()) with check (is_staff());
create policy guest_reviews_public_read on guest_reviews for select using (status = 'approved');
-- No insert/update policy for anon/authenticated — writes go through the RPCs below.

-- ── api_submit_guest_review ─────────────────────────────────────────────────────────────────────
-- The real security boundary: the token (not auth.uid(), which guests don't have) proves the caller
-- is the actual customer. Single-use — used_at is set atomically in the same transaction as the
-- insert, so two concurrent requests with the same token can't both succeed.
create or replace function api_submit_guest_review(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(p ->> 'token', '');
  v_rating int := (p ->> 'rating')::int;
  v_name text := nullif(btrim(p ->> 'name'), '');
  v_body text := nullif(btrim(p ->> 'body'), '');
  v_invite review_invites;
  v_review guest_reviews;
begin
  if v_token is null then
    raise exception 'invalid_or_expired_token';
  end if;
  if v_rating is null or v_rating < 1 or v_rating > 5 then
    raise exception 'invalid_request: rating must be 1..5';
  end if;
  if v_name is null then
    raise exception 'invalid_request: name is required';
  end if;
  if v_body is null or char_length(v_body) < 5 then
    raise exception 'invalid_request: body must be at least 5 characters';
  end if;

  select * into v_invite from review_invites where token = v_token for update;
  if v_invite is null or v_invite.used_at is not null or v_invite.expires_at < now() then
    raise exception 'invalid_or_expired_token';
  end if;

  insert into guest_reviews (booking_id, activity_id, customer_name, rating, body)
  values (v_invite.booking_id, v_invite.activity_id, v_name, v_rating, v_body)
  returning * into v_review;

  update review_invites set used_at = now() where id = v_invite.id;

  return jsonb_build_object(
    'id', v_review.id, 'status', v_review.status, 'submittedAt', v_review.submitted_at
  );
end;
$$;

-- ── api_moderate_guest_review ───────────────────────────────────────────────────────────────────
-- Staff-only (checked in-body, since SECURITY DEFINER bypasses RLS). Approve is atomic: publish the
-- guest_reviews row, mirror it into `reviews` (user_id null — an already-supported case), and
-- recompute the activity's rating_avg/rating_count with the SAME logic api_submit_review already
-- uses, so the two insertion paths can never leave the aggregate inconsistent.
create or replace function api_moderate_guest_review(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_action text := p ->> 'action';
  v_review guest_reviews;
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_action not in ('approve', 'reject') then
    raise exception 'invalid_request: action must be approve or reject';
  end if;

  select * into v_review from guest_reviews where id = v_id for update;
  if v_review is null then
    raise exception 'not_found';
  end if;
  if v_review.status <> 'pending' then
    raise exception 'invalid_request: review is not pending';
  end if;

  update guest_reviews
     set status = case when v_action = 'approve' then 'approved' else 'rejected' end,
         moderated_at = now(),
         moderated_by = auth.uid()
   where id = v_id
  returning * into v_review;

  if v_action = 'approve' then
    insert into reviews (activity_id, user_id, author, rating, text, created_at)
    values (v_review.activity_id, null, v_review.customer_name, v_review.rating, v_review.body, v_review.submitted_at);

    update activities a
       set rating_count = sub.cnt,
           rating_avg = case when sub.cnt = 0 then null else round(sub.avg, 1) end
      from (select count(*)::int cnt, avg(rating)::numeric avg from reviews where activity_id = v_review.activity_id) sub
     where a.id = v_review.activity_id;
  end if;

  return jsonb_build_object('id', v_review.id, 'status', v_review.status);
end;
$$;

-- ── api_enqueue_review_invites ──────────────────────────────────────────────────────────────────
-- Service-role only (the maintenance cron). Finds confirmed bookings whose LAST-ending occurrence
-- item crossed "the following day, 9am Mauritius time" and has no invite yet, then creates the
-- invite + the review-request notification in one pass. Mauritius-anchored per
-- docs/handbook/landmines.md — this class of bug has hit this codebase three times before.
create or replace function api_enqueue_review_invites()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_candidate record;
  v_token text;
  v_inserted int;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_candidate in (
    with last_occurrence as (
      select bi.booking_id, so.ends_at, ao.activity_id,
             row_number() over (partition by bi.booking_id order by so.ends_at desc) as rn
      from booking_items bi
      join session_occurrences so on so.id = bi.session_occurrence_id
      join activity_options ao on ao.id = bi.activity_option_id
    )
    select b.id as booking_id, b.customer_email, b.customer_name,
           a.id as activity_id, a.title as activity_title, lo.ends_at
    from bookings b
    join last_occurrence lo on lo.booking_id = b.id and lo.rn = 1
    join activities a on a.id = lo.activity_id
    where b.status = 'confirmed'
      and b.customer_email is not null
      and not exists (select 1 from review_invites ri where ri.booking_id = b.id)
      and ((lo.ends_at at time zone 'Indian/Mauritius')::date + 1 + time '09:00')
            at time zone 'Indian/Mauritius' <= now()
  )
  loop
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    insert into review_invites (booking_id, activity_id, token)
    values (v_candidate.booking_id, v_candidate.activity_id, v_token)
    on conflict (booking_id) do nothing;

    -- A concurrent run may have already created this invite (or a duplicate cron tick, if the
    -- previous run overlapped) — skip the matching notification too, so we never send a review
    -- request pointing at a token nobody actually created.
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      continue;
    end if;

    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_candidate.customer_email, 'review_request',
      jsonb_build_object(
        'token', v_token,
        'activityTitle', v_candidate.activity_title,
        'customerName', v_candidate.customer_name
      ),
      v_candidate.booking_id,
      'review_request:' || v_candidate.booking_id
    )
    on conflict (idempotency_key) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function api_submit_guest_review(jsonb) from public;
revoke execute on function api_moderate_guest_review(jsonb) from public;
revoke execute on function api_enqueue_review_invites() from public;
grant execute on function api_submit_guest_review(jsonb) to anon, authenticated;
grant execute on function api_moderate_guest_review(jsonb) to authenticated;
grant execute on function api_enqueue_review_invites() to service_role;
