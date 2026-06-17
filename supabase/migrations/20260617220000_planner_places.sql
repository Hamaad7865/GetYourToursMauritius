-- Curated places for the AI Road Trip Planner — a free-form, hand-picked set of real Mauritius POIs
-- the co-pilot plans a day around (distinct from per-tour itinerary stops). Public read (shown in the
-- planner), staff write (admin editor). `api_planner_places` returns the camelCase DTO.
-- Seed = 39 web-verified POIs (coords inside Mauritius), curated via multi-agent research.

create table if not exists planner_places (
  id text primary key,               -- kebab-case slug
  name text not null,
  category text not null,            -- Beach | Waterfall | Viewpoint | Nature | Culture | Garden | Island | Market | Landmark | Food
  region text not null,              -- North | South | East | West | Central
  lat numeric(9, 6) not null,
  lng numeric(9, 6) not null,
  duration_min int not null check (duration_min > 0),
  closes_at time,                    -- null = open-access
  blurb text,
  image_url text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists planner_places_region_idx on planner_places (region);
create index if not exists planner_places_position_idx on planner_places (position);

alter table planner_places enable row level security;
grant select on planner_places to anon, authenticated, service_role;
grant insert, update, delete on planner_places to authenticated;
drop policy if exists planner_places_read on planner_places;
create policy planner_places_read on planner_places for select using (true);
drop policy if exists planner_places_staff on planner_places;
create policy planner_places_staff on planner_places for all using (is_staff()) with check (is_staff());

-- Seed the curated set (only when empty, so re-running never duplicates).
insert into planner_places (id, name, category, region, lat, lng, duration_min, closes_at, blurb, position)
select * from (values
  ('grand-baie-beach', 'Grand Baie', 'Beach', 'North', -20.0182, 57.5802, 120, null::time, 'Sheltered bay with an emerald lagoon, powder-white beaches, and the liveliest resort town on the island with vibrant nightlife and water sports.', 0),
  ('pereybere-beach', 'Pereybère Beach', 'Beach', 'North', -19.9991, 57.5887, 120, null::time, 'Popular family-friendly beach with a protected swimming area, soft sand, and close proximity to Grand Baie''s restaurants and amenities.', 1),
  ('trou-aux-biches-beach', 'Trou aux Biches', 'Beach', 'North', -20.05, 57.55, 150, null::time, 'One of the island''s finest beaches, blending seamlessly with Mont Choisy as the longest and most beautiful stretch of white sand on the north coast.', 2),
  ('cap-malheureux-church', 'Cap Malheureux (Notre Dame Auxiliatrice)', 'Landmark', 'North', -19.9842, 57.6142, 60, null::time, 'Iconic red-roofed chapel at the northernmost point of Mauritius, overlooking the Indian Ocean and the five northern islets including Coin de Mire.', 3),
  ('pamplemousses-botanical-garden', 'Sir Seewoosagur Ramgoolam Botanical Garden', 'Garden', 'North', -20.1067, 57.5017, 150, '17:30'::time, 'Lush 37-hectare botanical garden featuring giant water lilies, exotic flora, and serene pathways—one of Mauritius'' most visited attractions.', 4),
  ('maheswarnath-temple', 'Maheswarnath Mandir', 'Culture', 'North', -20.0182, 57.5519, 45, '18:00'::time, 'Mauritius'' largest Hindu temple, built in 1888 and dedicated to Lord Shiva, featuring vibrant architecture and spiritual significance.', 5),
  ('coin-de-mire-island', 'Coin de Mire (Gunner''s Quoin)', 'Island', 'North', -19.9392, 57.6136, 180, null::time, 'Protected uninhabited island 8km north with crystal-clear reef snorkeling, diverse marine life, and a nature reserve with dramatic cliff vistas.', 6),
  ('ilot-gabriel-island', 'Ilot Gabriel', 'Island', 'North', -19.9, 57.61, 300, null::time, 'Pristine 42-hectare protected nature reserve island with unspoiled white-sand beaches, crystal-clear waters, and world-class snorkeling opportunities.', 7),
  ('port-louis-central-market', 'Port Louis Central Market', 'Market', 'North', -20.1628, 57.5007, 90, '18:00'::time, 'Historic Victorian-era market bustling with tropical fruits, fresh seafood, spices, and local crafts—the authentic pulse of Mauritian culture since 1839.', 8),
  ('chamarel-seven-coloured-earth', 'Chamarel Seven Coloured Earth Geopark', 'Nature', 'South', -20.4251, 57.3917, 120, '17:00'::time, 'Geological wonder featuring sand dunes of seven distinct rainbow colors set against tropical forest backdrops, a UNESCO-inspired natural marvel.', 9),
  ('le-morne-brabant', 'Le Morne Brabant', 'Landmark', 'South', -20.4563, 57.3082, 180, null::time, 'UNESCO World Heritage site with a 556-meter basaltic monolith offering panoramic views and cultural significance as a former refuge for escaped slaves.', 10),
  ('chamarel-waterfall', 'Chamarel Waterfall', 'Waterfall', 'South', -20.4208, 57.3958, 90, null::time, 'Mauritius'' tallest waterfall at nearly 100 meters, plunging dramatically from forested basalt cliffs into a lush gorge with accessible viewpoint platforms.', 11),
  ('black-river-gorges-viewpoint', 'Black River Gorges Viewpoint', 'Viewpoint', 'South', -20.381, 57.407, 45, null::time, 'Spectacular panoramic vistas across deep valleys and native forests, offering some of Mauritius'' finest views toward the west coast on clear days.', 12),
  ('rochester-falls', 'Rochester Falls', 'Waterfall', 'South', -20.4992, 57.51, 60, null::time, 'Unique 10-meter waterfall surrounded by distinctive basalt column formations and lush jungle, creating a cinematic landscape near Souillac.', 13),
  ('ebony-forest-reserve', 'Ebony Forest Reserve', 'Nature', 'South', -20.413, 57.396, 150, '17:00'::time, 'Restored endemic forest sanctuary hosting pink pigeons, Mauritius kestrels, and echo parakeets, with guided walks and panoramic forest viewpoints.', 14),
  ('maconde-viewpoint', 'Macondé Viewpoint', 'Viewpoint', 'South', -20.491, 57.371, 30, null::time, 'Clifftop vantage point with dramatic ocean vistas of the Indian Ocean and coastal coves, though strong winds demand careful footing.', 15),
  ('la-vanille-nature-park', 'La Vanille Nature Park', 'Nature', 'South', -20.4985, 57.5626, 180, '17:00'::time, 'Tropical forest reserve home to Nile crocodiles, giant tortoises, lemurs, and exotic wildlife, with guided tours through 3.5 hectares of biodiversity.', 16),
  ('ile-aux-aigrettes', 'Île aux Aigrettes', 'Island', 'South', -20.4172, 57.7267, 120, '16:00'::time, 'Protected coral island reserve off Mahebourg featuring Telfair''s skinks, colorful day geckos, and giant Aldabran tortoises, accessible by guided boat tour.', 17),
  ('belle-mare-beach', 'Belle Mare Beach', 'Beach', 'East', -20.183, 57.774, 120, null::time, 'One of Mauritius''s longest and most tranquil beaches stretching over six kilometers with soft white sand and calm turquoise waters.', 18),
  ('ile-aux-cerfs', 'Île aux Cerfs', 'Island', 'East', -20.272, 57.804, 240, null::time, 'A private island off Trou d''Eau Douce featuring pristine beaches, lagoons, water sports, adventure park, and an 18-hole golf course.', 19),
  ('grand-river-south-east-waterfall', 'Grand River South East Waterfall', 'Waterfall', 'East', -20.28, 57.775, 180, null::time, 'A scenic waterfall where Mauritius''s longest river cascades into the ocean, accessible by a dramatic boat journey through mangrove-lined waters.', 20),
  ('pointe-desny-beach', 'Pointe d''Esny Beach', 'Beach', 'East', -20.427, 57.728, 90, null::time, 'A serene, often-empty white-sand beach on the southeast coast with shallow lagoon waters, ideal for morning walks as the tide recedes.', 21),
  ('bras-deau-national-park', 'Bras d''Eau National Park', 'Nature', 'East', -20.137, 57.733, 180, '16:30'::time, 'A northeast coastal national park with mangrove forests, hiking trails, bird-watching opportunities, and scenic viewpoints overlooking the Indian Ocean.', 22),
  ('trou-deau-douce', 'Trou d''Eau Douce', 'Landmark', 'East', -20.235, 57.794, 120, null::time, 'A charming authentic fishing village and departure point for island excursions, offering traditional Mauritian character with direct boat access to Île aux Cerfs.', 23),
  ('central-flacq-market', 'Central Flacq Market', 'Market', 'East', -20.189, 57.726, 90, '17:00'::time, 'Mauritius''s largest vibrant open-air market bustling with local vendors selling fresh produce, seafood, textiles, and authentic street food, best visited Wednesdays and Sundays.', 24),
  ('la-vallee-de-ferney', 'La Vallée de Ferney', 'Nature', 'East', -20.361, 57.697, 180, '17:00'::time, 'A wildlife reserve and nature sanctuary in the southeast featuring hiking trails, 4x4 tours, bird-watching, and waterfall pools for swimming.', 25),
  ('flic-en-flac-beach', 'Flic-en-Flac Beach', 'Beach', 'West', -20.2667, 57.3667, 180, null::time, 'One of Mauritius''s longest and most beloved beaches, this 8km stretch of golden sand fringed with filaos trees offers excellent swimming, snorkeling, and water sports in crystal-clear turquoise waters.', 26),
  ('le-morne-beach', 'Le Morne Beach', 'Beach', 'West', -20.4517, 57.3133, 180, null::time, 'A stunning beach backed by the iconic UNESCO-listed Le Morne mountain, this picturesque spot is perfect for swimming, snorkeling, windsurfing, and kite-surfing with pristine lagoon views.', 27),
  ('casela-nature-parks', 'Casela Nature & Leisure Park', 'Nature', 'West', -20.2908, 57.4043, 360, '17:00'::time, 'A sprawling 350-hectare wildlife park featuring African savannah animals with thrilling activities including safari drives, zip-lining, lion walking, and camel rides.', 28),
  ('black-river-gorges-national-park', 'Black River Gorges National Park', 'Nature', 'West', -20.4167, 57.4167, 300, null::time, 'Mauritius''s largest national park with over 50km of well-marked hiking trails, waterfalls, lookout points, and preserved forest featuring rare endemic bird species and indigenous plants.', 29),
  ('albion-lighthouse', 'Albion Lighthouse', 'Landmark', 'West', -20.35, 57.5, 60, null::time, 'A striking red-and-white heritage lighthouse built in 1910 standing 46 meters above Pointe-aux-Caves cliffs, offering spectacular views of the west coast and a small museum.', 30),
  ('ile-aux-benitiers', 'Île aux Bénitiers', 'Island', 'West', -20.4161, 57.3372, 240, null::time, 'An uninhabited islet accessible by boat tour from Black River, perfect for snorkeling at nearby Crystal Rock and experiencing pristine lagoon scenery.', 31),
  ('la-route-du-sel', 'La Route du Sel (Tamarin Salt Flats)', 'Culture', 'West', -20.3256, 57.3706, 45, '16:00'::time, 'An 18th-century salt flats heritage site spanning 20 hectares with over 1,600 basins showing traditional sea salt production, offering guided 15-minute tours of the last working salt farm in Mauritius.', 32),
  ('trou-aux-cerfs', 'Trou aux Cerfs', 'Viewpoint', 'Central', -20.3179, 57.5115, 30, null::time, 'A dramatic 100-meter-deep volcanic crater surrounded by lush forest offering panoramic views of the central plateau.', 33),
  ('eureka-house', 'Eureka House', 'Culture', 'Central', -20.2195, 57.5023, 75, '17:00'::time, 'A beautifully preserved 1830s colonial mansion museum with period furnishings, gardens, and nearby Eureka Waterfalls.', 34),
  ('curepipe-botanic-garden', 'Curepipe Botanic Garden', 'Garden', 'Central', -20.3291, 57.5244, 60, '18:00'::time, 'A sprawling 27-acre botanical garden featuring rare palms, a scenic lake, and the world''s rarest palm tree.', 35),
  ('tamarind-falls', 'Tamarind Falls', 'Waterfall', 'Central', -20.3444, 57.4664, 180, null::time, 'A spectacular series of seven cascading waterfalls set in lush mountain scenery requiring a scenic hiking adventure.', 36),
  ('le-pouce-mountain', 'Le Pouce Mountain', 'Viewpoint', 'Central', -20.2167, 57.4833, 180, null::time, 'The third-highest peak in Mauritius offering panoramic views of Port Louis and surrounding plateau countryside.', 37),
  ('pieter-both-mountain', 'Pieter Both Mountain', 'Viewpoint', 'Central', -20.25, 57.52, 240, null::time, 'Mauritius'' second-highest peak featuring a distinctive balanced rock formation at the summit and challenging scramble.', 38)
) as v(id, name, category, region, lat, lng, duration_min, closes_at, blurb, position)
where not exists (select 1 from planner_places);

create or replace function api_planner_places(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'category', category, 'region', region,
    'lat', lat, 'lng', lng, 'durationMin', duration_min,
    'closesAt', to_char(closes_at, 'HH24:MI'), 'blurb', blurb, 'imageUrl', image_url
  ) order by position, name), '[]'::jsonb)
  from planner_places;
$$;
grant execute on function api_planner_places(jsonb) to anon, authenticated, service_role;
