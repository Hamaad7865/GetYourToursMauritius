-- ============================================================================
-- CATALOGUE RECOVERY — re-seed the 32 base activities after a schema rebuild.
-- Operator-agnostic (looks the operator up by slug, so no hardcoded-UUID FK error).
-- Idempotent: skips any activity slug that already exists. Activities come back as DRAFT;
-- publish them in /admin (or run the optional publish line at the bottom).
-- ============================================================================

-- 0) Make sure the operator exists (a setup.sql install already seeded it; then this is a no-op).
insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')
  on conflict (slug) do nothing;

-- AUTO-GENERATED catalogue seed for Belle Mare Tours (operator bb34e08d-d570-491e-8ff6-ca9d401b2a82).
-- 32 activities (visitemaurice + competitor sightseeing gaps), created as DRAFT, idempotent (skips existing slugs).
-- Apply in the Supabase SQL editor or via db-exec. Review & publish from /admin afterwards.

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='casela-world-of-adventures') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'casela-world-of-adventures', 'Casela World of Adventures', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'Day trip to Casela World of Adventures, a 14-hectare nature and leisure park with safaris, zip lines, walking with lions and family activities.', 'Welcome to the adventure world of Casela. Join us for an unforgettable day filled with activities for the whole family! Discover a 14-hectare park that opened its doors in 1979 and is currently home to 1,500 birds, lions, zebras, giant tortoises, monkeys, a tiger and many other animals. Visit the dry forest with its century-old trees like the Black Ebony and let your children have fun at the educational farm or our fishing ponds. Enjoy the natural beauty of Mauritius with a Quad, Buggy, Segway, or embark on an adventurous hike featuring several zip lines, including the longest zip line in the Indian Ocean, suspension bridges and many other surprises, or go for a walk with real lions. For our youngest guests, for those young at heart, for those who need time to disconnect from the bustling city life, and for those wanting to spice up their vacation with a bit of action, the Casela nature and leisure park offers something for everyone! Prices are per vehicle and not per person.', 'Western region. Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius.', 480, true, false, 0, ARRAY['14-hectare park with 1,500 animals (birds, lions, zebras, giant tortoises, monkeys, tiger)', 'Dry forest with century-old Black Ebony trees', 'Educational farm', 'Fishing ponds', 'Quad, Buggy and Segway activities', 'Hiking with zip lines (longest in the Indian Ocean)', 'Suspension bridges', 'Walk with real lions']::text[], ARRAY['Full day transport to all the mentioned sites', 'Visit to Casela World of Adventures park', 'Pick-up and drop-off at all parts of the island']::text[], ARRAY['Admission tickets to the park', 'Lunch (driver can recommend restaurants)', 'Wear comfortable shoes', 'Bring sun protection']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 6000, 'EUR', 4, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/header-lion-safari.jpg', 'Casela World of Adventures', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/casela-world-of-adventures-double-tyrolienne-ile-maurice.jpg', 'Casela World of Adventures', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Walk-with-Lions-Mauritius-1.jpg', 'Casela World of Adventures', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/archway-safari-2.jpg', 'Casela World of Adventures', 3),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/samy-mounichy-MZCwclZC1e4-unsplash-scaled.jpg', 'Casela World of Adventures', 4),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/ricardo-marques-7oG6cBJYHx4-unsplash.jpg', 'Casela World of Adventures', 5),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/seawalk-1.jpg', 'Casela World of Adventures', 6),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/sebastian-pena-lambarri-YV593oyMKmo-unsplash.jpg', 'Casela World of Adventures', 7);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='la-vallee-des-couleurs-nature-park-2') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'la-vallee-des-couleurs-nature-park-2', 'La Vallée des Couleurs Nature Park', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'Day trip to La Vallée des Couleurs nature park, with its 23-coloured earth, four waterfalls, native wildlife and flora in southern Mauritius.', 'Nature lovers will find this destination appealing, offering a unique experience with indigenous wildlife and flora. The park features diverse landscapes including plateaus, mountains, valleys, craters and crater lakes. An exhibition room and fern garden showcase native flowers such as Trochetia and Banané Bouquet. Wildlife includes tortoises, monkeys, deer, fish and birds such as the Pink Pigeon and the Paille-en-Queue. Endemic trees (Ebony, Rattan Wood, Takamaka) enhance the scenery. Four waterfalls — Vacoas, Rattan Wood, Angel Hair and Chamouzé — offer relaxation spots. The main attraction is the earth with 23 distinct colours, originating from the Bassin Blanc volcano eruption millions of years ago.', 'Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius. Park located in the southern region.', 420, true, false, 0, ARRAY['23-coloured earth formation', 'Four waterfalls (Vacoas, Rattan Wood, Angel Hair, Chamouzé)', 'Exhibition room', 'Fern garden with native flowers', 'Wildlife viewing (tortoises, monkeys, deer, birds)', 'Endemic tree species (Ebony, Rattan Wood, Takamaka)', 'South Coast panoramic views']::text[], ARRAY['Full day transport to all the mentioned sites', 'Pick-up and drop-off across the island']::text[], ARRAY['Admission tickets', 'Lunch', 'Guide services']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 6000, 'EUR', 4, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/quad-riding1.jpg', 'La Vallée des Couleurs Nature Park', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/zipline-1.jpg', 'La Vallée des Couleurs Nature Park', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/the-coloured-earth.jpg', 'La Vallée des Couleurs Nature Park', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/quad-riding3.jpg', 'La Vallée des Couleurs Nature Park', 3),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/quad-riding2.jpg', 'La Vallée des Couleurs Nature Park', 4);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='shopping-tour') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'shopping-tour', 'Shopping Tour', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'Half-day or full-day shopping tour through Port Louis, Curepipe and Floréal, taking in arts and crafts, luxury boutiques, department stores and markets.', 'All day or half a day: Shopping in Mauritius can be a wonderful experience. Traditional arts and crafts, as well as the finest luxury products, can be found in various shopping centres and boutiques. There are also several department stores offering very attractive prices and vibrant markets where you can truly experience the rhythm of life in Mauritius. During this visit, you will have the opportunity to explore many places in an interesting day: Port-Louis, Curepipe and Floréal. Prices are per vehicle and not per person.', 'Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius. Pick-up and drop-off at all parts of the island.', null, true, false, 0, ARRAY['Port-Louis (North West region)', 'Curepipe (Centre region)', 'Floréal (Centre region)']::text[], ARRAY['Full day transport to all the mentioned sites above', 'Pick-up and drop-off at all parts of the island']::text[], ARRAY['Admission tickets', 'Lunch / meals (driver can recommend restaurants)']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 6000, 'EUR', 4, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-minan1398-1093837.jpg', 'Shopping Tour', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-orlovamaria-4940756.jpg', 'Shopping Tour', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/ricardo-marques-7oG6cBJYHx4-unsplash.jpg', 'Shopping Tour', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/veegish-ramdani-TE-z3OJv-54-unsplash.jpg', 'Shopping Tour', 3),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/miguel-alcantara--UJDezBpAq0-unsplash-scaled.jpg', 'Shopping Tour', 4);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='speed-boat-ile-aux-cerfs') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'speed-boat-ile-aux-cerfs', 'Speed Boat – Ile Aux Cerfs', 'activity', 'Île aux Cerfs', 'per_person', 'draft', 'A full-day speedboat trip to Île aux Cerfs with turquoise lagoons, the Grande Rivière Sud Est waterfall, a BBQ lunch on Îlot Mangénie and optional water activities.', 'Enjoy an unforgettable experience with a boat trip to Île aux Cerfs. Discover and marvel at the stunning landscapes of the turquoise lagoons on the East Coast while relaxing on the fine sandy beach. Don''t miss the chance to visit the spectacular Grande Rivière Sud Est waterfall and savor a delicious lunch on Îlot Mangénie. Also take advantage of the numerous water activities available to enhance your day, such as parasailing, banana boat rides, buoy rides, or water skiing. A day full of adventures and unforgettable memories awaits you on this paradise island.', 'Departure / boarding point near Île aux Cerfs (directions on Google Maps). Operator: Belle Mare Tours Ltd., Royal Road, Belle Mare, Mauritius.', 480, true, false, 0, ARRAY['Île aux Cerfs (Eastern Region)', 'BBQ lunch on Îlot Mangénie (Eastern Region)', 'Grande Rivière Sud Est (G.R.S.E) waterfall', 'Turquoise lagoons of the East Coast and fine sandy beaches']::text[], ARRAY['BBQ lunch with salads, garlic butter bread, chicken, fish, sausage', 'Drinks: water, Coke, beer, wine, local rum', 'Flaming banana dessert', 'Pick-up and drop-off at all parts of the island']::text[], ARRAY['Transport is arranged separately at additional cost', 'Water activities (parasailing, banana boat rides, buoy rides, water skiing) are optional/additional', 'Please do not drink if you are going to drive', 'Arrive at the boarding point at least 15 minutes before cruise start time']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 4000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Bellemare-tour-31.jpg', 'Speed Boat – Ile Aux Cerfs', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Speed_-boat.jpg', 'Speed Boat – Ile Aux Cerfs', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/speed-boat.jpg', 'Speed Boat – Ile Aux Cerfs', 2);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='the-blue-cruise-ile-aux-cerfs-5-islands-visit') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'the-blue-cruise-ile-aux-cerfs-5-islands-visit', 'The Blue Cruise – Ile Aux Cerfs (5 Islands Visit)', 'activity', 'Île aux Cerfs', 'per_person', 'draft', 'A full-day speedboat excursion from Trou d''Eau Douce taking in the GRSE waterfall, snorkeling among coral gardens, five islands, a BBQ lunch and the beaches of northern Île aux Cerfs.', 'This speedboat excursion from Trou d''Eau Douce promises a total escape. Your adventure begins with the discovery of the majestic Grande Rivière Sud-Est waterfall, a breathtaking natural spectacle. Next, dive into a true natural aquarium during a snorkeling session. Explore coral gardens and swim among vibrant tropical fish. Continue your journey through the hidden gems of the coast: Île aux Aigrettes, Île aux Prison, and Île aux Phare. Each stop offers its share of surprises, from fascinating stories to pristine landscapes. The highlight of the day? A delicious BBQ lunch in an idyllic setting on the southern part of Île aux Cerfs. Savor local flavors with your feet in the sand, gently caressed by the sea breeze. To end this magical day, relax on the paradisiacal beaches of northern Île aux Cerfs, where the turquoise lagoon invites you to swim and unwind.', 'Departure / boarding point at Trou d''Eau Douce (directions on Google Maps). Operator: Belle Mare Tours Ltd., Royal Road, Belle Mare, Mauritius.', 480, true, false, 0, ARRAY['Grande Rivière Sud-Est (GRSE) waterfall', 'Snorkeling among coral gardens and tropical fish at Eau Bleue', 'Île aux Aigrettes (Southeast Region)', 'Île aux Prison (Southeast Region)', 'Île Phare / Île aux Phare (Southeast Region)', 'BBQ lunch on the southern part of Île aux Cerfs', 'Beaches of northern Île aux Cerfs and the turquoise lagoon']::text[], ARRAY['Lunch and drinks', 'BBQ lunch with salads, garlic butter bread, chicken, fish, sausage', 'Drinks: water, Coke, beer, wine, local rum', 'Flaming banana dessert', 'Snorkeling session', 'Visit to five islands', 'Pick-up and drop-off at all parts of the island']::text[], ARRAY['Please do not drink if you are going to drive', 'Arrive at the boarding point at least 15 minutes before cruise start time']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 6500, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/11174200_966568543362218_8577686186521856933_o.jpg', 'The Blue Cruise – Ile Aux Cerfs (5 Islands Visit)', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/big-island-snorkel-spots.jpg', 'The Blue Cruise – Ile Aux Cerfs (5 Islands Visit)', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/IMG-20230725-WA0002.jpg', 'The Blue Cruise – Ile Aux Cerfs (5 Islands Visit)', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Bellemare-tour-14.jpg', 'The Blue Cruise – Ile Aux Cerfs (5 Islands Visit)', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='catamaran-cruise-ile-aux-cerfs') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'catamaran-cruise-ile-aux-cerfs', 'Catamaran Cruise – Ile Aux Cerfs', 'activity', 'Catamaran cruises', 'per_person', 'draft', 'A full-day catamaran cruise from Trou D''eau Douce visiting the Grand River South East Waterfall, snorkeling, a BBQ lunch on board, and Ile aux Cerfs.', 'Enjoy a full-day catamaran cruise departing from Trou D''eau Douce on Mauritius''s east coast. The experience includes visiting the spectacular Grand River South East Waterfall, snorkeling in crystal-clear waters, and enjoying a BBQ lunch with beverages onboard. Guests then travel to Ile aux Cerfs to admire palm trees and white beaches framed by turquoise water, with time to relax on sandy beaches and swim in the lagoon.', 'Trou D''eau Douce, east coast of Mauritius. Pick-up and drop-off available island-wide.', 420, true, false, 0, ARRAY['Ile aux Cerfs (Eastern Region)', 'GRSE Waterfall (Eastern Region)', 'Snorkeling (Eastern Region)', 'BBQ lunch (Eastern Region)']::text[], ARRAY['Salads and garlic butter bread', 'BBQ items: chicken, fish, sausage', 'Beverages: water, Coke, beer, wine, local rum', 'Dessert: flaming banana', 'Baby seat available free on request', 'Snorkeling']::text[], ARRAY['Private/Exclusive Catamaran - Please contact us', 'Guests using own transport must not drink if driving', 'Arrive at boarding point at least 15 minutes before the cruise start time']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 5000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/IMG-20230725-WA0019.jpg', 'Catamaran Cruise – Ile Aux Cerfs', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/20230824_101751.jpg', 'Catamaran Cruise – Ile Aux Cerfs', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Bellemare-tour-31.jpg', 'Catamaran Cruise – Ile Aux Cerfs', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/11-1.jpg', 'Catamaran Cruise – Ile Aux Cerfs', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='catamaran-cruise-3-northern-island-adventure-all-inclusive') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'catamaran-cruise-3-northern-island-adventure-all-inclusive', 'Catamaran Cruise 3 Northern Island Adventure (All-inclusive)', 'activity', 'Catamaran cruises', 'per_person', 'draft', 'A full day from Grand Baie exploring Île Plate with lagoon snorkeling, a gourmet lunch on board, relaxation at Île aux Gabriel, and sunset views of Coin de Mire.', 'Depart from Grand Baie for a full day exploring Île Plate. Enjoy crystal-clear lagoon snorkeling with incredible fish and coral varieties. A gourmet lunch is prepared on the spacious catamaran, followed by relaxation at Île aux Gabriel. The day concludes with sunset views of Coin de Mire''s spectacular cliffs.', 'Grand Baie. Pick-up and drop-off available island-wide.', 480, true, false, 0, ARRAY['Île Plate (Northern Region)', 'Ile Aux Gabriel (Northern Region)', 'Coin de Mire (Northern Region)', 'Snorkeling (Northern Region)']::text[], ARRAY['Lunch with salads', 'Garlic butter bread', 'Grilled chicken/fish/sausage', 'Water, Coke, beer, wine, local rum', 'Flaming banana', 'Fruit salads', 'Snorkeling', 'Baby seat free on request']::text[], ARRAY['Private Catamaran (Exclusive) - Please contact us', 'Do not drink if you are going to drive', 'Arrive 15 minutes before departure', 'Own transport users must find directions on Google Maps']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 5000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/3-1.jpg', 'Catamaran Cruise 3 Northern Island Adventure (All-inclusive)', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/5.jpg', 'Catamaran Cruise 3 Northern Island Adventure (All-inclusive)', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Gunners-Coin-_Snorkeling-1-scaled.jpg', 'Catamaran Cruise 3 Northern Island Adventure (All-inclusive)', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/DJI_5017-scaled.jpeg', 'Catamaran Cruise 3 Northern Island Adventure (All-inclusive)', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='catamaran-sunset-cruise') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'catamaran-sunset-cruise', 'Catamaran Sunset Cruise', 'activity', 'Catamaran cruises', 'per_person', 'draft', 'Sail peacefully through the stunning sunset over Grand Bay on a beautiful catamaran while relaxing with a refreshing cocktail.', 'Sail peacefully through the stunning sunset over Grand Bay on a beautiful catamaran while relaxing with a refreshing cocktail. The sunsets on the northwest coast of Mauritius are legendary, and the best way to experience them is from the ocean. The cruise allows visitors to enjoy the splendor of the historic town of Grand Bay and sail towards Coin de Mire with its spectacular sea cliffs, offering breathtaking views of other northern islands and Mauritius''s central mountain range. The catamaran features spacious outdoor areas on the deck, front, and back, specially designed for sunset viewing, photography, and socializing. It includes a bar, high-end audio system, and refined music collection.', 'Belle Mare Tours Ltd., Royal Road, Belle Mare, Mauritius. Boarding at Grand Baie. Pick-up and drop-off available at all island locations.', 120, true, false, 0, ARRAY['Grand Baie (Northern Region)', 'Gunner''s Coin / Coin de Mire (Northern Region) - spectacular cliffs with an explosion of color', 'Sunset viewing over the northwest coast', 'Sail past Fort Malarctic and Cap Malheureux']::text[], ARRAY['Cocktail Cruise: Canapés (tuna, shrimp, smoked fish)', 'Peanuts, chips', 'Wine Cocktails (white, rosé)', 'Beer, Rum', 'Non-alcoholic drinks', 'Mineral water', 'Dinner Cruise: Selection of canapés and snacks', 'Baby seat available free on request']::text[], ARRAY['Transportation to/from boarding point (available separately)', 'Please, do not drink if you are going to drive!', 'Arrive at boarding point at least 15 minutes before cruise start time']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 5000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-george-desipris-769228.jpg', 'Catamaran Sunset Cruise', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-nuno-obey-127160.jpg', 'Catamaran Sunset Cruise', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-vincent-gerbouin-1167023.jpg', 'Catamaran Sunset Cruise', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-sebastian-coman-photography-3461205.jpg', 'Catamaran Sunset Cruise', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='western-cruise-catamaran') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'western-cruise-catamaran', 'Western Cruise Catamaran', 'activity', 'Catamaran cruises', 'per_person', 'draft', 'Head towards Tamarin Bay to search for dolphins in their natural habitat, snorkel near a coral reef, and enjoy lunch at anchor by Crystal Rock.', 'Heading towards Tamarin Bay to search for dolphins in their natural habitat, offering a magical and unforgettable experience observing these majestic creatures in the late morning. The tour includes a stop near a beautiful coral reef for snorkeling in crystal-clear waters to discover underwater life''s incredible beauty and diversity. A delicious lunch is served at anchor while viewing Crystal Rock shimmering under the tropical sun.', 'Black River, West region. Pick-up and drop-off available at all island locations.', 420, true, false, 0, ARRAY['Departure from Black River (West region)', 'Dolphin watching at Tamarin Bay', 'Crystal Rock snorkeling (West region)', 'Benitier Island (West region)', 'Lunch on board (West region)']::text[], ARRAY['Lunch on board: salads', 'Garlic butter bread', 'Chicken, fish, sausage', 'Water, Coke, beer, wine, local rum', 'Flaming banana', 'Fruit salads', 'Snorkeling']::text[], ARRAY['Catamaran in Exclusive - Please contact us', 'Please, do not drink if you are going to drive!', 'Arrive at boarding point at least 15 minutes before start', 'Own transport requires directions from Google Maps']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 5000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/20230824_101231-scaled.jpg', 'Western Cruise Catamaran', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/IMG_40988560377817-1.jpeg', 'Western Cruise Catamaran', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/dji_fly_20230813_132902_0_1691918942596_photo_low_quality.jpg', 'Western Cruise Catamaran', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/20230813_104716-scaled.jpg', 'Western Cruise Catamaran', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='swim-with-dolphins-south-tours-all-inclusive') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'swim-with-dolphins-south-tours-all-inclusive', 'Swim with Dolphins & South Tours All Inclusive', 'activity', 'Dolphin swims', 'per_person', 'draft', 'Sunrise speedboat swim with dolphins at Tamarin, then a southern road tour to Chamarel''s Seven Colored Earth, Black River Gorges, Grand Bassin and a rum distillery.', 'Depart at 6 AM from your hotel to Tamarin, witnessing the sunrise over the Indian Ocean. Board a speedboat to swim with dolphins in their natural habitat while exploring the western lagoon. Engage in diving and observe marine life, followed by snorkeling to experience the vibrant underwater world. At 10:30 AM, travel by taxi to Chamarel to visit the Seven Colored Earth and the island''s highest waterfall. Experience panoramic views of the Black River Gorges, Grand Bassin, Trou aux Cerfs, and Floreal. Visit the Chamarel Rum Distillery for rum tasting before returning to your hotel.', 'Hotel pick-up (all island locations); activity at Tamarin Bay with southern Mauritius road tour.', 480, true, false, 0, ARRAY['Tamarin Bay', 'Benitier Island viewpoint', 'Chamarel (Seven Colored Earth and waterfall)', 'Black River Gorges', 'Grand Bassin (Ganga Talao)', 'Trou aux Cerfs', 'Floreal', 'Chamarel Rum Distillery']::text[], ARRAY['Pick-up and drop-off at all parts of the island', 'Swimming with dolphins', 'Transport', 'Snorkeling gear (masks, fins, snorkels)', 'Towels']::text[], ARRAY['Swimwear (must be worn before visit starts)', 'Entrance fees and lunch']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 7000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/saute-de-dauphin.jpg', 'Swim with Dolphins & South Tours All Inclusive', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/swim-with-dolphins-mauritius.jpg', 'Swim with Dolphins & South Tours All Inclusive', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/hugues-mathers-YoLdMZ4AIdo-unsplash.jpg', 'Swim with Dolphins & South Tours All Inclusive', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/dan-dy-1OLqSEXXlGA-unsplash.jpg', 'Swim with Dolphins & South Tours All Inclusive', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='swimming-with-dolphins') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'swimming-with-dolphins', 'Swimming with Dolphins', 'activity', 'Dolphin swims', 'per_person', 'draft', 'Early-morning speedboat trip to Tamarin Bay to swim with wild dolphins in their natural habitat, followed by snorkeling over coral reefs.', 'Make your trip to Mauritius truly unforgettable with the magical experience of swimming alongside dolphins. Set off early at 7:30 AM on a speedboat and head to Tamarin Bay, where you''ll meet these incredible creatures in their natural habitat. Feel the thrill as you dive into crystal-clear waters and watch dolphins play just a few feet away. Listen to their calls, observe their graceful movements, and enjoy a unique moment of connection with nature. This extraordinary adventure will fill you with joy, wonder, and an unmatched sense of freedom.

