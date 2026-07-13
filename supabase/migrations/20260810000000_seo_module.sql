-- 20260810000000_seo_module
-- SEO module: a restricted 'seo' role for the hired SEO specialist + database-backed SEO surfaces
-- (page-meta overrides, blog posts, runtime redirects) editable from the admin without a deploy.
--
--  * The 'seo' role sees ONLY content: is_staff() is UNTOUCHED, so bookings, payments, leads,
--    pricing and GDPR tooling stay staff/admin-only — RLS keeps an seo login out server-side even
--    via raw API calls (external contractor => customer PII off-limits).
--  * is_content_editor() compares role::text (NOT the enum literal): Postgres forbids USING a
--    just-added enum value in the same transaction that added it, and catch-up.sql applies as one
--    transaction. Text comparison sidesteps that while staying index-friendly on this tiny table.
--  * Blog posts: DB rows override the code-generated seed posts by slug (merge happens in the app);
--    anon sees published only. Redirects apply at the edge ONLY on otherwise-404 paths.

-- 1) Role value ----------------------------------------------------------------------------------
alter type user_role add value if not exists 'seo';

-- 2) Content-editor guard (parallel to is_staff(); SECURITY DEFINER to avoid policy recursion) ----
create or replace function is_content_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role::text in ('staff', 'admin', 'seo')
  );
$$;

-- 3) seo_meta: per-path title/description/OG overrides for the static public pages ---------------
create table if not exists seo_meta (
  path         text primary key check (path like '/%'),
  title        text check (char_length(title) <= 120),
  description  text check (char_length(description) <= 320),
  og_image_url text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);
alter table seo_meta enable row level security;
grant select on seo_meta to anon, authenticated, service_role;
grant insert, update, delete on seo_meta to authenticated;
drop policy if exists seo_meta_read on seo_meta;
create policy seo_meta_read on seo_meta for select using (true);
drop policy if exists seo_meta_editor on seo_meta;
create policy seo_meta_editor on seo_meta for all
  using (is_content_editor()) with check (is_content_editor());

-- 4) posts: database-backed blog articles (same shape as the generated seed posts) ----------------
create table if not exists posts (
  slug             text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text not null check (char_length(title) between 1 and 200),
  meta_title       text check (char_length(meta_title) <= 120),
  meta_description text check (char_length(meta_description) <= 320),
  excerpt          text,
  read_mins        int not null default 5 check (read_mins between 1 and 60),
  -- [{ heading, paragraphs: [string] }] — matches PostContent.sections in src/lib/content/blog.ts
  sections         jsonb not null default '[]'::jsonb,
  -- [{ q, a }] — matches PostContent.faq
  faq              jsonb not null default '[]'::jsonb,
  hero_image_url   text,
  status           text not null default 'draft' check (status in ('draft', 'published')),
  published_at     date,
  updated_at       timestamptz not null default now(),
  updated_by       uuid default auth.uid()
);
alter table posts enable row level security;
grant select on posts to anon, authenticated, service_role;
grant insert, update, delete on posts to authenticated;
drop policy if exists posts_read on posts;
create policy posts_read on posts for select
  using (status = 'published' or is_content_editor());
drop policy if exists posts_editor on posts;
create policy posts_editor on posts for all
  using (is_content_editor()) with check (is_content_editor());

-- 5) seo_redirects: runtime 301s, applied only on otherwise-404 paths ------------------------------
create table if not exists seo_redirects (
  from_path  text primary key
    check (from_path like '/%' and from_path not like '%?%' and from_path not like '%#%'),
  to_path    text not null check (to_path like '/%'),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (from_path <> to_path)
);
alter table seo_redirects enable row level security;
grant select on seo_redirects to anon, authenticated, service_role;
grant insert, update, delete on seo_redirects to authenticated;
drop policy if exists seo_redirects_read on seo_redirects;
create policy seo_redirects_read on seo_redirects for select using (true);
drop policy if exists seo_redirects_editor on seo_redirects;
create policy seo_redirects_editor on seo_redirects for all
  using (is_content_editor()) with check (is_content_editor());

-- 6) RPCs (repo pattern: jsonb in/out, SECURITY DEFINER, camelCase DTO) ----------------------------

-- Per-path meta override, or null when the page has none.
create or replace function api_seo_meta(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'path', path, 'title', title, 'description', description, 'ogImageUrl', og_image_url
  )
  from seo_meta
  where path = p ->> 'path';
$$;
grant execute on function api_seo_meta(jsonb) to anon, authenticated, service_role;

-- Published post summaries, newest first (for /blog + the sitemap).
create or replace function api_list_posts(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', slug, 'title', title, 'metaTitle', meta_title, 'metaDescription', meta_description,
    'excerpt', excerpt, 'readMins', read_mins, 'heroImageUrl', hero_image_url,
    'datePublished', to_char(coalesce(published_at, updated_at::date), 'YYYY-MM-DD')
  ) order by coalesce(published_at, updated_at::date) desc, slug), '[]'::jsonb)
  from posts
  where status = 'published';
$$;
grant execute on function api_list_posts(jsonb) to anon, authenticated, service_role;

-- One full post. SECURITY DEFINER bypasses RLS, so the published-or-editor gate is re-checked here.
create or replace function api_get_post(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'slug', slug, 'title', title, 'metaTitle', meta_title, 'metaDescription', meta_description,
    'excerpt', excerpt, 'readMins', read_mins, 'sections', sections, 'faq', faq,
    'heroImageUrl', hero_image_url, 'status', status,
    'datePublished', to_char(coalesce(published_at, updated_at::date), 'YYYY-MM-DD')
  )
  from posts
  where slug = p ->> 'slug'
    and (status = 'published' or is_content_editor());
$$;
grant execute on function api_get_post(jsonb) to anon, authenticated, service_role;

-- Redirect target for a missed path, or null. Called only from the 404 catch-all.
create or replace function api_lookup_redirect(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(to_path)
  from seo_redirects
  where from_path = p ->> 'path';
$$;
grant execute on function api_lookup_redirect(jsonb) to anon, authenticated, service_role;

-- 7) Content-editing grants for the seo role -------------------------------------------------------
-- ADDITIVE policies (permissive OR with the existing is_staff() ones) on CONTENT tables only.
-- Deliberately NOT granted: activity_options / activity_option_prices (pricing), categories,
-- session_occurrences (availability), and every booking/payment/lead/profile table.
drop policy if exists activities_content_editor on activities;
create policy activities_content_editor on activities for all
  using (is_content_editor()) with check (is_content_editor());
drop policy if exists activity_translations_content_editor on activity_translations;
create policy activity_translations_content_editor on activity_translations for all
  using (is_content_editor()) with check (is_content_editor());
drop policy if exists activity_images_content_editor on activity_images;
create policy activity_images_content_editor on activity_images for all
  using (is_content_editor()) with check (is_content_editor());
drop policy if exists planner_places_content_editor on planner_places;
create policy planner_places_content_editor on planner_places for all
  using (is_content_editor()) with check (is_content_editor());
