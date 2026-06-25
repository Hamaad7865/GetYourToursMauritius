-- Wishlist — cross-device "saved activities" for the signed-in customer.
--
-- Backs GET/POST /api/v1/wishlist and DELETE /api/v1/wishlist/{slug}. Owner-scoped in BOTH RLS
-- (defense in depth) and the api_* seam. The unique(user_id, activity_id) makes re-adding idempotent
-- (POST upserts with `on conflict do nothing`); DELETE is idempotent by construction.

create table wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_id uuid not null references activities (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, activity_id)
);
-- Newest-saved-first reads per user.
create index wishlists_user_idx on wishlists (user_id, created_at desc);

-- The blanket "grant on all tables to authenticated" ran in the original RLS migration, before this
-- table existed, so grant explicitly. RLS still gates every row to its owner.
grant select, insert, delete on wishlists to authenticated;

alter table wishlists enable row level security;
create policy wishlists_select on wishlists for select using (user_id = auth.uid());
create policy wishlists_insert on wishlists for insert with check (user_id = auth.uid());
create policy wishlists_delete on wishlists for delete using (user_id = auth.uid());
create policy wishlists_staff on wishlists for all using (is_staff()) with check (is_staff());

-- GET /wishlist — the caller's saved activities as full TourSummary objects (the SAME shape /activities
-- items use, so the wishlist screen renders identical cards without N extra round-trips), newest-saved
-- first. Reuses the EXACT api_search_activities per-item jsonb mapping. Published only (a saved item that
-- is later unpublished simply stops rendering — never leaks a draft). Owner-scoped DEFINER seam.
create or replace function api_my_wishlist(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(t.item order by t.saved_at desc), '[]'::jsonb) into v_items
  from (
    select w.created_at as saved_at, jsonb_build_object(
      'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
      'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
      'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
      'minAdvanceDays', coalesce(x.min_advance_days, 1),
      'fromPriceEur', case
        when x.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
        else (
          select min(pr.amount_minor)::float / 100
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
        )
      end,
      'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
        select pr.max_guests
        from activity_option_prices pr
        join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = x.id
        order by pr.amount_minor asc nulls last
        limit 1
      ) end,
      'heroImage', (
        select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
        from activity_images img where img.activity_id = x.id order by img.position limit 1
      ),
      'images', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          order by img.position
        )
        from activity_images img where img.activity_id = x.id
      ), '[]'::jsonb)
    ) as item
    from wishlists w
    join activities x on x.id = w.activity_id and x.status = 'published'
    where w.user_id = v_uid
  ) t;
  return v_items;
end;
$$;

-- POST /wishlist {slug} — save an activity (idempotent). Resolves the slug to a PUBLISHED activity
-- (activity_not_found -> 404), then upserts on (user, activity) so re-adding never duplicates. Returns
-- `created` so the route can answer 201 (new) vs 200 (already saved).
create or replace function api_add_wishlist(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := nullif(p ->> 'slug', '');
  v_activity_id uuid;
  v_created boolean;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_slug is null then
    raise exception 'invalid_request: slug is required';
  end if;
  select id into v_activity_id from activities where slug = v_slug and status = 'published';
  if v_activity_id is null then
    raise exception 'activity_not_found';
  end if;
  with ins as (
    insert into wishlists (user_id, activity_id)
    values (v_uid, v_activity_id)
    on conflict (user_id, activity_id) do nothing
    returning 1
  )
  select exists (select 1 from ins) into v_created;
  return jsonb_build_object('slug', v_slug, 'saved', true, 'created', v_created);
end;
$$;

-- DELETE /wishlist/{slug} — remove a saved activity (idempotent: returns saved:false even when the
-- row, or the activity, doesn't exist). No 404 — removal is forgiving by design.
create or replace function api_remove_wishlist(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := nullif(p ->> 'slug', '');
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  delete from wishlists w
   using activities a
   where w.activity_id = a.id and a.slug = v_slug and w.user_id = v_uid;
  return jsonb_build_object('slug', v_slug, 'saved', false);
end;
$$;

revoke execute on function api_my_wishlist(jsonb) from public;
revoke execute on function api_add_wishlist(jsonb) from public;
revoke execute on function api_remove_wishlist(jsonb) from public;
grant execute on function api_my_wishlist(jsonb) to authenticated;
grant execute on function api_add_wishlist(jsonb) to authenticated;
grant execute on function api_remove_wishlist(jsonb) to authenticated;