After your dolphin encounter, explore the vibrant marine life beneath the waves. Snorkel through colorful coral reefs, swim alongside tropical fish, and discover the breathtaking underwater world of the Indian Ocean. Every moment is a chance to escape, recharge, and reconnect with the beauty of the sea. Don''t forget to capture these unforgettable memories with stunning photos.', 'Tamarin Bay, West Region of Mauritius. Directions to the boarding point are available on Google Maps; arrive at the boarding point at least 15 minutes before the cruise start time.', 120, true, false, 0, ARRAY['Tamarin (West Region) - departure point', 'Swim with dolphins in Tamarin Bay in their natural habitat (West Region)', 'Snorkeling - explore colorful coral reefs and tropical fish in the Indian Ocean (West Region)']::text[], ARRAY['Snorkeling gear (masks, fins, snorkels)', 'Pick-up and drop-off at all parts of the island', 'Speedboat transportation to Tamarin Bay']::text[], ARRAY['Swimwear (must be worn before visit starts)', 'Towels', 'Payment for transportation (separate from tour price)']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 3000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Dolphins-Swimming.jpg', 'Swimming with Dolphins', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/IMG_40988560377817-1.jpeg', 'Swimming with Dolphins', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/nage-avec-le-dauphin-1-scaled.jpg', 'Swimming with Dolphins', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Bellemare-tour-31.jpg', 'Swimming with Dolphins', 3),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/standard-300x225-1.jpg', 'Swimming with Dolphins', 4),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/suv-300x225-1.jpg', 'Swimming with Dolphins', 5),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/6-seaters-taxi.jpg', 'Swimming with Dolphins', 6),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/minibus-300x225-1.jpg', 'Swimming with Dolphins', 7);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='swimming-with-dolphins-benitier-island-speedboat-all-inclusive') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'swimming-with-dolphins-benitier-island-speedboat-all-inclusive', 'Swimming with Dolphins & Benitier Island (Speedboat) All Inclusive', 'activity', 'Dolphin swims', 'per_person', 'draft', 'Full-day speedboat excursion in western Mauritius: swim with dolphins, snorkel, visit Crystal Rock, and enjoy a barbecue lunch on Ile aux Benitiers.', 'This full-day speedboat excursion offers an immersive ocean experience in Mauritius''s western region. Guests encounter dolphins in their natural habitat, explore underwater ecosystems through snorkeling, visit the iconic Crystal Rock island formation, and conclude with a barbecue lunch on Ile aux Benitiers. The all-inclusive package combines wildlife observation with island exploration and dining.', 'Tamarin Bay, Western Region of Mauritius. Operator: Belle Mare Tours Ltd., Royal Road, Belle Mare, Mauritius.', 420, true, false, 0, ARRAY['Swim with dolphins (Western Region)', 'Snorkeling (Western Region)', 'Visit Crystal Rock Island (Western Region)', 'Ile aux Benitiers barbecue lunch (Western Region)']::text[], ARRAY['Dolphin swimming experience', 'Snorkeling with provided gear (masks, fins, snorkels)', 'Crystal Rock Island visit', 'Barbecue lunch (salads, garlic butter bread, grilled chicken, fish, sausage; water, Coke, beer, wine, local rum; flaming banana dessert)', 'Hotel pickup and dropoff (all island locations)']::text[], ARRAY['Swimwear (must be worn before visit starts)', 'Towels', 'Driver payment (cash in MUR, EUR, USD accepted, or online payment)']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 5000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/IMG-20230725-WA0009.jpg', 'Swimming with Dolphins & Benitier Island (Speedboat) All Inclusive', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/saute-de-dauphin.jpg', 'Swimming with Dolphins & Benitier Island (Speedboat) All Inclusive', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/swim-with-dolphins-mauritius.jpg', 'Swimming with Dolphins & Benitier Island (Speedboat) All Inclusive', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/dji_fly_20230813_131353_0_1691918033908_photo_low_quality-1.jpg', 'Swimming with Dolphins & Benitier Island (Speedboat) All Inclusive', 3),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/standard-300x225-1.jpg', 'Swimming with Dolphins & Benitier Island (Speedboat) All Inclusive', 4),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/suv-300x225-1.jpg', 'Swimming with Dolphins & Benitier Island (Speedboat) All Inclusive', 5),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/6-seaters-taxi.jpg', 'Swimming with Dolphins & Benitier Island (Speedboat) All Inclusive', 6),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/minibus-300x225-1.jpg', 'Swimming with Dolphins & Benitier Island (Speedboat) All Inclusive', 7);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='seaplane') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'seaplane', 'Fly Over the Underwater Waterfall: Mauritius Seaplane Tour', 'activity', 'Air activities', 'per_person', 'draft', 'Take off barefoot from the turquoise lagoon at La Prairie beach and fly beside the famous underwater waterfall illusion, next to a UNESCO World Heritage site.', 'We have the privilege of flying over the UNDERWATER CASCADE daily. Our seaplanes take off from the beach of La Prairie, right next to this natural wonder. Just a few steps away, barefoot in the turquoise lagoon, you board the seaplane. Get ready to take off from the crystal-clear waters, beside a UNESCO World Heritage site. Comfortably seated next to the pilot, you will discover this famous illusion: a waterfall at the bottom of the Indian Ocean. It''s magical and majestic. The most photogenic view has captivated the entire world since its photos made their rounds on the internet. This natural treasure is truly something to see in person.', 'Beach of La Prairie, Mauritius', 15, true, false, 0, ARRAY['Fly over the famous underwater waterfall illusion at the bottom of the Indian Ocean', 'Take off barefoot from the turquoise lagoon at La Prairie beach', 'Seated next to the pilot', 'Views beside a UNESCO World Heritage site', 'Three tour options: 15min (the short ambre), 30min (the Turquoise experience), 60min (the mythical east)']::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 14500, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/10/DSC02794-1-scaled.jpg', 'Fly Over the Underwater Waterfall: Mauritius Seaplane Tour', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/10/PHOTO-2024-03-19-14-21-39-1.jpg', 'Fly Over the Underwater Waterfall: Mauritius Seaplane Tour', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/10/PHOTO-2024-03-19-14-21-38-1.jpg', 'Fly Over the Underwater Waterfall: Mauritius Seaplane Tour', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/standard-300x225-1.jpg', 'Fly Over the Underwater Waterfall: Mauritius Seaplane Tour', 3),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/suv-300x225-1.jpg', 'Fly Over the Underwater Waterfall: Mauritius Seaplane Tour', 4),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/6-seaters-taxi.jpg', 'Fly Over the Underwater Waterfall: Mauritius Seaplane Tour', 5),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/minibus-300x225-1.jpg', 'Fly Over the Underwater Waterfall: Mauritius Seaplane Tour', 6),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/coaster-tours.jpg', 'Fly Over the Underwater Waterfall: Mauritius Seaplane Tour', 7);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='helicotour') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'helicotour', 'Helicopter Tour of Mauritius', 'activity', 'Air activities', 'per_person', 'draft', 'Discover Mauritius from above on a private helicopter flight departing from the Triolet base in the north, with three packages from a short scenic hop to a full island tour.', 'THE MUST (departing from Triolet, North): A short flight and memories forever etched in your mind. The route departing from the Triolet base includes a flyover of the northern landscapes and islets. Enjoy the bustling life of Grand-Baie seen from above and the boats lined up near the golden sand beach. Then fly over Coin de Mire, which dominates the north coast, and Ile Plate, home to various species of reptiles. The flight ends with a magnificent stretch over Ile d''Ambre, where the famous Saint-Geran was shipwrecked and which was the setting of Paul et Virginie by Bernardin de Saint-Pierre.

