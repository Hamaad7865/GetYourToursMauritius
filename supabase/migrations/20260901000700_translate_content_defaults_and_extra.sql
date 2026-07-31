-- Closes the last French-localisation gap on the activity page: the "Informations importantes" /
-- "À savoir avant de partir" block was rendering English for a French visitor. Two sources fed it and
-- neither had a locale dimension:
--   (1) activity_content_defaults — per-category shared copy (highlights/inclusions/exclusions/
--       whatToBring/importantInfo), served by api_content_defaults keyed by category only.
--   (2) activities.extra (itinerary, whatToBring, importantInfo, plus operational flags like
--       availability/badges/priceList/adultsOnly/inquiryOnly), returned raw by api_get_activity.
--
-- Both now resolve PER FIELD against the English row, exactly like every other translated field in this
-- catalogue (title/summary/description/highlights/inclusions/exclusions already work this way — see
-- 20260901000100_localised_catalogue_rpcs.sql).

-- ============================================================================================
-- PART A — locale on activity_content_defaults
-- ============================================================================================

alter table activity_content_defaults
  add column if not exists locale content_locale not null default 'en';

-- Re-key (category) -> (category, locale). `drop ... if exists` + unconditional `add` keeps this
-- re-runnable: a second pass drops the composite key it just added and recreates the same one.
alter table activity_content_defaults drop constraint if exists activity_content_defaults_pkey;
alter table activity_content_defaults add constraint activity_content_defaults_pkey primary key (category, locale);

-- Locale-aware api_content_defaults: resolve PER FIELD against the English ('en') row for the same
-- category, via nullif('{}') — these array columns are `not null default '{}'`, so an empty array means
-- "untranslated", not "translated to nothing"; a plain coalesce would render an empty list instead of
-- falling back. `e` is always the English row (the baseline); `f` is the requested-locale row (defaults
-- to 'en', so an absent `locale` key behaves exactly as before this migration — `f` and `e` are then the
-- same row and every coalesce is a no-op). Returns the same shape as before (keyed by category, camelCase
-- keys), so no caller needs to change.
create or replace function api_content_defaults(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(e.category, jsonb_build_object(
    'highlights', to_jsonb(coalesce(nullif(f.highlights, '{}'), e.highlights)),
    'inclusions', to_jsonb(coalesce(nullif(f.inclusions, '{}'), e.inclusions)),
    'exclusions', to_jsonb(coalesce(nullif(f.exclusions, '{}'), e.exclusions)),
    'whatToBring', to_jsonb(coalesce(nullif(f.what_to_bring, '{}'), e.what_to_bring)),
    'importantInfo', to_jsonb(coalesce(nullif(f.important_info, '{}'), e.important_info))
  )), '{}'::jsonb)
  from activity_content_defaults e
  left join activity_content_defaults f
    on f.category = e.category
   and f.locale = coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale
  where e.locale = 'en';
$$;
grant execute on function api_content_defaults(jsonb) to anon, authenticated, service_role;

-- ============================================================================================
-- PART B — translated activities.extra
-- ============================================================================================

alter table activity_translations add column if not exists extra jsonb;

comment on column activity_translations.extra is
  'Only the FR-translatable subset of activities.extra: itinerary / whatToBring / importantInfo. Never '
  'operational flags (availability, startWindow, returnWindow, badges, priceList, adultsOnly, '
  'inquiryOnly, isPrivate, ...) — those always come from the English activities.extra column.';

