-- Reviews: link a review to its author (auth.users), gate submission behind a real booking, and keep
-- the activity's rating aggregate in sync. Public read of all reviews is preserved (the detail page
-- needs it); a user may only insert/own their own row (RLS), and the booking gate + rating recompute
-- live in the SECURITY DEFINER api_submit_review.

alter table reviews add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists reviews_user_idx on reviews (user_id);
-- One review per (activity, signed-in user); legacy free-text rows (user_id null) are unaffected.
create unique index if not exists reviews_user_activity_uniq
  on reviews (activity_id, user_id) where user_id is not null;

-- Reviews are inserted ONLY through the SECURITY DEFINER api_submit_review below (which enforces the
-- booking gate and sets user_id = auth.uid()). Do NOT add a direct-insert RLS policy: 20260617120100
-- dropped reviews_insert precisely to close the review-forgery hole (F12), and a `with check
-- (user_id = auth.uid())` policy would still let a user post a review for an activity they never booked
-- (the booking gate lives in the RPC, not the policy). Keep it dropped — the RPC bypasses RLS, staff
-- insert via reviews_staff. Public read is unchanged.
drop policy if exists reviews_insert on reviews;

-- POST /activities/{slug}/reviews — booking-gated submission. 404 unknown slug, 403 if the caller has no
-- confirmed/completed booking for the activity. Upserts one review per (user, activity), then recomputes
-- activities.rating_avg / rating_count from the reviews table.
create or replace function api_submit_review(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := nullif(p ->> 'slug', '');
  v_rating int := (p ->> 'rating')::int;
  v_text text := nullif(btrim(p ->> 'text'), '');
  v_activity_id uuid;
  v_author text;
  v_review reviews;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_slug is null then
    raise exception 'invalid_request: slug is required';
  end if;
  if v_rating is null or v_rating < 1 or v_rating > 5 then
    raise exception 'invalid_request: rating must be 1..5';
  end if;
  select id into v_activity_id from activities where slug = v_slug;
  if v_activity_id is null then
    raise exception 'activity_not_found';
  end if;
  -- Booking gate: a confirmed/completed booking for this activity by the caller.
  if not exists (
    select 1
    from bookings b
    join booking_items bi on bi.booking_id = b.id
    join activity_options ao on ao.id = bi.activity_option_id
    where b.user_id = v_uid
      and ao.activity_id = v_activity_id
      and b.status in ('confirmed', 'completed')
  ) then
    raise exception 'forbidden';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Traveller') into v_author from profiles where id = v_uid;
  v_author := coalesce(v_author, 'Traveller');

  insert into reviews (activity_id, user_id, author, rating, text)
  values (v_activity_id, v_uid, v_author, v_rating, v_text)
  on conflict (activity_id, user_id) where user_id is not null
  do update set rating = excluded.rating, text = excluded.text, author = excluded.author, created_at = now()
  returning * into v_review;

  update activities a
  set rating_count = sub.cnt,
      rating_avg = case when sub.cnt = 0 then null else round(sub.avg, 1) end
  from (select count(*)::int cnt, avg(rating)::numeric avg from reviews where activity_id = v_activity_id) sub
  where a.id = v_activity_id;

  return jsonb_build_object(
    'id', v_review.id, 'author', v_review.author, 'rating', v_review.rating,
    'text', v_review.text, 'createdAt', v_review.created_at
  );
end;
$$;

-- GET /account/reviews — the caller's own reviews, newest first, paginated.
create or replace function api_my_reviews(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_page_size int := least(greatest(coalesce((p ->> 'pageSize')::int, 20), 1), 100);
  v_items jsonb;
  v_total int;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  with mine as (
    select r.id, r.rating, r.text, r.created_at, a.slug as activity_slug, a.title as activity_title
    from reviews r
    join activities a on a.id = r.activity_id
    where r.user_id = v_uid
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'activitySlug', m.activity_slug, 'activityTitle', m.activity_title,
        'rating', m.rating, 'text', m.text, 'createdAt', m.created_at
      ) order by m.created_at desc)
      from (select * from mine order by created_at desc limit v_page_size offset (v_page - 1) * v_page_size) m
    ), '[]'::jsonb),
    (select count(*)::int from mine)
  into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

revoke execute on function api_submit_review(jsonb) from public;
revoke execute on function api_my_reviews(jsonb) from public;
grant execute on function api_submit_review(jsonb) to authenticated;
grant execute on function api_my_reviews(jsonb) to authenticated;
