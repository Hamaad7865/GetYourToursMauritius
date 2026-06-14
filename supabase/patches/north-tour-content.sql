-- Real content for the "North Tour" activity (provided by the operator), loaded into
-- the live DB. Idempotent: safe to re-run. Images are PLACEHOLDER photos (picsum) —
-- swap activity_images.url for the operator's real photos.

update activities set
  title = 'North Tour – Port Louis, Pamplemousses & Cap Malheureux',
  summary = 'Private full-day tour of North Mauritius with a driver-guide: Port Louis and its central market, the Pamplemousses Botanical Garden, Grand Baie and the red-roof church of Cap Malheureux.',
  description = 'Discover the beauty, culture, and history of North Mauritius on this private full-day tour. Travel comfortably with an experienced local driver-guide and explore some of the island''s most famous attractions.

Your journey begins in Port Louis, the vibrant capital city, where you can visit the Central Market, Caudan Waterfront, and Chinatown. Continue to the historic Citadel Fortress for breathtaking panoramic views of the city and harbour.

Next, visit the famous Pamplemousses Botanical Garden, one of the oldest botanical gardens in the Southern Hemisphere, known for its giant water lilies and exotic plants. Continue to Château de Labourdonnais, a beautifully restored colonial mansion surrounded by lush orchards.

Head north to the picturesque village of Cap Malheureux and admire its iconic red-roof church overlooking the turquoise lagoon. Along the way, enjoy scenic coastal views, local culture, and opportunities to take memorable photos.

This private tour offers flexibility, comfort, and personalized service, making it perfect for couples, families, and small groups seeking to experience the best of North Mauritius in one unforgettable day.',
  duration_minutes = 480,
  pickup_available = true,
  meeting_point = 'Hotel, Airbnb, guesthouse or cruise-port pickup across Mauritius',
  languages = array['English', 'French']::text[],
  highlights = array[
    'Explore Port Louis and its bustling central market',
    'Panoramic harbour views from the Citadel (Fort Adelaide)',
    'Pamplemousses Botanical Garden — giant water lilies and exotic plants',
    'Grand Baie and the iconic red-roof church of Cap Malheureux',
    'A private driver-guide at your service all day',
    'Fully customisable itinerary — add turtles, diving or Château de Labourdonnais'
  ]::text[],
  inclusions = array[
    'Private transportation in a comfortable air-conditioned vehicle',
    'Professional driver-guide',
    'Hotel, Airbnb, or port pickup and drop-off',
    'Visit to Caudan Waterfront',
    'Visit to Port Louis Central Market',
    'Visit to Citadel Fortress (Fort Adelaide)',
    'Visit to Aapravasi Ghat World Heritage Site',
    'Visit to Sir Seewoosagur Ramgoolam Botanical Garden (Pamplemousses)',
    'Visit to Cap Malheureux Red Roof Church',
    'Visit to Grand-Baie Public Beach',
    'Flexible itinerary and photo stops',
    'Fuel and parking fees'
  ]::text[],
  exclusions = array[
    'Entrance fees to attractions and museums',
    'Food and drinks unless specified',
    'Personal expenses and souvenirs',
    'Optional activities not mentioned in the itinerary'
  ]::text[],
  cancellation_policy = 'Free cancellation up to 24 hours before for a full refund.',
  rating_avg = 4.8,
  rating_count = 126,
  extra = jsonb_build_object(
    'availability', 'Every day',
    'startWindow', 'Departure between 8:30 and 10:00 AM',
    'returnWindow', 'Back at your hotel between 5:30 and 6:30 PM',
    'itinerary', jsonb_build_array(
      jsonb_build_object('title', 'Port Louis', 'area', 'Capital'),
      jsonb_build_object('title', 'Central Market', 'area', 'Capital'),
      jsonb_build_object('title', 'Pamplemousses Botanical Garden', 'area', 'North'),
      jsonb_build_object('title', 'Grand Baie', 'area', 'North'),
      jsonb_build_object('title', 'Cap Malheureux', 'area', 'North')
    ),
    'importantInfo', jsonb_build_array(
      'This is a private tour, and only your group will participate.',
      'Comfortable clothing, walking shoes, sunscreen, sunglasses, and a hat are recommended.',
      'The itinerary can be customized according to your preferences and available time.',
      'Some attractions may charge entrance fees, which are not included unless stated otherwise.',
      'Pickup and drop-off are available from hotels, guesthouses, Airbnb accommodations, the cruise port, and selected locations across Mauritius.',
      'Infant seats can be provided upon request.',
      'The duration of the tour may vary depending on traffic and the time spent at each attraction.',
      'Bring a camera to capture the beautiful scenery and landmarks of North Mauritius.'
    )
  )
where slug = 'north-tour';

-- Priced option: private group up to 4 at €70.
insert into activity_options (activity_id, name)
select a.id, 'Private group (up to 4)'
from activities a
where a.slug = 'north-tour'
  and not exists (
    select 1 from activity_options o where o.activity_id = a.id and o.name = 'Private group (up to 4)'
  );

insert into activity_option_prices (activity_option_id, label, amount_minor, currency, max_guests)
select o.id, 'Private group', 7000, 'EUR', 4
from activity_options o
join activities a on a.id = o.activity_id
where a.slug = 'north-tour' and o.name = 'Private group (up to 4)'
  and not exists (
    select 1 from activity_option_prices pr where pr.activity_option_id = o.id and pr.label = 'Private group'
  );

-- Gallery (PLACEHOLDER photos — replace url with the operator's real images).
delete from activity_images
where activity_id = (select id from activities where slug = 'north-tour');

insert into activity_images (activity_id, url, alt, position)
select a.id, img.url, img.alt, img.position
from activities a
cross join (values
  ('https://picsum.photos/seed/north-tour-portlouis/1200/800', 'Port Louis waterfront', 0),
  ('https://picsum.photos/seed/north-tour-market/900/700', 'Port Louis central market', 1),
  ('https://picsum.photos/seed/north-tour-garden/900/700', 'Pamplemousses Botanical Garden', 2),
  ('https://picsum.photos/seed/north-tour-grandbaie/900/700', 'Grand Baie', 3),
  ('https://picsum.photos/seed/north-tour-capmalheureux/900/700', 'Cap Malheureux red-roof church', 4)
) as img(url, alt, position)
where a.slug = 'north-tour';