-- api_get_activity, re-applied VERBATIM from its WINNING body (20260901000100_localised_catalogue_rpcs.sql,
-- copied from supabase/setup.sql — that migration already shipped to production, so it is NOT edited
-- here; see docs/handbook/database.md, "Its twin: appending to a migration that has already run").
-- The ONLY change is the `extra` line: `a.extra || coalesce(t.extra, '{}'::jsonb)`. jsonb `||` merges
-- top-level keys with the RIGHT operand winning, which gives per-key fallback for free — a French
-- `extra` defining only `importantInfo` overrides that one key and leaves itinerary, badges,
-- availability and every other key exactly as English.
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', coalesce(t.title, a.title),
    'summary', coalesce(t.summary, a.summary),
    'description', coalesce(t.description, a.description), 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', coalesce(t.meeting_point, a.meeting_point),
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(coalesce(nullif(t.inclusions, '{}'), a.inclusions)),
    'exclusions', to_jsonb(coalesce(nullif(t.exclusions, '{}'), a.exclusions)),
    'highlights', to_jsonb(coalesce(nullif(t.highlights, '{}'), a.highlights)), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', coalesce(t.seo_title, a.seo_title), 'seoDescription', coalesce(t.seo_description, a.seo_description),
    'extra', a.extra || coalesce(t.extra, '{}'::jsonb),
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        -- Per-OPTION front price, then min across options (mirrors api_search_activities).
        select min(case when opt.banded then opt.max_amt else coalesce(opt.min_paid, opt.min_amt) end)::float / 100
        from (
          select bool_or(pr.min_age is not null or pr.max_age is not null) as banded,
                 max(pr.amount_minor) as max_amt,
                 min(pr.amount_minor) filter (where pr.amount_minor > 0) as min_paid,
                 min(pr.amount_minor) as min_amt
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
          group by pr.activity_option_id
        ) opt
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description, 'durationMinutes', o.duration_minutes, 'startWindow', o.start_window,
        'privateBaseEur', o.private_base_minor::float / 100,
        'privateIncluded', o.private_included,
        'privateExtraEur', o.private_extra_minor::float / 100,
        'privateMaxGuests', o.private_max_guests,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  left join activity_translations t
    on t.activity_id = a.id
   and t.locale = coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale
  where a.slug = p ->> 'slug';
$$;
grant execute on function api_get_activity(jsonb) to anon, authenticated, service_role;

-- ============================================================================================
-- PART C — the French content
-- ============================================================================================

-- Seed French rows for activity_content_defaults (locale = 'fr').
-- `on conflict do nothing`: never stomp a French edit the owner has since made in /admin.

insert into activity_content_defaults (category, locale, highlights, important_info) values (
  'Taxi Sightseeing tours',
  'fr'::content_locale,
  ARRAY['Véhicule privé climatisé avec un chauffeur-guide professionnel anglophone — exclusivement pour votre groupe, jamais partagé.', 'Prise en charge et retour porte-à-porte à l’hôtel ou au port, partout à Maurice, inclus dans le prix.', 'Départ matinal flexible — commencez votre journée à l’heure de votre choix entre 7h30 et 9h30.', 'Un itinéraire entièrement flexible — ajoutez, remplacez ou sautez des étapes le jour même selon votre rythme et vos envies.', 'Premier siège enfant gratuit et bouteilles d’eau offertes à bord.', 'Un prix fixe tout compris, sans frais cachés — payez en ligne en toute sécurité et recevez une confirmation instantanée.']::text[],
  ARRAY['Les frais d’entrée aux attractions, musées, jardins et parcs naturels ne sont pas inclus dans le prix du circuit. Prévoyez des espèces (roupies mauriciennes) pour les régler sur place — de nombreux sites n’acceptent pas les cartes.', 'Le déjeuner et les dépenses personnelles ne sont pas inclus sauf mention contraire ; votre chauffeur-guide se fera un plaisir de vous recommander de bonnes adresses locales et de s’arrêter où vous le souhaitez.', 'Prévoyez une protection solaire, des chaussures de marche confortables et un maillot de bain si votre itinéraire comprend une étape à la plage ou à une cascade.', 'Les temps de trajet entre les étapes sont approximatifs et dépendent de la circulation ainsi que du temps que vous choisissez de passer à chaque endroit.', 'Une tenue modeste (épaules et genoux couverts) est requise pour entrer dans les temples et autres lieux de culte, comme Grand Bassin.']::text[]
)
on conflict (category, locale) do nothing;

