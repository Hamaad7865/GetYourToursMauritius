-- Adds per-stop activity tags to the North Tour itinerary so the timeline matches the
-- GetYourGuide layout (e.g. "Visit · Guided tour · Photo stop"). Idempotent.
update activities set
  extra = jsonb_set(
    extra,
    '{itinerary}',
    jsonb_build_array(
      jsonb_build_object('title', 'Port Louis', 'area', 'Capital',
        'tags', jsonb_build_array('Guided tour', 'Sightseeing', 'Photo stop')),
      jsonb_build_object('title', 'Central Market', 'area', 'Capital',
        'tags', jsonb_build_array('Visit', 'Shopping', 'Walk')),
      jsonb_build_object('title', 'Citadel (Fort Adelaide)', 'area', 'Capital',
        'tags', jsonb_build_array('Photo stop', 'Panoramic view')),
      jsonb_build_object('title', 'Pamplemousses Botanical Garden', 'area', 'North',
        'tags', jsonb_build_array('Visit', 'Guided tour', 'Walk')),
      jsonb_build_object('title', 'Grand Baie', 'area', 'North',
        'tags', jsonb_build_array('Free time', 'Photo stop')),
      jsonb_build_object('title', 'Cap Malheureux', 'area', 'North',
        'tags', jsonb_build_array('Photo stop', 'Sightseeing'))
    )
  )
where slug = 'north-tour';