THE MAGIC (departing from Triolet, North): Discover beautiful panoramas of Mauritius by flying over the island for 40 minutes with our exclusive Le Magique experience. The adventure begins with a majestic take-off from our base in Triolet, where our dedicated team gives you the warmest of welcomes. Enjoy a moment of relaxation in our elegant lounge, followed by a complete flight briefing for an unforgettable experience. Then embark on a fascinating aerial excursion that will reveal the hidden treasures of Mauritius. Admire the breathtaking view of Port-Louis, fly over the iconic silos of the Moulin de la Concorde, watch the ships filling the capital, marvel at the vast green spaces and crystal-clear lagoon, discover Ile aux Benitiers and contemplate the majestic Albion lighthouse that proudly dominates its surroundings. An unforgettable experience awaits you, ready to transform your vision of Mauritius forever. If you are wondering which is that majestic mountain where the tropicbirds live, it is the Morne Brabant! Do not miss the Underwater Waterfall and admire the magnificent colours of Chamarel. Relax on the white sand beaches of Ile aux Cerfs and enjoy the tropical sun while sipping a refreshing cocktail. Explore the Riviere-Noire gorges to discover the beauty of raw nature, then admire the Tamarin waterfalls hidden in an endemic forest. Dive into the crystal-clear waters of Blue Bay Marine Park for an unforgettable diving experience among the corals and colourful fish. Approach Le Pieter Both, a mountain linked to a famous legend, before ending your journey with a breathtaking flyover with Corail Helicopteres! Do not forget to taste the delights of local Mauritian cuisine, such as chicken curry and spicy samosas, for an authentic culinary experience.