insert into activity_content_defaults (category, locale, what_to_bring, important_info) values (
  'Catamaran cruises',
  'fr'::content_locale,
  ARRAY['Chaussures confortables', 'Lunettes de soleil', 'Chapeau', 'Maillot de bain', 'Vêtements de rechange', 'Serviette', 'Appareil photo', 'Crème solaire', 'Équipement de snorkeling']::text[],
  ARRAY['Les bébés de 1 à 4 ans voyagent gratuitement.', 'Tous les repas sont halal. Les repas végétariens doivent être demandés à l’avance.', 'La prise en charge et le retour sont disponibles si l’option correspondante est sélectionnée.', 'Un parking public est disponible à 60 m du point de rendez-vous. Merci d’arriver tôt pour être sûr d’avoir une place. Contactez notre équipe sur WhatsApp pour l’emplacement.', 'L’itinéraire peut être modifié en raison de la météo, de l’état de la mer, des marées ou de contraintes opérationnelles pour la sécurité des passagers.', 'Les décisions du capitaine concernant la navigation, les horaires et les modifications de l’itinéraire sont définitives et prises dans l’intérêt de la sécurité des passagers.', 'Les passagers en fauteuil roulant doivent se tenir debout brièvement pour monter à bord de la navette et en descendre, avec l’aide de notre équipage, afin d’accéder au catamaran.', 'Pour leur confort et leur sécurité, les passagers sont invités à garder leurs effets personnels avec eux à tout moment. La société ne pourra être tenue responsable de toute perte, vol, dommage ou égarement d’objets personnels pendant l’excursion.']::text[]
)
on conflict (category, locale) do nothing;

insert into activity_content_defaults (category, locale, important_info) values (
  'Private Cruises',
  'fr'::content_locale,
  ARRAY['Les bébés de 1 à 4 ans voyagent gratuitement.', 'Tous les repas sont halal. Les repas végétariens doivent être demandés à l’avance.', 'La prise en charge et le retour sont disponibles si l’option correspondante est sélectionnée.', 'Un parking public est disponible à 60 m du point de rendez-vous. Merci d’arriver tôt pour être sûr d’avoir une place. Contactez notre équipe sur WhatsApp pour l’emplacement.', 'L’itinéraire peut être modifié en raison de la météo, de l’état de la mer, des marées ou de contraintes opérationnelles pour la sécurité des passagers.', 'Les décisions du capitaine concernant la navigation, les horaires et les modifications de l’itinéraire sont définitives et prises dans l’intérêt de la sécurité des passagers.', 'Les passagers en fauteuil roulant doivent se tenir debout brièvement pour monter à bord de la navette et en descendre, avec l’aide de notre équipage, afin d’accéder au catamaran.', 'Pour leur confort et leur sécurité, les passagers sont invités à garder leurs effets personnels avec eux à tout moment. La société ne pourra être tenue responsable de toute perte, vol, dommage ou égarement d’objets personnels pendant l’excursion.']::text[]
)
on conflict (category, locale) do nothing;

-- Translated activity_translations.extra, keyed by slug (production catalogue data that lives only in
-- the live DB, not in any seed migration — matched by slug so this is a safe no-op on a fresh/local DB
-- that never had these activities). Only the FR-translatable keys are written: itinerary / whatToBring /
-- importantInfo. Every other extra key (availability, startWindow, returnWindow, badges, priceList,
-- adultsOnly, inquiryOnly, isPrivate, ...) is never touched here — api_get_activity merges
-- a.extra || t.extra so those keep coming from the English `extra` column. Stop TITLES are copied
-- verbatim (never translated — they are real place names); `area`, `tags` and `description` are
-- translated where they are prose/descriptors rather than a place name.

update activity_translations t set extra = '{"itinerary":[{"title":"Grand Baie, Sunset Boulevard","tags":[],"description":"Départ"},{"title":"Gabriel Island","tags":[],"description":"Visite"},{"title":"Flat Island","tags":[],"description":null},{"title":"Gunner''s Quoin","tags":[],"description":"Snorkeling"}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'catamaran-cruise-3-northern-island-adventure' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Trou D''eau Douce","tags":[],"description":"Départ"},{"title":"G.R.S.E Waterfall","tags":[],"description":"Visite touristique,Photo"},{"title":"Ile aux cerfs","tags":[],"description":"Snorkeling,Déjeuner à bord"},{"title":"Ile aux  cerfs","tags":[],"description":"visite de l’île"}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'catamaran-cruise-ile-aux-cerfs' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Route Royale Maho, Trou d''Eau Douce","tags":[],"description":"Départ"},{"title":"Grand River South East","tags":["Visite touristique","En passant","Vue panoramique"],"description":null},{"title":"Fouquets Island","tags":["Visite touristique","Snorkeling","Baignade","Observation de la vie marine"],"description":"Coin secret"},{"title":"Île de la Passe","tags":["Visite touristique"],"description":null},{"title":"Aigrette Island","tags":["Pause","Arrêt photo","Boisson","Baignade"],"description":null},{"title":"Île aux Cerfs","tags":["Arrêt photo","Visite","Croisière en bateau","Promenade","Baignade","Vue panoramique en chemin"],"description":null}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'catapseed-5-islands' and t.locale = 'fr';

