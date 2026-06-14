-- Operators, profiles, and the activity catalogue (activities → options → price tiers),
-- plus bilingual translations and images. English is primary (in `activities`);
-- French lives in `activity_translations`.

create table operators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  contact_email text,
  phone text,
  payout_details jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role user_role not null default 'customer',
  phone text,
  created_at timestamptz not null default now()
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators (id) on delete restrict,
  slug text not null unique,
  type activity_type not null default 'activity',
  title text not null,
  summary text,
  description text,
  category activity_category not null,
  location text,
  duration_minutes int check (duration_minutes is null or duration_minutes > 0),
  meeting_point text,
  pickup_available boolean not null default false,
  languages text[] not null default '{}',
  inclusions text[] not null default '{}',
  exclusions text[] not null default '{}',
  highlights text[] not null default '{}',
  cancellation_policy text,
  status activity_status not null default 'draft',
  seo_title text,
  seo_description text,
  rating_avg numeric(2, 1) check (rating_avg is null or (rating_avg >= 0 and rating_avg <= 5)),
  rating_count int not null default 0 check (rating_count >= 0),
  created_at timestamptz not null default now()
);
create index activities_operator_idx on activities (operator_id);
create index activities_category_idx on activities (category);
create index activities_status_idx on activities (status);

create table activity_translations (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities (id) on delete cascade,
  locale content_locale not null,
  title text,
  summary text,
  description text,
  highlights text[] not null default '{}',
  inclusions text[] not null default '{}',
  exclusions text[] not null default '{}',
  meeting_point text,
  seo_title text,
  seo_description text,
  unique (activity_id, locale)
);

create table activity_images (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities (id) on delete cascade,
  url text not null,
  alt text,
  position int not null default 0
);
create index activity_images_activity_idx on activity_images (activity_id);

create table activity_options (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities (id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index activity_options_activity_idx on activity_options (activity_id);

create table activity_option_prices (
  id uuid primary key default gen_random_uuid(),
  activity_option_id uuid not null references activity_options (id) on delete cascade,
  label text not null,
  amount_minor int not null check (amount_minor >= 0),
  currency text not null default 'EUR',
  max_guests int check (max_guests is null or max_guests > 0),
  position int not null default 0
);
create index aop_option_idx on activity_option_prices (activity_option_id);