THE EXCELLENCE (departing from Triolet, North): You will circle around Pieter Both and Le Pouce to get your adventure off to a great start. Then admire the beautiful panorama of the Tamarin Waterfall in the middle of a verdant forest and rocks sculpted by Mother Nature. You will also feel as if you are flying with the tropicbirds as you approach the Riviere-Noire Gorges. After a detour to Ile aux Benitiers, capture the Underwater Waterfall near Morne Brabant, listed as a UNESCO heritage site. You may wonder whether the rainbow has fallen when you fly over Chamarel. The magic is always present here! Have you ever seen an islet in the middle of a lake? Live this unique experience at Ganga Talao. Do not forget to take a look at the crater of the sleeping Kanaka volcano in Mauritius. As you approach the island, fly over Ile aux Cerfs in the east, then head back north passing over Ile d''Ambre and Ile Plate, famous for its artistically patterned chameleons! Near Cap Malheureux lies Le Coin de Mire, visible from our base if the clouds allow! This is Mauritius in all its splendour!', 'Triolet base (North), Mauritius. Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius. Directions to the boarding point are available on Google Maps.', 25, true, false, 0, ARRAY['The Must: flyover of the northern landscapes and islets, Grand-Baie, Coin de Mire, Ile Plate, Ile d''Ambre (site of the Saint-Geran shipwreck)', 'The Magic: Port-Louis, Moulin de la Concorde, Ile aux Benitiers, Morne Brabant, the Underwater Waterfall, Chamarel, Ile aux Cerfs, Riviere-Noire, the Tamarin waterfalls, Blue Bay Marine Park, Pieter Both', 'The Excellence: Pieter Both, Le Pouce, Tamarin Waterfall, Riviere-Noire Gorges, Ile aux Benitiers, the Underwater Waterfall, Morne Brabant, Chamarel, Ganga Talao, the Kanaka volcano crater, Ile aux Cerfs, Ile d''Ambre, Ile Plate, Cap Malheureux, Coin de Mire']::text[], ARRAY['Scenic aerial flight (itinerary depending on the package)', 'Complete flight briefing (The Magic)', 'Access to the elegant lounge (The Magic)']::text[], ARRAY['Transport is optional (do not drink if you are going to drive)']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 25000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/combien-coute-un-vol-helico-prive-Corail-Helicopteres.jpg', 'Helicopter Tour of Mauritius', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/helicopter.jpg', 'Helicopter Tour of Mauritius', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/grisgris.jpg', 'Helicopter Tour of Mauritius', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/image003.jpg', 'Helicopter Tour of Mauritius', 3),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/image004.jpg', 'Helicopter Tour of Mauritius', 4),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/standard-300x225-1.jpg', 'Helicopter Tour of Mauritius', 5),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/suv-300x225-1.jpg', 'Helicopter Tour of Mauritius', 6),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/6-seaters-taxi.jpg', 'Helicopter Tour of Mauritius', 7);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='skydive') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'skydive', 'Tandem Skydiving in Mauritius', 'activity', 'Air activities', 'per_person', 'draft', 'Tandem skydive from 10,000 feet over Mon Loisir''s sugarcane fields, freefalling at 200 km/h before gliding down over the lagoons and reefs of the Indian Ocean.', 'Enjoy the spectacular views of Mauritius with a tandem skydive. Soar through the skies while securely harnessed to your experienced instructor. Experience a 360 degree view of the stunning coastline, interior, and mountains before your jump. This adrenaline-pumping activity is suitable for both beginners and experienced thrill-seekers alike. At 10,000 feet, you''ll freefall at 200 km/h for a minute, then glide for 5 minutes before landing safely. Feel the rush of excitement as you plummet towards the earth surrounded by breathtaking panoramas. Take off from Mon Loisir''s beautiful sugarcane fields overlooking the lagoons and reefs of the Indian Ocean. After the exhilarating experience, relax and reflect on your adventure while enjoying refreshments at the drop zone. The whole skydiving excursion lasts about 1 hour, including ground training, 25 minutes of flight, freefall, and parachute descent. Celebrate your bravery and sense of achievement with friends and family who can witness your jump and cheer you on. Receive a tandem skydiving certificate and opt for a DVD of your jump as a keepsake at an additional cost. Make sure to book in advance to secure your spot for this unforgettable adventure in Mauritius.', 'Take off from Mon Loisir; Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius. Arrive at least 15 minutes before the start time.', 60, true, false, 0, ARRAY['360 degree panoramic views of the coastline, interior, and mountains', 'Take off from Mon Loisir''s sugarcane fields overlooking the lagoons and reefs of the Indian Ocean', 'Freefall at 200 km/h for one minute', 'Glide descent for 5 minutes', 'Refreshments at the drop zone']::text[], ARRAY['Tandem skydive from 10,000 feet', 'Ground training', '25 minutes of flight', 'Freefall and parachute descent', 'Tandem skydiving certificate', 'Refreshments at the drop zone', 'Pickup and drop-off at all island locations']::text[], ARRAY['DVD of your jump (additional cost: Rs 5000)', 'Photos (additional cost: Rs 6500)', 'Do not drink if you are driving your own transport']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 41000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-hasanguher-6372752.jpg', 'Tandem Skydiving in Mauritius', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/skydive1-1.jpg', 'Tandem Skydiving in Mauritius', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/skydive3-1.jpg', 'Tandem Skydiving in Mauritius', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/skydive2-1.jpg', 'Tandem Skydiving in Mauritius', 3),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/standard-300x225-1.jpg', 'Tandem Skydiving in Mauritius', 4),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/suv-300x225-1.jpg', 'Tandem Skydiving in Mauritius', 5),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/6-seaters-taxi.jpg', 'Tandem Skydiving in Mauritius', 6),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/minibus-300x225-1.jpg', 'Tandem Skydiving in Mauritius', 7);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='blue-safari-submarine-subscooter') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'blue-safari-submarine-subscooter', 'Blue Safari Submarine & Subscooter', 'activity', 'Sea & water activities', 'per_person', 'draft', 'Descend into the depths of the Indian Ocean by submarine or subscooter to explore reefs, corals, marine life and the wreck of ''Le Star Hope''.', 'Gradually discover the underwater world by observing the beauty of the Indian Ocean and its marine life. You will receive a briefing before boarding the submarine from a boat platform. As you descend into the depths, you will explore the reefs, the corals, the local marine wildlife, the wreck of ''Le Star Hope,'' and an ancient anchor from the 17th century at the bottom of the ocean.', 'Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius', null, true, false, 0, ARRAY['Explore the reefs and corals', 'Observe local marine wildlife', 'See the wreck of ''Le Star Hope''', 'Discover an ancient 17th-century anchor at the bottom of the ocean']::text[], ARRAY['Briefing before boarding', 'Pick-up and drop-off at all parts of the island']::text[], ARRAY['Do not drink if you are going to drive', 'Arrive at the boarding point at least 15 minutes before the cruise start time']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 11700, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/maxresdefault.jpg', 'Blue Safari Submarine & Subscooter', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-tomfisk-4618223.jpg', 'Blue Safari Submarine & Subscooter', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Bellemare-tour-31.jpg', 'Blue Safari Submarine & Subscooter', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/11.jpg', 'Blue Safari Submarine & Subscooter', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='deep-sea-fishing') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'deep-sea-fishing', 'Deep Sea fishing', 'activity', 'Sea & water activities', 'per_person', 'draft', 'Fish for Blue Marlin, Dorado and other big game under the guidance of experienced skippers on well-equipped modern boats.', 'Whether you are a beginner or an expert, you will enjoy fishing for a Blue Marlin, a Dorado, or other large fish under the guidance of experienced skippers. The modern boats designed for deep-sea fishing are well equipped. The minimum rental duration is 6 hours, and a boat can be shared by a maximum of three anglers. The boats operate from the north, west, and east coasts. You will sail along the reef and observe the corals up close, explore the rich local marine life, visit the wreck of the famous cruiser Star Hope, and discover a 17th-century anchor resting at the ocean''s bottom.', 'Departures from Grand Baie (North region), Riviere Noire (West region) and Trou d''eau douce (East region), Mauritius', 480, true, false, 0, ARRAY['Fish for Blue Marlin, Dorado and other large fish', 'Sail along the reef and observe corals up close', 'Explore local marine life', 'Visit the wreck of the cruiser Star Hope', 'Discover a 17th-century anchor at the ocean''s bottom']::text[], ARRAY['Experienced skipper guidance', 'Modern, well-equipped boats', 'Access to three departure locations (north, west, east coasts)', 'Pick-up and drop-off at all parts of the island']::text[], ARRAY['Do not drink if you are going to drive', 'Arrive at least 15 minutes before the cruise start time']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 36000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-willmac-3793366.jpg', 'Deep Sea fishing', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/WhatsApp-Image-2024-05-03-at-15.08.31_f983b852.jpg', 'Deep Sea fishing', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/WhatsApp-Image-2024-05-03-at-15.08.28_6e128af8.jpg', 'Deep Sea fishing', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/sebastian-pena-lambarri-YV593oyMKmo-unsplash.jpg', 'Deep Sea fishing', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='diving-with-bottle-scuba-dive') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'diving-with-bottle-scuba-dive', 'Diving with bottle – Scuba Dive', 'activity', 'Sea & water activities', 'per_person', 'draft', 'Explore the breathtaking underwater scenery of Mauritius, with colourful corals and a rich variety of fish in crystal-clear waters.', 'Diving in Mauritius provides an unforgettable and extraordinary experience as you explore breathtaking underwater scenery, where colorful corals form enchanting landscapes teeming with an astonishing variety of shimmering fish. It truly is a earthly paradise for diving enthusiasts eager to delve into the richness of the captivating marine life of the Indian Ocean, alongside the many hidden treasures waiting to be discovered in its crystal-clear waters, perfect for wonder and adventure.', 'Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius', 480, true, false, 0, ARRAY['Explore colourful corals and rich marine life of the Indian Ocean', 'Three location options (weather dependent): Grand Baie (North), Belle Mare (East), Flic-en-Flac (West)']::text[], ARRAY['Baby seat (free on demand)', 'Pick-up and drop-off at all parts of the island']::text[], ARRAY['Do not drink if you are going to drive', 'Arrive at least 15 minutes before the cruise start time', 'If using your own transport, directions to the boarding point are available on Google Maps']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 5000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-toulouse-3098970.jpg', 'Diving with bottle – Scuba Dive', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-tomfisk-1522160.jpg', 'Diving with bottle – Scuba Dive', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-miles-hardacre-1263314-2404370.jpg', 'Diving with bottle – Scuba Dive', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-freestockpro-1540108.jpg', 'Diving with bottle – Scuba Dive', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='encountering-the-whales-and-swim-with-dolphins-excursion') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'encountering-the-whales-and-swim-with-dolphins-excursion', 'Encountering the Whales and swim with Dolphins excursion', 'activity', 'Sea & water activities', 'per_person', 'draft', 'A West coast boat excursion to admire humpback or sperm whales and snorkel with dolphins, under the supervision of professional skippers and crew.', 'A unique experience creating memories to last for a lifetime! Immerse yourself in the adventure of a lifetime which will bring you into contact with strikingly beautiful scenery, unspoiled landscapes and wonderful marine animals. On the West coast of Mauritius, we offer a large selection of trips, both on a shared basis and private basis. All the activities are done under the instructions and supervision of professional skippers and crew members while respecting and protecting the aquatic life and natural environment. The first part of this excursion will give you the opportunity to admire the biggest and largest marine animal. Either the humpback whales or the sperm whales these cetaceans remain wild and unpredictable, so it is not 100% guaranteed to meet them, just like dolphins but our dedicated crew members most of time do their best to make our guests enjoy an unforgettable and a lifetime memory. After this pure moment of happiness, it will be time to search for the joyful, playful, intelligent and charming Dolphins. A briefing about the rules to respect concerning the approach, as well as all safety measures will be given by the boat captain or crew members before getting into the water. Then you will enjoy the magical snorkeling moment with one of the most fantastic creatures under the supervision of an instructor. While cruising back depending on the time remaining, the boat trip may continue at the Aquarium, a magical snorkeling site to discover and enjoy the Mauritian aquatic life. Then the boat will be heading back to the shore where your journey will end happily thinking of your most recent encounter.', 'West coast of Mauritius; Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius', 240, true, false, 0, ARRAY['Admire humpback or sperm whales', 'Swim and snorkel with dolphins', 'Optional snorkeling at the Aquarium site', 'Return to shore']::text[], ARRAY['Professional skipper and crew supervision', 'Fins, masks and snorkels (provided on board)', 'Snorkeling instruction', 'Complimentary refreshments (water and soft drinks)']::text[], ARRAY['Snorkeling not recommended for pregnant women', 'Children under 12 must be accompanied by an adult', 'Guests may bring their own snorkeling gear if preferred']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 9000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/09/pexels-andre-estevez-1743712-3309785.jpg', 'Encountering the Whales and swim with Dolphins excursion', 0);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only', 'Flat Island, Gabriel Island and the Gunners Coin by Speedboat (Exclusive basis only)', 'activity', 'Sea & water activities', 'per_person', 'draft', 'A private speedboat day trip from Grand Bay to Flat Island, Gabriel Island and Gunner''s Coin, with snorkeling, BBQ lunch and beverages.', 'A private day trip by speedboat to visit three northern islands of Mauritius. Departure is from Grand Bay, with an approximately 45-minute journey to Flat Island for relaxation and snorkeling in the lagoons. Tropical fauna and flora await discovery both in the water and on the island. After a BBQ lunch, the boat proceeds to Gabriel Island for exploration. A final snorkeling session takes place near Gunner''s Coin, one of the most beautiful diving spots off the north of Mauritius.', 'Departure from Grand Bay, Northern Mauritius (directions available on Google Maps)', 480, true, false, 0, ARRAY['Flat Island: relaxation, snorkeling and BBQ lunch', 'Gabriel Island: island exploration', 'Gunner''s Coin: snorkeling at one of the most beautiful diving spots off the north of Mauritius']::text[], ARRAY['Salads and garlic butter bread', 'BBQ: chicken, fish, sausage', 'Beverages: water, Coke, beer, wine, local rum', 'Dessert: flaming banana', 'Snorkeling sessions', 'Pick-up and drop-off available across the island']::text[], ARRAY['Do not drink if you are going to drive', 'Arrive at least 15 minutes before the cruise start time']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 38000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2025/08/decouvrez-coin-de-mire-dans-le-nord-de-lile-maurice-1024x682-1.jpg', 'Flat Island, Gabriel Island and the Gunners Coin by Speedboat (Exclusive basis only)', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/speed-boat.jpg', 'Flat Island, Gabriel Island and the Gunners Coin by Speedboat (Exclusive basis only)', 1);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='underwater-sea-walk-excursion') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'underwater-sea-walk-excursion', 'Underwater Sea Walk Excursion', 'activity', 'Sea & water activities', 'per_person', 'draft', 'Walk on the ocean floor at a depth of 10-13 feet in a diving suit, accompanied by experienced instructors, to observe marine fauna and flora.', 'Equipped with a diving suit and accompanied by experienced instructors, dive into the underwater world at a depth of 10-13 feet for an unforgettable and enriching experience. Explore the ocean floor, observe the marine fauna and flora in their natural habitat, and let yourself be amazed by the beauty and diversity of this fascinating universe. Take advantage of this unique adventure to marvel at nature and learn more about marine life.', 'Belle Mare beach; Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius', 20, true, false, 0, ARRAY['Walk on the ocean floor in a diving suit', 'Observe marine fauna and flora in their natural habitat', 'Experience the beauty and diversity of the underwater world']::text[], ARRAY['Diving suit provided', 'Experienced instructors', 'Underwater exploration at a depth of 10-13 feet', 'Pick-up and drop-off at all parts of the island']::text[], ARRAY['Do not drink if you are going to drive', 'If using your own transport, arrive at least 15 minutes early']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 3000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/1-9.jpg', 'Underwater Sea Walk Excursion', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/seawalk-1.jpg', 'Underwater Sea Walk Excursion', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-francesco-ungaro-3361052.jpg', 'Underwater Sea Walk Excursion', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-richard-segal-732340-1645028.jpg', 'Underwater Sea Walk Excursion', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='visit-to-ambre-island-by-kayak') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'visit-to-ambre-island-by-kayak', 'Visit To Ambre Island By Kayak', 'activity', 'Sea & water activities', 'per_person', 'draft', 'Kayak through the tranquil mangroves of Amber Island, explore its hidden corners and ancient ruins, and relax on Bernache Island.', 'Kayak through the mangroves of Amber Island and discover its environment in a unique and immersive way. Take in the natural beauty that surrounds these tranquil waters and observe the local wildlife and flora in their natural habitat. Explore the hidden corners of the island, dive into its fascinating past by visiting ancient ruins and uncovering the thrilling stories that surround them. Invite your entire extended family, including grandparents, uncles, aunts, as well as your closest friends, to join you on this unforgettable adventure in Mauritius. Your kayak excursion will begin with a detailed safety briefing, followed by a peaceful paddle through the lagoon and lush mangroves. Let yourself be swept away by the picturesque landscapes and crystal-clear waters as you navigate through the shaded waterways and small scenic islets that dot the region. Extend your exploration of Amber Island, soak in its serenity, and discover the mysteries that lie behind every corner. Finally, treat yourself to a well-deserved moment of relaxation on Bernache Island, where you can recharge and absorb the natural beauty that surrounds you before heading back to solid ground, stars in your eyes and unforgettable memories in your heart.', 'Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius', null, true, false, 0, ARRAY['Safety briefing', 'Paddle through the lagoon and lush mangroves', 'Navigate shaded waterways and scenic islets', 'Explore Amber Island''s hidden corners and ancient ruins', 'Relax on Bernache Island']::text[], ARRAY['Safety briefing', 'Kayak paddling through the lagoon and mangroves', 'Exploration of Amber Island', 'Visit to Bernache Island for relaxation', 'Pick-up and drop-off at all parts of the island']::text[], ARRAY['Do not drink if you are going to drive', 'Arrive at least 15 minutes before the start time', 'If using your own transport, directions to the boarding point are available on Google Maps']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 4000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/kayak5.jpg', 'Visit To Ambre Island By Kayak', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-amirul-chakim-2963992-18432278.jpg', 'Visit To Ambre Island By Kayak', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-shivkumarsd-1522344.jpg', 'Visit To Ambre Island By Kayak', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-asadphoto-1430672.jpg', 'Visit To Ambre Island By Kayak', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='black-river-gorges-hiking') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'black-river-gorges-hiking', 'Black River Gorges Hiking', 'activity', 'Hiking & trails', 'per_person', 'draft', 'Hike the heart of the Black River Gorges National Park to discover secret waterfalls, endemic wildlife, and panoramic ridge views.', 'Explore with us the heart of the Black River Gorges and be amazed by its hidden treasures that gradually reveal themselves to you. The twists and turns of our adventure highlight the splendor of this protected national park and unveil secret waterfalls scented with wild guava flowers, along with the sights and sounds of numerous endemic wildlife and plant species such as the echo parakeet and pink pigeons. A must-see for all nature and wildlife enthusiasts. The trail features a ridge ascent that winds around the valley, offering panoramic views of LaTourelle, Île aux Benetiers, and the distant Morne. A challenging and adventurous path that is best suited for our enthusiastic explorers, given the elevation gain, the terrain, the humidity, and the possibility of mud in these conditions.', 'Royal Road, Belle Mare, Mauritius', null, true, false, 0, ARRAY['Ridge ascent winding around the valley', 'Panoramic views of LaTourelle, Île aux Benetiers, and the Morne', 'Secret waterfalls scented with wild guava flowers', 'Endemic wildlife such as the echo parakeet and pink pigeons']::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 4000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/blackriverhiking.jpg', 'Black River Gorges Hiking', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/Mauritius_Black-River-Gorges-National-Park-01.jpg', 'Black River Gorges Hiking', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/hiking-the-black-river-gorges-full-day-incl-lunch-transfer-2359813.jpg', 'Black River Gorges Hiking', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/image02.jpg', 'Black River Gorges Hiking', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='hiking-at-the-tamarind-falls-7-cascade') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'hiking-at-the-tamarind-falls-7-cascade', 'Hiking At The Tamarind Falls / 7 Cascade', 'activity', 'Hiking & trails', 'per_person', 'draft', 'Guided hike to Tamarind Falls (7 Cascades), the highest waterfall in Mauritius, through plateaus rich in plants and exotic birds.', '7 Cascades, also known as Tamarind Falls, is located near the small village of Henrietta, on the high plateaus of Mauritius, and its source originates from Rivière Tamarin. The 7 Cascades measure 293 meters/961 feet, making it the highest waterfall in Mauritius. You can find a wide variety of plants and exotic birds in this peaceful and enchanting location. It is recommended to be accompanied by a guide who will assist you during the hike as there are not many precise trails to follow.', 'Near the village of Henrietta, on the high plateaus of Mauritius. Operator: Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius.', null, true, false, 0, ARRAY['Tamarind Falls (7 Cascades), the highest waterfall in Mauritius at 293 meters / 961 feet', 'Wide variety of plants and exotic birds', 'Peaceful and enchanting location on the high plateaus', 'Optional swimming']::text[], ARRAY[]::text[], ARRAY['Bring water', 'Comfortable hiking shoes', 'Sunscreen and mosquito repellent', 'In case you want to go swimming, bring your swimsuits and towels too']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 4000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/tamarin_falls_-_full_day_2_20091108_2051346542.jpg', 'Hiking At The Tamarind Falls / 7 Cascade', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/20230824_100523-scaled.jpg', 'Hiking At The Tamarind Falls / 7 Cascade', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/2-1.jpg', 'Hiking At The Tamarind Falls / 7 Cascade', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/4-1.jpg', 'Hiking At The Tamarind Falls / 7 Cascade', 3),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/original_album-photo-les-sept-cascades-les-plus-authentiques-alb-1-image979-1.jpg', 'Hiking At The Tamarind Falls / 7 Cascade', 4);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='hiking-le-morne') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'hiking-le-morne', 'Hiking Le Morne', 'activity', 'Hiking & trails', 'per_person', 'draft', 'Climb the UNESCO World Heritage Le Morne mountain to its ''V'' summit for spectacular views of turquoise lagoons and lush mountain ranges.', 'Discover the beauty and majesty of Morne Mountain as you climb from its base to the peak of the ''V'' summit while enjoying the spectacular landscape. Reach out and touch the clouds while marveling at the magnificence of the turquoise lagoons and lush mountain ranges that stretch out before you as you effortlessly gaze towards the horizon. Explore the tumultuous history, folklore, and myths that have surrounded the mountain and celebrate the triumph of reaching the summit after bravely tackling the thrilling climbing terrains you will encounter. Designated a UNESCO World Heritage Site in 2006, the mountain is a protected sanctuary for the plethora of rare plant and animal species that continue to thrive.', 'Belle Mare Tours Ltd, Royal Road, Belle Mare, Mauritius', 210, true, false, 0, ARRAY['Climb from base to the peak of the ''V'' summit', 'Spectacular views of turquoise lagoons and lush mountain ranges', 'Explore the mountain''s history, folklore, and myths', 'UNESCO World Heritage Site, sanctuary for rare plant and animal species', 'Distance: 5.6 km; elevation gain: 465 m']::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Standard', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult', 4000, 'EUR', null, 0);
    insert into activity_images (id, activity_id, url, alt, position) values
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-fatih-turan-63325184-17937827.jpg', 'Hiking Le Morne', 0),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/20230824_100355-scaled.jpg', 'Hiking Le Morne', 1),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/pexels-michalmarek-3703465.jpg', 'Hiking Le Morne', 2),
    (gen_random_uuid(), v_aid, 'https://www.visitemaurice.com/wp-content/uploads/2024/03/655.jpg', 'Hiking Le Morne', 3);
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='chamarel-tour') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'chamarel-tour', 'Chamarel Adventure Tour', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'A private day tour through Chamarel and the south-west, taking in the Trou aux Cerfs crater, Grand Bassin sacred lake, Black River Gorges, the Seven Coloured Earths, Chamarel Waterfall and rum factory, and Le Morne viewpoint.', 'Discover the beauty and charm of Chamarel with this adventure tour offering natural wonders including Grand Bassin Spiritual Lake, the enchanting Seven-Coloured Earth, the majestic Chamarel Waterfall, and the Chamarel Rum Factory. The experience provides breathtaking views of Black River Gorges and Le Morne Mountain. The journey begins at the dormant Trou aux Cerfs Volcano Crater in Curepipe, offering panoramic vistas. Next is Grand Bassin (Ganga Talao), a sacred lake with the impressive Lord Shiva statue, providing spiritual significance and cultural insights. Alexandra Waterfall is a serene spot with abundant natural surroundings. Black River Gorges presents lush greenery, endemic flora and fauna, scenic trails with waterfalls and deep valleys. The Seven Coloured Earths showcase multi-colored volcanic sand in shades from deep red to vibrant blue. Chamarel Waterfall is Mauritius'' highest waterfall cascading into a lush gorge. Rhumerie de Chamarel provides rum-making education with tastings of locally crafted spirits. The tour concludes at the Benitiers Island and Le Morne Mountain viewpoint, offering sweeping ocean and mountain vistas reflecting Mauritius'' essence.', null, 420, true, false, 0, ARRAY['Trou aux Cerfs Volcano Crater (Curepipe)', 'Grand Bassin (Ganga Talao)', 'Alexandra Falls & Black River Gorges', 'Seven Coloured Earth of Chamarel', 'Chamarel Waterfall', 'Chamarel Rum Factory (Visit & Tasting)', 'Benitiers Island & Le Morne Mountain Viewpoint']::text[], ARRAY['Pick up and drop off from any hotel or Airbnb in Mauritius', 'Private transportation to all the sights mentioned', 'An English/French-speaking driver to guide you and provide information']::text[], ARRAY['Entry ticket fees (Seven Coloured Earth Geopark, Rum Factory)', 'Lunch']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 8600, 'EUR', 4, 0);
    -- (no images; add in admin)
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='cultural-north-tour') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'cultural-north-tour', 'Mauritius Cultural Tour', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'A relaxed private tour of northern Mauritius covering the L''Aventure du Sucre sugar museum, Chateau de Labourdonnais, Grand Baie, the Red Church of Cap Malheureux, Pamplemousses Botanical Garden, and the Pereybere and Bain Boeuf beaches.', 'Discover the cultural treasures of northern Mauritius through this relaxed private journey exploring historic estates, tropical gardens, charming coastal villages, and beautiful beaches. The tour visits L''Aventure du Sucre Museum and Chateau de Labourdonnais, followed by the seaside atmosphere of Grand-Baie and the iconic Red Church of Cap Malheureux. You''ll stroll through the lush Pamplemousses Botanical Garden and unwind at Pereybere and Bain Boeuf Beach. With private transport and a friendly local driver, this tour blends culture, history, and coastal beauty. The experience is flexible and personalized, allowing you to explore at your own pace.', null, 330, true, false, 0, ARRAY['L''Aventure du Sucre Sugar Museum', 'Chateau de Labourdonnais', 'Grand Bay Beach & Village', 'Red Church of Cap Malheureux', 'SSR (Pamplemousses) Botanical Garden', 'Pereybere & Bain Boeuf Beach']::text[], ARRAY['Pick up and drop off from any hotel or Airbnb''s in Mauritius', 'Private transportation to all the sights mentioned above', 'A friendly English/French-speaking driver to guide you and provide information', 'First child seat free of charge (upon request)']::text[], ARRAY['Entry ticket fees to places such as the sugar museum, the chateau & the botanical garden', 'Lunch']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 8600, 'EUR', 4, 0);
    -- (no images; add in admin)
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='tea-wildlife-exploration') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'tea-wildlife-exploration', 'Tea & Wildlife Exploration Tour', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'A private southern tour combining tea heritage and wildlife: the Bois Cheri tea factory and museum, the Domaine des Aubineaux colonial estate, La Vanille Nature Park with giant tortoises and crocodiles, and the Gris Gris coastal viewpoint.', 'Explore Mauritius in comfort and style with Taxi Service Mauritius''s exclusive Tea & Wildlife Exploration Tour. Our private tours ensure personalized attention as you journey through the island''s most enchanting destinations. With a dedicated vehicle and driver at your service, enjoy the freedom to explore at your own pace. At Bois Cheri Tea Factory & Museum, delve into the rich history of Mauritius'' tea industry. Witness the tea-making process from leaf to cup and savour the aroma of freshly brewed blends. Explore the museum and learn about the cultural significance of tea on the island. Nestled amidst lush sugarcane fields, Domaine de St Aubin offers a glimpse into Mauritius'' colonial past. Wander through the beautifully preserved estate, admiring its elegant architecture and vibrant gardens. Step back in time at Domaine des Aubineaux, a charming colonial house in the heart of a fragrant tea plantation. Marvel at the exquisite architecture and stroll through meticulously landscaped gardens. Prepare for an adventure at La Vanille Crocodile Nature Park, home to diverse wildlife. Encounter giant tortoises, colourful butterflies, and majestic crocodiles as you explore the lush surroundings. Marvel at the breathtaking beauty of Gris Gris Viewpoint, where rugged cliffs meet the endless expanse of the Indian Ocean. End your journey at Senneville Cliffs, a hidden gem offering sweeping vistas of Mauritius'' dramatic coastline.', null, 360, true, false, 0, ARRAY['Trou aux Cerfs Volcano Crater', 'Grand Bassin (Ganga Talao)', 'Bois Cheri Tea Factory & Museum', 'Domaine des Aubineaux', 'La Vanille Nature Park', 'Gris Gris Viewpoint']::text[], ARRAY['Pick up and drop off from any hotel or Airbnb''s in Mauritius', 'Private transportation to all the sights mentioned above', 'A friendly English/French-speaking driver to guide you', 'First child seat ordered is free of charge']::text[], ARRAY['Entry ticket fees to places such as the Tea Factory & La Vanille Nature Park', 'Lunch']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 8600, 'EUR', 4, 0);
    -- (no images; add in admin)
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='south-west-splendor-expedition') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'south-west-splendor-expedition', 'South West Splendor Expedition', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'A six-hour private tour of the south-west coast featuring the Le Morne UNESCO World Heritage site and beach, the Baie du Cap / Maconde viewpoint, the World of Seashells Museum, and the Lavilleon Adventure Park.', 'Embark on a six-hour journey exploring the majestic Le Morne World Heritage Site, serene Le Morne Beach, breathtaking Baie du Cap/Maconde Viewpoint, the fascinating World of Seashells Museum, and thrilling Lavilleon Adventure Park. Experience exclusive, tailored moments with a private vehicle, complimentary child seat, and flexible start times between 7:30-9:30 AM. The tour unveils stories of bravery and freedom at Le Morne, a UNESCO World Heritage mountain symbolizing cultural significance. Le Morne Beach offers soft white sands and crystal-clear waters for relaxation. Baie du Cap presents dramatic coastal views where ocean meets rugged cliffs. The World of Seashells Museum showcases one of the largest shell collections. Lavilleon Adventure Park offers zip-lining, archery, and outdoor activities in lush greenery.', null, 360, true, false, 0, ARRAY['Le Morne World Heritage Site', 'Le Morne Beach', 'Baie du Cap / Maconde Viewpoint', 'World of Seashells Museum', 'Lavilleon Adventure Park']::text[], ARRAY['Pick up and drop off from any hotel or Airbnb in Mauritius', 'Private transportation to all the sights mentioned', 'An English/French-speaking driver to guide you and provide information', 'Complimentary child seat']::text[], ARRAY['Entry ticket fees to the World of Seashells Museum and Lavilleon Adventure Park', 'Lunch']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 8600, 'EUR', 4, 0);
    -- (no images; add in admin)
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='journey-through-mauritian-history') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'journey-through-mauritian-history', 'Mauritian History Tour', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'A private south-east heritage tour covering Blue Bay Marine Park, the Mahebourg Museum, a traditional manioc biscuit factory, the Mahebourg waterfront, the Dutch First Landing Monument, and the Frederik Hendrik Museum.', 'Journey through the South-East of Mauritius discovering the island''s rich history and natural beauty. The tour encompasses the vibrant Blue Bay Marine Park with crystal-clear waters and coral reefs, the Mahebourg Museum showcasing colonial past and naval history, the traditional Manioc Biscuit Factory producing cassava biscuits using authentic recipes, the scenic Mahebourg Waterfront with ocean views, the Dutch First Landing Monument commemorating early European settlers, and the Frederik Hendrik Museum preserving archaeological artifacts from the first Dutch settlement. This private, personalized experience offers an immersive journey through time with expert guides and comfortable transport.', null, 420, true, false, 0, ARRAY['Blue Bay Marine Park', 'Mahebourg Museum', 'Manioc Biscuit Factory', 'Mahebourg Waterfront', 'Dutch First Landing Monument', 'Frederik Hendrik Museum']::text[], ARRAY['Pick up and drop off from any hotel or Airbnb in Mauritius', 'Private transportation to all the sights mentioned', 'An English/French-speaking driver to guide you and provide information']::text[], ARRAY['Entry ticket fees to museums', 'Lunch']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 8600, 'EUR', 4, 0);
    -- (no images; add in admin)
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='port-louis-city-tour') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'port-louis-city-tour', 'Port Louis City Tour (6hrs)', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'A private, personalised tour through the capital Port Louis, taking in viewpoints, Hindu temples, the Caudan Waterfront, Chinatown and bazaar, the Citadel Fort and the Odysseo Oceanarium with an English/French-speaking driver.', 'Embark on a captivating journey through the heart of Mauritius with the Port Louis City Tour, a comprehensive exploration of the capital''s rich tapestry of history, culture, and contemporary allure. The tour begins at the Marie Reine de la Paix Viewpoint, a serene haven with sweeping views of Port Louis framed against the Moka mountain range. Next, visitors immerse themselves in the spiritual and architectural grandeur of vibrant Hindu temples adorned with intricate carvings and vivid colors. The Caudan Waterfront presents the modern face of Mauritius—a bustling promenade featuring shopping, dining, and entertainment with stunning harbor views. The journey continues through Chinatown''s narrow streets and traditional shops, the historic bazaar with its colors and scents, and museums providing deeper cultural understanding. The Citadel Fort, perched atop a hill, offers panoramic views spanning the cityscape and harbor. The tour concludes at the Odysseo Oceanarium, a state-of-the-art facility showcasing diverse marine life and aquatic ecosystems. Throughout the experience, visitors gain profound understanding of the island''s past and present through a private, personalized journey with an English/French-speaking driver.', null, 360, true, false, 0, ARRAY['Marie Reine de la Paix Viewpoint (Optional)', 'Colourful Temple in Port Louis (Optional)', 'Port Louis Caudan Waterfront', 'Chinatown / Bazaar / Blue Penny Museum Visit', 'Citadel Fort (Fort Adelaide)', 'Odysseo Oceanarium']::text[], ARRAY['Pick up and drop off from any hotel or Airbnb in Mauritius', 'Private transportation to all sights', 'English/French-speaking driver to guide and provide information', 'First child seat (free of charge, upon request)']::text[], ARRAY['Entry ticket fees to places (Blue Penny Museum, etc.)', 'Lunch (customers choose restaurants; driver offers recommendations)']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 8600, 'EUR', 4, 0);
    -- (no images; add in admin)
  end if;
end $bmt$;

do $bmt$
declare v_aid uuid; v_oid uuid;
begin
  if not exists (select 1 from activities where slug='north-beaches-tour') then
    insert into activities (id, operator_id, slug, title, type, category, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, is_custom_planner, rating_count, highlights, inclusions, exclusions, languages, extra)
    values (gen_random_uuid(), (select id from operators where slug='belle-mare-tours'), 'north-beaches-tour', 'Beach Hopping Tour (North Beaches)', 'activity', 'Private Sightseeing tours', 'vehicle', 'draft', 'An exclusive private beach-hopping day tour to five northern Mauritius beaches with complimentary beach chairs, umbrella, mat, snacks and drinks, and an English/French-speaking driver.', 'An exclusive private beach tour exploring five northern Mauritius beaches in a single day. Visitors are transported by dedicated chauffeur across Trou aux Biches, Mont Choisy, La Cuvette, Grand Bay, and Pereybere beaches. The experience includes complimentary beach chairs, umbrellas, mats, snacks, and refreshing drinks. Each beach offers distinct characteristics: Mont Choisy features crystal waters and marine life; Pereybere provides vibrant atmosphere with local cafes; Grand Bay offers water sports and shopping; Trou aux Biches delivers serene, family-friendly conditions; La Cuvette provides a secluded, tranquil escape. The driver assists with beach setup and provides English/French-speaking guidance throughout.', null, 330, true, false, 0, ARRAY['Trou aux Biches Beach', 'Mont Choisy Beach', 'La Cuvette Beach', 'Grand Bay Beach', 'Pereybere Beach']::text[], ARRAY['Pickup and drop-off from any hotel/Airbnb in Mauritius', 'Private vehicle and transportation between beaches', 'English/French-speaking driver', 'Supermarket stop on route', 'One beach umbrella, two beach chairs, one beach mat (minimum)', 'Snacks and chilled soft drinks', 'First child seat (upon request)']::text[], ARRAY['Lunch (though driver provides restaurant recommendations)', 'Entry tickets to visiting places', 'Additional beach chairs/umbrellas beyond specified amounts']::text[], ARRAY['English','French']::text[], '{}'::jsonb)
    returning id into v_aid;
    insert into activity_options (id, activity_id, name, status, position) values (gen_random_uuid(), v_aid, 'Private Group', 'active', 0) returning id into v_oid;
    insert into activity_option_prices (id, activity_option_id, label, amount_minor, currency, max_guests, position) values (gen_random_uuid(), v_oid, 'Adult, Up to 4', 11000, 'EUR', 4, 0);
    -- (no images; add in admin)
  end if;
end $bmt$;

-- Verify:  select category, pricing_mode, count(*) from activities group by 1,2 order by 1;

-- Optional: publish everything that was just re-seeded (comment out to keep them draft).
-- update activities set status='published' where operator_id = (select id from operators where slug='belle-mare-tours');
