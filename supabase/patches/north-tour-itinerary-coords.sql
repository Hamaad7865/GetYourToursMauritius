-- Adds real coordinates to each North Tour itinerary stop so the detail-page map can
-- drop a pin per location (GetYourGuide style). Idempotent.
update activities set
  extra = jsonb_set(
    extra,
    '{itinerary}',
    jsonb_build_array(
      jsonb_build_object('title', 'Port Louis', 'area', 'Capital',
        'tags', jsonb_build_array('Guided tour', 'Sightseeing', 'Photo stop'),
        'lat', -20.1609, 'lng', 57.5012),
      jsonb_build_object('title', 'Central Market', 'area', 'Capital',
        'tags', jsonb_build_array('Visit', 'Shopping', 'Walk'),
        'lat', -20.1610, 'lng', 57.4977),
      jsonb_build_object('title', 'Citadel (Fort Adelaide)', 'area', 'Capital',
        'tags', jsonb_build_array('Photo stop', 'Panoramic view'),
        'lat', -20.1647, 'lng', 57.5006),
      jsonb_build_object('title', 'Pamplemousses Botanical Garden', 'area', 'North',
        'tags', jsonb_build_array('Visit', 'Guided tour', 'Walk'),
        'lat', -20.1041, 'lng', 57.5790),
      jsonb_build_object('title', 'Grand Baie', 'area', 'North',
        'tags', jsonb_build_array('Free time', 'Photo stop'),
        'lat', -20.0137, 'lng', 57.5803),
      jsonb_build_object('title', 'Cap Malheureux', 'area', 'North',
        'tags', jsonb_build_array('Photo stop', 'Sightseeing'),
        'lat', -19.9837, 'lng', 57.6142)
    )
  )
where slug = 'north-tour';