update activity_translations t set extra = '{"importantInfo":["Merci d’arriver au point d’embarquement au moins 15 minutes avant l’heure de départ prévue.","L’itinéraire vers le point d’embarquement est disponible sur Google Maps.","Merci de ne pas boire d’alcool si vous devez conduire !","Prise en charge et retour disponibles partout sur l’île.","Frais d’annulation de 50 % pour toute annulation dans les 24 heures précédant l’excursion.","Frais d’annulation de 100 % pour toute annulation le jour de l’excursion.","Si l’annulation est faite par Belle Mare Tours Ltd, un remboursement intégral sera effectué par virement bancaire sur le compte du client.","Modes de paiement : le paiement peut être effectué en espèces auprès du chauffeur en MUR, EUR ou USD, ou en ligne avant votre excursion."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'helicotour' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Grand Bay Beach","area":"Région Nord","tags":[],"description":null},{"title":"Pereybere Beach","area":"Région Nord","tags":[],"description":null},{"title":"Mont Choisy Beach","area":"Région Nord","tags":[],"description":null},{"title":"Trou Aux Biches","area":"Région Nord","tags":[],"description":null},{"title":"Cap Malheureux","area":"Région Nord","tags":[],"description":null}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'north-beaches-tour' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Port Louis","area":"Capitale","tags":["Visite guidée","Visite touristique","Arrêt photo"],"description":null},{"title":"Central Market","area":"Capitale","tags":["Visite","Shopping","Promenade"],"description":null},{"title":"Pamplemousses Botanical Garden","area":"Nord","tags":["Visite","Visite guidée","Promenade"],"description":null},{"title":"Grand Baie","area":"Nord","tags":["Temps libre","Arrêt photo"],"description":null},{"title":"Cap Malheureux","area":"Nord","tags":["Arrêt photo","Visite touristique"],"description":null}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'north-tour' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Port-Louis Caudan Waterfront","area":"Capitale","tags":[],"description":null},{"title":"Chinatown","area":"Capitale","tags":["Marché","Bazar"],"description":null},{"title":"Citadel Fort","area":"Capitale","tags":[],"description":null},{"title":"Odysseo Oceanarium","area":"Capitale","tags":[],"description":null},{"title":"Tamil Temple","area":"Capitale","tags":[],"description":null}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'port-louis-city-tour' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Bain Boeuf","tags":[],"description":"Départ"},{"title":"Gunner''s Quoin","tags":[],"description":"Snorkeling"},{"title":"Gabriel Island","tags":[],"description":"Visite touristique"},{"title":"Flat Island","tags":[],"description":"Visite touristique"}],"whatToBring":["Chaussures confortables","Lunettes de soleil","Chapeau","Serviette","Équipement de snorkeling","Vêtements de rechange"],"importantInfo":["Les bébés de 1 à 4 ans voyagent gratuitement.","Tous les repas sont halal. Les repas végétariens doivent être demandés à l’avance.","La prise en charge et le retour sont disponibles si l’option correspondante est sélectionnée.","Un parking public est disponible à 60 m du point de rendez-vous. Merci d’arriver tôt pour être sûr d’avoir une place. Contactez notre équipe sur WhatsApp pour l’emplacement.","L’itinéraire peut être modifié en raison de la météo, de l’état de la mer, des marées ou de contraintes opérationnelles pour la sécurité des passagers.","Les décisions du capitaine concernant la navigation, les horaires et les modifications de l’itinéraire sont définitives et prises dans l’intérêt de la sécurité des passagers.","Les passagers en fauteuil roulant doivent se tenir debout brièvement pour monter à bord de la navette et en descendre, avec l’aide de notre équipage, afin d’accéder au catamaran.","Pour leur confort et leur sécurité, les passagers sont invités à garder leurs effets personnels avec eux à tout moment. La société ne pourra être tenue responsable de toute perte, vol, dommage ou égarement d’objets personnels pendant l’excursion."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-full-day-3-northern-island-speed-boat-with-lunch-bbq' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Grand Baie, Sunset Boulevard","tags":[],"description":"Départ"},{"title":"Gunner''s Quoin","tags":[],"description":"Snorkeling"},{"title":"Gabriel Island","tags":[],"description":"Visite"},{"title":"Flat Island","tags":[],"description":"Visite touristique"}],"whatToBring":["Chaussures confortables","Lunettes de soleil","Chapeau","Maillot de bain","Vêtements de rechange","Serviette","Appareil photo","Crème solaire","Équipement de snorkeling"],"importantInfo":["Les bébés de 1 à 4 ans voyagent gratuitement.","Tous les repas sont halal. Les repas végétariens doivent être demandés à l’avance.","La prise en charge et le retour sont disponibles si l’option correspondante est sélectionnée.","Un parking public est disponible à 60 m du point de rendez-vous. Merci d’arriver tôt pour être sûr d’avoir une place. Contactez notre équipe sur WhatsApp pour l’emplacement.","L’itinéraire peut être modifié en raison de la météo, de l’état de la mer, des marées ou de contraintes opérationnelles pour la sécurité des passagers.","Les décisions du capitaine concernant la navigation, les horaires et les modifications de l’itinéraire sont définitives et prises dans l’intérêt de la sécurité des passagers.","Les passagers en fauteuil roulant doivent se tenir debout brièvement pour monter à bord de la navette et en descendre, avec l’aide de notre équipage, afin d’accéder au catamaran.","Pour leur confort et leur sécurité, les passagers sont invités à garder leurs effets personnels avec eux à tout moment. La société ne pourra être tenue responsable de toute perte, vol, dommage ou égarement d’objets personnels pendant l’excursion."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-full-day-3-northern-islands-adventure' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Trou d''eau douce","tags":[],"description":"Départ"},{"title":"Ile aux cerfs","tags":[],"description":"Visite touristique"},{"title":"Ile aux cerf Island","tags":[],"description":"Déjeuner BBQ et boissons sur la plage"},{"title":"G.R.S.E Waterfall","tags":[],"description":"Visite touristique"},{"title":"Ile aux phare","tags":[],"description":"Visite touristique"},{"title":"Ile de passe","tags":[],"description":"Photos"},{"title":"Aigrette island","tags":[],"description":"Baignade,Snorkeling"}],"whatToBring":["Lunettes de soleil","Chapeau","Maillot de bain","Serviette","Équipement de snorkeling"],"importantInfo":["Vous visiterez 3 îles, selon les marées. Certaines îles étant protégées par le gouvernement, nous passerons à proximité sans nous arrêter.","L’observation de dauphins et de singes est possible mais non garantie.","L’excursion peut être reportée en cas de mauvais temps ou de mer agitée.","Services de transfert hôtel/villa en option.","Les repas végétariens doivent être demandés à l’avance.","Arrivez au point d’embarquement au moins 15 minutes avant le début de la croisière","Merci de ne pas boire d’alcool si vous devez conduire"]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-full-day-5-islands-tour-ile-aux-cerfs-with-lunch' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Route Royale Maho, Trou d''Eau Douce","tags":[],"description":"Départ"},{"title":"Grand River South East Waterfall","tags":[],"description":"Visite touristique"},{"title":"Ile aux cerfs","tags":[],"description":"Snorkeling + déjeuner BBQ et boissons à bord"},{"title":"Ile aux cerfs","tags":[],"description":"Baignade et détente"}],"whatToBring":["Chaussures confortables","Lunettes de soleil","Chapeau","Maillot de bain","Vêtements de rechange","Serviette","Appareil photo","Crème solaire","Équipement de snorkeling"],"importantInfo":["Arrivez au point d’embarquement au moins 15 minutes avant le début de la croisière","Les passagers utilisant leur propre véhicule ne doivent pas boire d’alcool s’ils conduisent","Tous les repas sont halal. Les repas végétariens doivent être demandés à l’avance.","La prise en charge et le retour sont disponibles si l’option correspondante est sélectionnée.","Un parking public est disponible à 60 m du point de rendez-vous. Merci d’arriver tôt pour être sûr d’avoir une place. Contactez notre équipe sur WhatsApp pour plus d’informations.","L’itinéraire peut être modifié en raison de la météo, de l’état de la mer, des marées ou de contraintes opérationnelles pour la sécurité des passagers.","Les décisions du capitaine concernant la navigation, les horaires et les modifications de l’itinéraire sont définitives et prises dans l’intérêt de la sécurité des passagers.","Les passagers en fauteuil roulant doivent se tenir debout brièvement pour monter à bord de la navette et en descendre, avec l’aide de notre équipage, afin d’accéder au catamaran.","Pour leur confort et leur sécurité, les passagers sont invités à garder leurs effets personnels avec eux à tout moment. La société ne pourra être tenue responsable de toute perte, vol, dommage ou égarement d’objets personnels pendant l’excursion."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-full-day-catamaran-ile-aux-cerfs' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Route Royale Maho, Trou d''Eau Douce","tags":[],"description":"Départ"},{"title":"Ile aux cerfs","tags":[],"description":"Snorkeling + déjeuner BBQ et boissons à bord"},{"title":"Ile aux cerfs","tags":[],"description":"Baignade et détente"},{"title":"Grand River South East Waterfall","tags":[],"description":"Visite touristique"}],"whatToBring":["Chaussures confortables","Serviette","Équipement de snorkeling","Crème solaire","Maillot de bain"],"importantInfo":["Arrivez au point d’embarquement au moins 15 minutes avant le début de la croisière","Les passagers utilisant leur propre véhicule ne doivent pas boire d’alcool s’ils conduisent","Tous les repas sont halal. Les repas végétariens doivent être demandés à l’avance.","La prise en charge et le retour sont disponibles si l’option correspondante est sélectionnée.","Un parking public est disponible à 60 m du point de rendez-vous. Merci d’arriver tôt pour être sûr d’avoir une place. Contactez notre équipe sur WhatsApp pour plus d’informations.","L’itinéraire peut être modifié en raison de la météo, de l’état de la mer, des marées ou de contraintes opérationnelles pour la sécurité des passagers.","Les décisions du capitaine concernant la navigation, les horaires et les modifications de l’itinéraire sont définitives et prises dans l’intérêt de la sécurité des passagers.","Les passagers en fauteuil roulant doivent se tenir debout brièvement pour monter à bord de la navette et en descendre, avec l’aide de notre équipage, afin d’accéder au catamaran.","Pour leur confort et leur sécurité, les passagers sont invités à garder leurs effets personnels avec eux à tout moment. La société ne pourra être tenue responsable de toute perte, vol, dommage ou égarement d’objets personnels pendant l’excursion."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-full-day-cataspeed-ile-aux-cerfs' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Tamarin","tags":[],"description":"Départ"},{"title":"Tamarin Bay","tags":[],"description":"Baignade avec les dauphins"},{"title":"Crystal Rock","tags":[],"description":"Visite et snorkeling"},{"title":"Île aux Benitiers","tags":[],"description":"Visite touristique, déjeuner BBQ et boissons"}],"whatToBring":["Chaussures confortables","Lunettes de soleil","Chapeau","Serviette","Équipement de snorkeling","Vêtements de rechange"],"importantInfo":["Les bébés de 1 à 4 ans voyagent gratuitement.","Tous les repas sont halal. Les repas végétariens doivent être demandés à l’avance.","La prise en charge et le retour sont disponibles si l’option correspondante est sélectionnée.","L’itinéraire peut être modifié en raison de la météo, de l’état de la mer, des marées ou de contraintes opérationnelles pour la sécurité des passagers.","Les décisions du capitaine concernant la navigation, les horaires et les modifications de l’itinéraire sont définitives et prises dans l’intérêt de la sécurité des passagers.","Les passagers en fauteuil roulant doivent se tenir debout brièvement pour monter à bord de la navette et en descendre, avec l’aide de notre équipage, afin d’accéder au catamaran.","Pour leur confort et leur sécurité, les passagers sont invités à garder leurs effets personnels avec eux à tout moment. La société ne pourra être tenue responsable de toute perte, vol, dommage ou égarement d’objets personnels pendant l’excursion."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-full-day-dolphin-swimming-ile-aux-benitiers-with-lunch' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Trou d''Eau Douce","tags":[],"description":"Départ"},{"title":"Grand River South East","tags":[],"description":"Visite touristique de la cascade"},{"title":"Ile aux Cerfs","tags":[],"description":"Baignade et détente"},{"title":"Ilot Mangenie","tags":[],"description":"Déjeuner BBQ sur la plage"}],"whatToBring":["Lunettes de soleil","Serviette","Maillot de bain"],"importantInfo":["L’excursion peut être reportée en cas de mauvais temps ou de mer agitée.","Services de transfert hôtel/villa en option.","Les repas végétariens doivent être demandés à l’avance."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-full-day-speed-boat-ile-aux-cerf-with-lunch' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Black River","tags":[],"description":"Départ"},{"title":"Tamarin","tags":[],"description":"Coin secret\nObservation des dauphins"},{"title":"Crystal Rock, Tamarin","tags":[],"description":"Snorkeling"},{"title":"Benitier Island","tags":[],"description":"Déjeuner à bord"}],"whatToBring":["Chaussures confortables","Lunettes de soleil","Chapeau","Maillot de bain","Vêtements de rechange","Serviette","Appareil photo","Crème solaire","Équipement de snorkeling"],"importantInfo":["Les bébés de 1 à 4 ans voyagent gratuitement.","Tous les repas sont halal. Les repas végétariens doivent être demandés à l’avance.","La prise en charge et le retour sont disponibles si l’option correspondante est sélectionnée.","Un parking public est disponible à 60 m du point de rendez-vous. Merci d’arriver tôt pour être sûr d’avoir une place. Contactez notre équipe sur WhatsApp pour l’emplacement.","L’itinéraire peut être modifié en raison de la météo, de l’état de la mer, des marées ou de contraintes opérationnelles pour la sécurité des passagers.","Les décisions du capitaine concernant la navigation, les horaires et les modifications de l’itinéraire sont définitives et prises dans l’intérêt de la sécurité des passagers.","Les passagers en fauteuil roulant doivent se tenir debout brièvement pour monter à bord de la navette et en descendre, avec l’aide de notre équipage, afin d’accéder au catamaran.","Pour leur confort et leur sécurité, les passagers sont invités à garder leurs effets personnels avec eux à tout moment. La société ne pourra être tenue responsable de toute perte, vol, dommage ou égarement d’objets personnels pendant l’excursion."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-full-day-western-cruise-catamaran' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Floreal Factory Shop","area":"Région Centre","tags":[],"description":null},{"title":"Bagatelle Mall","area":"Région Centre","tags":[],"description":null},{"title":"Port-Louis Caudan Waterfront","area":"Capitale","tags":[],"description":null}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-shopping-tour' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Frederick Hendrick Musuem","area":"Région Sud","tags":[],"description":null},{"title":"Mahebourg Waterfront","area":"Région Sud","tags":[],"description":null},{"title":"Manioc Biscuit Factory Tour","area":"Région Sud","tags":[],"description":null},{"title":"Naval Mahebourg Museum","area":null,"tags":[],"description":null},{"title":"Blue Bay Beach","area":"Région Sud","tags":[],"description":null}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-south-east-tour' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Tamarin","tags":[],"description":"Départ"},{"title":"Tamarin","tags":[],"description":"Baignade avec les dauphins et snorkeling"}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'private-swimming-with-dolphins-only' and t.locale = 'fr';

