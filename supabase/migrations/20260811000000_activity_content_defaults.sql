-- Per-category standard content (spec: docs/superpowers/specs/2026-07-16-activity-content-defaults-design.md).
-- Replaces the two HARDCODED shared-content files (src/lib/content/sightseeing.ts, catamaran.ts) with an
-- admin-editable table, and extends standard content to includes/not-included which never had defaults.
--
-- Scope moves from pricing_mode to CATEGORY. 'Taxi Sightseeing tours' is already its own category (13
-- activities, 12 vehicle-priced), so a per-category set covers it without inferring "is this sightseeing?"
-- from a pricing field. That old rule also swept in Airport transfers (pricing_mode='vehicle') and missed
-- Custom Road Trip (pricing_mode='vehicle_custom'); both are corrected by this change — see the spec's
-- "Scope change: the exact delta".
--
-- Highlights REPLACE the activity's own (unchanged from today); the other four lists MERGE shared-first
-- and dedupe. The seed below reproduces today's live text verbatim, so no page changes by accident.

create table if not exists activity_content_defaults (
  category       text primary key,
  highlights     text[] not null default '{}',
  inclusions     text[] not null default '{}',
  exclusions     text[] not null default '{}',
  what_to_bring  text[] not null default '{}',
  important_info text[] not null default '{}',
  updated_at     timestamptz not null default now()
);

-- RLS copied verbatim from rental_vehicles: public read (the activity page renders it), staff edit.
alter table activity_content_defaults enable row level security;
grant select on activity_content_defaults to anon, authenticated, service_role;
grant insert, update, delete on activity_content_defaults to authenticated;
drop policy if exists activity_content_defaults_read on activity_content_defaults;
create policy activity_content_defaults_read on activity_content_defaults for select using (true);
drop policy if exists activity_content_defaults_staff on activity_content_defaults;
create policy activity_content_defaults_staff on activity_content_defaults for all
  using (is_staff()) with check (is_staff());

-- Seed today's hardcoded content so the live site is unchanged on day one. `do nothing` keeps this
-- idempotent AND never stomps content the owner has since edited in /admin.
insert into activity_content_defaults (category, highlights, important_info) values (
  'Taxi Sightseeing tours',
  ARRAY[
    'Private, air-conditioned vehicle with a professional English-speaking driver-guide — exclusively for your group, never shared.',
    'Door-to-door hotel or port pickup and drop-off anywhere in Mauritius, included in the price.',
    'Flexible morning departure — start your day any time between 7:30 and 9:30 am.',
    'A fully flexible route — add, swap or skip stops on the day to match your pace and interests.',
    'Free first child seat and complimentary bottled water on board.',
    'One fixed, all-in price with no hidden fees — pay securely online and get instant confirmation.'
  ]::text[],
  ARRAY[
    'Entrance fees to attractions, museums, gardens and nature parks are not included in the tour price. Please carry some cash (Mauritian rupees) to pay these on the day — many sites do not accept cards.',
    'Lunch and personal expenses are not included unless stated; your driver-guide is happy to recommend good local spots and stop wherever you like.',
    'Bring sun protection, comfortable walking shoes and swimwear if your route includes a beach or waterfall stop.',
    'Travel times between stops are approximate and depend on traffic and how long you choose to spend at each place.',
    'Modest dress (shoulders and knees covered) is required to enter temples and other places of worship, such as Grand Bassin.'
  ]::text[]
)
on conflict (category) do nothing;

insert into activity_content_defaults (category, what_to_bring, important_info) values (
  'Catamaran cruises',
  ARRAY[
    'Comfortable shoes',
    'Sunglasses',
    'Hat',
    'Swimwear',
    'Change of clothes',
    'Towel',
    'Camera',
    'Sunscreen',
    'Snorkeling gear'
  ]::text[],
  ARRAY[
    'Infants aged 1 to 4 go free of charge.',
    'All food is halal. Vegetarian meals must be requested in advance.',
    'Pickup and drop-off is available if the applicable option is selected.',
    'Public parking is available 60m from the meeting point. Please arrive early to secure a space. Contact our team on WhatsApp for the location.',
    'The itinerary may be adjusted due to weather, sea conditions, tides, or operational requirements for guest safety.',
    'The captain’s decisions regarding navigation, timing, and itinerary adjustments are final and made in the interest of guest safety.',
    'Guests using wheelchairs need to stand briefly to get on and off the shuttle boat, with our crew assisting, to access the catamaran.',
    'For their own comfort and security, guests are kindly requested to keep personal belongings with them at all times. The company cannot be held responsible for any loss, theft, damage, or misplacement of personal items during the tour.'
  ]::text[]
)
on conflict (category) do nothing;

-- Public read for the activity page. Deliberately NOT folded into api_get_activity: that function is
-- huge and re-applied by many migrations, and re-applying it is the documented revert-drift hazard.
-- Returns every row (<=10) keyed by category, so a caller merges client-agnostically.
create or replace function api_content_defaults(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(d.category, jsonb_build_object(
    'highlights', to_jsonb(d.highlights),
    'inclusions', to_jsonb(d.inclusions),
    'exclusions', to_jsonb(d.exclusions),
    'whatToBring', to_jsonb(d.what_to_bring),
    'importantInfo', to_jsonb(d.important_info)
  )), '{}'::jsonb)
  from activity_content_defaults d;
$$;
grant execute on function api_content_defaults(jsonb) to anon, authenticated, service_role;
