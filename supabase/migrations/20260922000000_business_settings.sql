-- 20260922000000_business_settings
--
-- The customer-facing "Chat on WhatsApp" number, editable from the admin Dashboard.
--
-- Every wa.me deep link on the site (the ContactFloat bubble, the footer, booking cards, rental,
-- transfers, the disruption banner, ...) is built by whatsappUrl() in src/lib/seo/site.ts, which
-- until now derived the number from the compile-time constant SITE.phone -- so changing the WhatsApp
-- number meant a code edit + a redeploy. This table lets the owner change it from /admin without a
-- deploy. It is DELIBERATELY only the wa.me number: the displayed phone, the tel: links, the invoice
-- footer and the schema.org business data all stay on SITE.phone, so the WhatsApp number is free to
-- differ from the call number.
--
-- Singleton: `id boolean primary key default true check (id)` -- the primary key plus the check that
-- id is always true means at most one row can ever exist, so a reader does `select ... limit 1` and a
-- writer `update`s without needing to know a key.
--
-- Public read (the number is rendered into every visitor's page), staff write -- the guest_reviews
-- (20260822000000) pattern. A blank/absent number is the app's cue to fall back to SITE.phone, so the
-- wa.me links are never broken; getWhatsAppNumber() (src/lib/settings/whatsapp-number.ts) does that.
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

create table if not exists business_settings (
  id boolean primary key default true check (id),
  -- Stored free-form as typed ("+230 5772 9919"); whatsappUrl() strips it to digits at link time. The
  -- check bounds the DIGIT count to the wa.me/E.164 range (8..15) so a malformed number can never
  -- reach the link builder -- a belt to the admin card's own validation. NULL means "no override, use
  -- the SITE.phone fallback".
  whatsapp_number text
    check (whatsapp_number is null
           or length(regexp_replace(whatsapp_number, '\D', '', 'g')) between 8 and 15),
  updated_at timestamptz not null default now(),
  -- The staff member who last changed it; set null rather than block if that account is later deleted.
  updated_by uuid references profiles (id) on delete set null
);

-- Exactly one row, created idempotently. `on conflict do nothing` so re-running this file (it lives in
-- catch-up.sql) never disturbs a number the owner has already set.
insert into business_settings (id) values (true) on conflict (id) do nothing;

alter table business_settings enable row level security;

-- Public read: the number is shown to every visitor, so anon must be able to select it.
drop policy if exists business_settings_public_read on business_settings;
create policy business_settings_public_read on business_settings for select using (true);

-- Staff write: the same boundary as every other admin mutation. Only UPDATE -- the singleton row
-- already exists and must never be removed or duplicated, so insert/delete stay closed.
drop policy if exists business_settings_staff on business_settings;
create policy business_settings_staff on business_settings for update using (is_staff()) with check (is_staff());

grant select on business_settings to anon, authenticated, service_role;
grant update on business_settings to authenticated;