update activity_translations t set extra = '{"importantInfo":["Merci d’arriver au point d’embarquement au moins 15 minutes avant l’heure de départ prévue.","L’itinéraire vers le point d’embarquement est disponible sur Google Maps.","Merci de ne pas boire d’alcool si vous devez conduire !","Prise en charge et retour disponibles partout sur l’île.","Frais d’annulation de 50 % pour toute annulation dans les 24 heures précédant l’excursion.","Frais d’annulation de 100 % pour toute annulation le jour de l’excursion.","Si l’annulation est faite par Belle Mare Tours Ltd, un remboursement intégral sera effectué par virement bancaire sur le compte du client.","Modes de paiement : le paiement peut être effectué en espèces auprès du chauffeur en MUR, EUR ou USD, ou en ligne avant votre excursion."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'seaplane' and t.locale = 'fr';

update activity_translations t set extra = '{"importantInfo":["Merci d’arriver au point d’embarquement au moins 15 minutes avant l’heure de départ prévue.","L’itinéraire vers le point d’embarquement est disponible sur Google Maps.","Merci de ne pas boire d’alcool si vous devez conduire !","Prise en charge et retour disponibles partout sur l’île.","Frais d’annulation de 50 % pour toute annulation dans les 24 heures précédant l’excursion.","Frais d’annulation de 100 % pour toute annulation le jour de l’excursion.","Si l’annulation est faite par Belle Mare Tours Ltd, un remboursement intégral sera effectué par virement bancaire sur le compte du client.","Modes de paiement : le paiement peut être effectué en espèces auprès du chauffeur en MUR, EUR ou USD, ou en ligne avant votre excursion."]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'skydive' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Trou Aux Cerfs (Volcano)","area":"Curepipe","tags":["Visite","Visite touristique","Photos","Visite guidée"],"description":null},{"title":"Floréal","area":"Curepipe","tags":["Visite","Visite guidée","Shopping"],"description":null},{"title":"Grand Bassin – Sacred lake of the Hindu temple","area":"Curepipe","tags":["Visite touristique","Visite","Visite guidée","Photos"],"description":null},{"title":"Black River Gorges","area":"Région Centre","tags":["Visite","Visite guidée","Photos","Panoramique"],"description":null},{"title":"Chamarel 7-color earth + waterfall","area":"Région Sud","tags":["Photos","Visite"],"description":null},{"title":"Viewpoint of Bénitier Island","area":"Région Ouest","tags":["Visite touristique","Visite","Photos","Visite guidée"],"description":null}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'south-tour-mauritius' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Bois Cheri Tea Factory and Musuem","area":"Région Centre","tags":["Visite touristique","Visite","Photos","Visite guidée"],"description":null},{"title":"Saint Aubin","area":"Région Sud","tags":["Visite","Visites guidées","Photos"],"description":null},{"title":"La Vanille Nature Park","area":"Région Sud","tags":["Photos","Plage","Visite","Visite touristique"],"description":null},{"title":"Gris Gris Viewpoint","area":"Région Sud","tags":["Visite","Visites guidées"],"description":null}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'tea-tasting-tour' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Trou d''eau douce","tags":[],"description":"Départ"},{"title":"Ile aux cerfs","tags":[],"description":"Visite touristique"},{"title":"G.R.S.E Waterfall","tags":[],"description":"Visite touristique"},{"title":"ile aux phare","tags":[],"description":"Visite touristique"},{"title":"Ile de passe","tags":[],"description":"Photos"},{"title":"Aigrette island","tags":[],"description":"Baignade,Snorkeling"},{"title":"Ile aux cerf Island","tags":[],"description":"Déjeuner BBQ et boissons sur la plage"}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'the-blue-cruise-ile-aux-cerfs-5-islands-visit' and t.locale = 'fr';

update activity_translations t set extra = '{"itinerary":[{"title":"Black River","tags":[],"description":"Départ"},{"title":"Tamarin","area":"Coin secret","tags":[],"description":"Observation des dauphins"},{"title":"Crystal Rock, Tamarin","tags":[],"description":"Snorkeling"},{"title":"Benitier Island","tags":[],"description":"Déjeuner à bord"}]}'::jsonb
from activities a
where a.id = t.activity_id and a.slug = 'western-cruise-catamaran' and t.locale = 'fr';
