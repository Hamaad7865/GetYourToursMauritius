-- Machine-drafted French for the published catalogue.
--
-- Every row lands as source='machine' so it shows in the admin review worklist rather than passing
-- itself off as owner-approved copy. The upsert's `where activity_translations.source = 'machine'`
-- guard means a re-run refreshes drafts but NEVER overwrites a row the owner has reviewed — without
-- it, the next deploy would silently discard their corrections.
--
-- Translation rules applied throughout:
--   * Vouvoiement (`vous`), never `tu`. Curly apostrophes (’) to match src/lib/i18n/messages.ts.
--   * Proper nouns are NOT translated: Grand Baie, Cap Malheureux, Pamplemousses, Château de
--     Labourdonnais, Caudan Waterfront, Chinatown, Île aux Cerfs, Trou d’Eau Douce, Airbnb.
--     "Port-Louis" IS written with the hyphen — that is the standard French form in Mauritius, and
--     it matches the French title already in the database.
--   * Prices, durations and factual claims are carried across exactly. Nothing is embellished.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- north-tour — Private North Tour Mauritius
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Excursion privée dans le Nord de Maurice',
  'Excursion privée d’une journée dans le Nord de Maurice avec chauffeur-guide : Port-Louis et son marché central, le Jardin botanique de Pamplemousses, Grand Baie et l’église au toit rouge de Cap Malheureux.',
  'Découvrez la beauté, la culture et l’histoire du Nord de Maurice lors de cette excursion privée d’une journée. Voyagez confortablement avec un chauffeur-guide local expérimenté et explorez quelques-uns des sites les plus célèbres de l’île.

Votre parcours commence à Port-Louis, la capitale animée, où vous pourrez visiter le Marché central, le Caudan Waterfront et Chinatown. Poursuivez vers la Citadelle historique pour une vue panoramique à couper le souffle sur la ville et le port.

Vous visiterez ensuite le célèbre Jardin botanique de Pamplemousses, l’un des plus anciens de l’hémisphère Sud, réputé pour ses nénuphars géants et ses plantes exotiques. Continuez vers le Château de Labourdonnais, une demeure coloniale magnifiquement restaurée, entourée de vergers luxuriants.

Mettez ensuite le cap au nord vers le pittoresque village de Cap Malheureux et admirez son emblématique église au toit rouge dominant le lagon turquoise. En chemin, profitez de superbes vues sur la côte, de la culture locale et de nombreuses occasions de photos mémorables.

Cette excursion privée allie souplesse, confort et service personnalisé : l’idéal pour les couples, les familles et les petits groupes qui souhaitent découvrir le meilleur du Nord de Maurice en une journée inoubliable.',
  'Prise en charge à l’hôtel, en Airbnb, en pension ou au port de croisière partout à Maurice',
  array[
    'Explorez Port-Louis et son marché central animé',
    'Grand Baie et l’emblématique église au toit rouge de Cap Malheureux',
    'Un chauffeur-guide privé à votre service toute la journée',
    'Itinéraire entièrement personnalisable — ajoutez les tortues, la plongée ou le Château de Labourdonnais',
    'Jardin botanique de Pamplemousses — nénuphars géants et plantes exotiques (entrée Rs 300 par personne)'
  ]::text[],
  array[
    'Transport privé dans un véhicule climatisé confortable',
    'Chauffeur-guide professionnel',
    'Prise en charge et dépose à l’hôtel, en Airbnb ou au port',
    'Itinéraire flexible et arrêts photo',
    'Carburant et frais de stationnement'
  ]::text[],
  array[
    'Droits d’entrée aux sites et musées',
    'Dépenses personnelles et souvenirs',
    'Activités optionnelles non mentionnées dans l’itinéraire',
    'Repas et boissons non inclus. (Le chauffeur vous recommandera où manger.)'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'north-tour'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- airport-transfer — Airport Transfer
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Transfert aéroport',
  'Transfert privé avec accueil personnalisé entre l’aéroport international SSR et votre lieu d’hébergement, 24 h/24 et 7 j/7.',
  null,
  'Aéroport international SSR (arrivées)',
  array[
    'Accueil personnalisé',
    '24 h/24 et 7 j/7',
    'Porte à porte'
  ]::text[],
  array[
    'Chauffeur',
    'Aide aux bagages'
  ]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'airport-transfer'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- black-river-gorges-hiking — Black River Gorges Hiking
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Randonnée dans les gorges de la Rivière Noire',
  'Randonnée au cœur du parc national des gorges de la Rivière Noire à la découverte de cascades secrètes, d’une faune endémique et de vues panoramiques depuis la crête.',
  'Explorez avec nous le cœur des gorges de la Rivière Noire et laissez-vous surprendre par des trésors cachés qui se révèlent peu à peu à vous.

Les méandres de notre aventure mettent en valeur la splendeur de ce parc national protégé et dévoilent des cascades secrètes parfumées de fleurs de goyavier sauvage, ainsi que les images et les sons d’une faune et d’une flore endémiques nombreuses, telles que la perruche de Maurice et le pigeon rose.

Un incontournable pour tous les passionnés de nature et de faune sauvage. Le sentier comprend une ascension de crête qui longe la vallée, offrant des vues panoramiques sur LaTourelle, l’Île aux Bénitiers et, au loin, Le Morne. Un parcours exigeant et aventureux, mieux adapté aux explorateurs passionnés, compte tenu du dénivelé, du terrain, de l’humidité et de la possibilité de boue dans ces conditions.',
  'Petrin',
  array[
    'Une ascension de crête qui longe la vallée',
    'Des vues panoramiques sur LaTourelle, l’Île aux Bénitiers et Le Morne',
    'Des cascades secrètes parfumées de fleurs de goyavier sauvage',
    'Une faune endémique telle que la perruche de Maurice et le pigeon rose'
  ]::text[],
  array[
    'Guide professionnel',
    'Eau incluse'
  ]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'black-river-gorges-hiking'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- blue-safari-submarine-subscooter — Blue Safari Submarine & Subscooter
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Blue Safari : sous-marin et Subscooter',
  'Descendez dans les profondeurs de l’océan Indien en sous-marin ou en Subscooter pour explorer les récifs, les coraux, la vie marine et l’épave du « Le Star Hope ».',
  'Découvrez peu à peu le monde sous-marin en observant la beauté de l’océan Indien et de sa vie marine. Vous recevrez un briefing avant l’embarquement à bord du sous-marin depuis une plateforme flottante. En descendant dans les profondeurs, vous explorerez les récifs, les coraux, la faune marine locale, l’épave du « Le Star Hope » et une ancienne ancre datant du XVIIe siècle, au fond de l’océan.',
  'Trou aux Biches, route côtière',
  array[
    'Explorez les récifs et les coraux',
    'Observez la faune marine locale',
    'Découvrez l’épave du « Le Star Hope »',
    'Découvrez une ancienne ancre du XVIIe siècle au fond de l’océan'
  ]::text[],
  array[
    'Briefing avant l’embarquement',
    'Prise en charge et dépose partout sur l’île'
  ]::text[],
  array[
    'Ne buvez pas d’alcool si vous devez conduire',
    'Arrivez au point d’embarquement au moins 15 minutes avant l’heure de départ'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'blue-safari-submarine-subscooter'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- casela-world-of-adventures — Casela World of Adventures
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Casela World of Adventures',
  'Excursion d’une journée à Casela World of Adventures, un parc naturel et de loisirs de 14 hectares avec safaris, tyroliennes, promenade avec les lions et activités familiales.',
  'Bienvenue dans l’univers d’aventure de Casela. Rejoignez-nous pour une journée inoubliable remplie d’activités pour toute la famille !

Découvrez un parc de 14 hectares qui a ouvert ses portes en 1979 et qui abrite aujourd’hui 1 500 oiseaux, des lions, des zèbres, des tortues géantes, des singes, un tigre et bien d’autres animaux. Visitez la forêt sèche avec ses arbres centenaires comme l’Ébène noir et laissez vos enfants s’amuser à la ferme pédagogique ou dans nos bassins de pêche.

Profitez de la beauté naturelle de Maurice en Quad, en Buggy, en Segway, ou lancez-vous dans une randonnée d’aventure avec plusieurs tyroliennes, dont la plus longue tyrolienne de l’océan Indien, des ponts suspendus et bien d’autres surprises, ou partez pour une promenade avec de vrais lions.

Pour nos plus jeunes visiteurs, pour ceux qui restent jeunes de cœur, pour ceux qui ont besoin de se déconnecter de l’agitation de la ville, et pour ceux qui veulent pimenter leurs vacances d’un peu d’action, le parc naturel et de loisirs de Casela a quelque chose à offrir à chacun ! Les prix s’entendent par véhicule et non par personne.',
  'Casela',
  array[
    'Un parc de 14 hectares avec 1 500 animaux (oiseaux, lions, zèbres, tortues géantes, singes, tigre)',
    'Une forêt sèche avec des arbres centenaires d’Ébène noir',
    'Une ferme pédagogique',
    'Des bassins de pêche',
    'Des activités Quad, Buggy et Segway',
    'Une randonnée avec tyroliennes (la plus longue de l’océan Indien)',
    'Des ponts suspendus',
    'Une promenade avec de vrais lions'
  ]::text[],
  array[
    'Visite du parc Casela World of Adventures',
    'Accès au parc',
    'Tulawaka',
    'African Safari Truck',
    'Tours Pangia illimités'
  ]::text[],
  array[
    'Billets d’entrée au parc',
    'Portez des chaussures confortables',
    'Apportez une protection solaire'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'casela-world-of-adventures'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- catamaran-cruise-3-northern-island-adventure — Catamaran Cruise 3 Northern Island Adventure
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Croisière en catamaran – Aventure des 3 îles du Nord',
  'Une journée complète au départ de Grand Baie à la découverte de l’Île Plate, avec snorkeling dans le lagon, un déjeuner gastronomique à bord, une pause détente à l’Île aux Gabriel et une vue sur le coucher de soleil au Coin de Mire.',
  'Partez de Grand Baie pour une journée complète à la découverte de l’Île Plate. Profitez d’une séance de snorkeling dans un lagon aux eaux cristallines, peuplé d’une incroyable variété de poissons et de coraux. Un déjeuner gastronomique est préparé à bord du spacieux catamaran, suivi d’un moment de détente à l’Île aux Gabriel. La journée se termine par une vue sur le coucher de soleil sur les falaises spectaculaires du Coin de Mire.',
  'Grand Baie',
  array[
    'Île Plate (région Nord)',
    'Île aux Gabriel (région Nord)',
    'Coin de Mire (région Nord)',
    'Snorkeling (région Nord)'
  ]::text[],
  array[
    'Déjeuner avec salades',
    'Pain au beurre à l’ail',
    'Poulet/poisson/saucisse grillés',
    'Eau, Coca, bière, vin, rhum local',
    'Banane flambée',
    'Salades de fruits',
    'Snorkeling'
  ]::text[],
  array[
    'Ne buvez pas d’alcool si vous devez conduire',
    'Arrivez 15 minutes avant le départ',
    'Les personnes venant par leurs propres moyens doivent se référer à Google Maps pour l’itinéraire'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'catamaran-cruise-3-northern-island-adventure'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- catamaran-cruise-ile-aux-cerfs — Catamaran Cruise – Ile Aux Cerfs
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Croisière en catamaran – Île aux Cerfs',
  'Une croisière en catamaran d’une journée complète au départ de Trou d’Eau Douce, avec visite de la cascade de la Grande Rivière Sud-Est (GRSE), snorkeling, déjeuner BBQ à bord et Île aux Cerfs.',
  'Profitez d’une croisière en catamaran d’une journée complète au départ de Trou d’Eau Douce, sur la côte Est de Maurice.

L’expérience comprend la visite de la spectaculaire cascade de la Grande Rivière Sud-Est (GRSE), une séance de snorkeling dans des eaux cristallines, et un déjeuner BBQ avec boissons à bord.

Les invités se rendent ensuite à l’Île aux Cerfs pour admirer les cocotiers et les plages blanches bordées d’eaux turquoise, avec du temps pour se détendre sur le sable et se baigner dans le lagon.',
  'Trou d’Eau Douce',
  array[
    'Île aux Cerfs (région Est)',
    'Cascade GRSE (région Est)',
    'Snorkeling (région Est)',
    'Déjeuner BBQ à bord'
  ]::text[],
  array[
    'Salades et pain au beurre à l’ail',
    'BBQ : poulet, poisson, saucisse',
    'Boissons : eau, Coca, bière, vin, rhum local',
    'Dessert : banane flambée',
    'Snorkeling'
  ]::text[],
  array[
    'Les personnes venant par leurs propres moyens ne doivent pas boire d’alcool si elles conduisent',
    'Arrivez au point d’embarquement au moins 15 minutes avant l’heure de départ'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'catamaran-cruise-ile-aux-cerfs'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- catamaran-sunset-cruise — Catamaran Sunset Cruise
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Croisière catamaran au coucher du soleil',
  'Naviguez paisiblement au fil d’un magnifique coucher de soleil au-dessus de Grand Baie à bord d’un superbe catamaran, tout en savourant un cocktail rafraîchissant.',
  'Naviguez paisiblement au fil d’un magnifique coucher de soleil au-dessus de Grand Baie à bord d’un superbe catamaran, tout en savourant un cocktail rafraîchissant. Les couchers de soleil sur la côte nord-ouest de Maurice sont légendaires, et la meilleure façon de les admirer est depuis l’océan.

La croisière permet aux visiteurs de profiter de la splendeur de la ville historique de Grand Baie et de naviguer vers le Coin de Mire et ses spectaculaires falaises maritimes, offrant des vues à couper le souffle sur les autres îles du Nord et la chaîne de montagnes centrale de Maurice.

Le catamaran dispose de vastes espaces extérieurs sur le pont, à l’avant et à l’arrière, spécialement conçus pour admirer le coucher de soleil, prendre des photos et se retrouver entre convives. Il comprend un bar, un système audio haut de gamme et une sélection musicale raffinée.',
  'Grand Baie',
  array[
    'Grand Baie (région Nord)',
    'Gunner’s Coin / Coin de Mire (région Nord) — des falaises spectaculaires dans une explosion de couleurs',
    'Vue sur le coucher de soleil au-dessus de la côte nord-ouest',
    'Navigation le long du Fort Malartic et de Cap Malheureux'
  ]::text[],
  array[
    'Croisière cocktail : canapés (thon, crevettes, poisson fumé)',
    'Cacahuètes, chips',
    'Cocktails au vin (blanc, rosé)',
    'Bière, rhum',
    'Boissons sans alcool',
    'Eau minérale',
    'Croisière dînatoire : sélection de canapés et d’en-cas',
    'Siège bébé disponible gratuitement sur demande'
  ]::text[],
  array[
    'Transport aller-retour vers le point d’embarquement (disponible séparément)',
    'Merci de ne pas boire d’alcool si vous devez conduire !',
    'Arrivez au point d’embarquement au moins 15 minutes avant l’heure de départ'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'catamaran-sunset-cruise'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- catapseed-5-islands — Private Cataspeed 5 Islands
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Cataspeed privé – 5 îles',
  'Découvrez la magnifique côte Est de Maurice avec la visite de la cascade de la Grande Rivière Sud-Est (GRSE), de cinq îles superbes et une incroyable séance de snorkeling dans des lagons aux eaux cristallines. Profitez de paysages à couper le souffle, observez une vie marine éclatante de couleurs et détendez-vous lors d’une inoubliable croisière en CataSpeed.',
  'Votre croisière d’une journée complète débute à l’embarcadère public de Trou d’Eau Douce, où vous rencontrerez l’équipage avant de partir à la découverte de la magnifique côte Est de Maurice.

L’aventure commence par la visite de la célèbre cascade de la Grande Rivière Sud-Est (GRSE), suivie d’une croisière panoramique le long de forêts luxuriantes, où vous pourrez peut-être apercevoir des singes, des chauves-souris et l’emblématique paille-en-queue à brins blancs.

Poursuivez l’exploration des magnifiques îlots au large, notamment Flamingo Island, l’historique Lighthouse Island (Île aux Fouquets) et l’Île de la Passe. Profitez d’un moment de snorkeling dans les eaux cristallines près de l’Île aux Aigrettes et de la célèbre Eau Bleue, riche d’une vie marine tropicale éclatante de couleurs.

Vers midi, détendez-vous à bord en savourant un délicieux déjeuner BBQ composé de salades fraîches, de poulet, de poisson et de saucisses grillés, ainsi que d’un dessert, pendant que le bateau est ancré dans des eaux calmes.

Après le déjeuner, profitez de temps libre sur la célèbre Île aux Cerfs, où vous pourrez nager, vous détendre sur les plages de sable blanc, ou simplement profiter de ce paradis tropical, avant de reprendre la mer vers Trou d’Eau Douce dans l’après-midi, avec des souvenirs inoubliables de votre journée en mer.',
  'Route Royale Maho, Trou d’Eau Douce',
  array[
    'Cascade de la Grande Rivière Sud-Est (GRSE)',
    'Snorkeling parmi les jardins de corail et les poissons tropicaux à Eau Bleue',
    'Île aux Aigrettes (région Sud-Est)',
    'Île aux Prison (région Sud-Est)',
    'Île Phare / Île au Phare (région Sud-Est)',
    'Plages du nord de l’Île aux Cerfs et lagon turquoise',
    'Déjeuner BBQ à bord'
  ]::text[],
  array[
    'Déjeuner',
    'Boissons',
    'Visite de l’Île aux Cerfs',
    'Visite de la cascade GRSE',
    'Visite de Lighthouse Island (Île aux Fouquets)',
    'Matériel de snorkeling disponible',
    'Équipage professionnel',
    'Repas végétariens/sans gluten disponibles sur demande'
  ]::text[],
  array[
    'Prise en charge et dépose moyennant un supplément',
    'Activités nautiques non incluses (par exemple : parachute ascensionnel, etc.)'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'catapseed-5-islands'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- custom-road-trip — Custom Road Trip
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Road trip sur mesure',
  'Concevez votre propre journée à travers Maurice avec le planificateur IA — un prix fixe unique par véhicule.',
  null,
  null,
  array[]::text[],
  array[]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'custom-road-trip'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- deep-sea-fishing — Deep Sea fishing
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Pêche au gros',
  'Pêchez le marlin bleu, la dorade coryphène et d’autres gros poissons sous la conduite de skippers expérimentés, à bord de bateaux modernes bien équipés.',
  'Que vous soyez débutant ou expert, vous prendrez plaisir à pêcher le marlin bleu, la dorade coryphène ou d’autres gros poissons sous la conduite de skippers expérimentés. Les bateaux modernes conçus pour la pêche au gros sont bien équipés.

La durée de location minimale est de 6 heures, et un bateau peut être partagé par trois pêcheurs maximum. Les bateaux opèrent depuis les côtes nord, ouest et est. Vous longerez le récif et observerez les coraux de près, à la découverte d’une vie marine locale riche.',
  'Rivière Noire',
  array[
    'Pêchez le marlin bleu, la dorade coryphène et d’autres gros poissons',
    'Longez le récif et observez les coraux de près',
    'Explorez la vie marine locale'
  ]::text[],
  array[
    'Encadrement par un skipper expérimenté',
    'Bateaux modernes et bien équipés',
    'Accès à trois points de départ (côtes nord, ouest et est)',
    'Boissons incluses (bière, boissons gazeuses et eau)'
  ]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'deep-sea-fishing'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- encountering-the-whales-and-swim-with-dolphins-excursion — Encountering the Whales and swim with Dolphins excursion
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Excursion à la rencontre des baleines et baignade avec les dauphins',
  'Une excursion en bateau sur la côte Ouest pour admirer les baleines à bosse ou les cachalots et nager avec les dauphins, sous la supervision de skippers et d’équipages professionnels.',
  'Une expérience unique qui vous laissera des souvenirs pour toute une vie ! Plongez dans l’aventure d’une vie, qui vous mettra en contact avec des paysages d’une beauté saisissante, préservés, et de merveilleux animaux marins.

Sur la côte Ouest de Maurice, nous proposons un large choix d’excursions, en formule partagée ou privée. Toutes les activités se déroulent sous les instructions et la supervision de skippers et membres d’équipage professionnels, dans le respect et la protection de la vie aquatique et de l’environnement naturel. La première partie de cette excursion vous donnera l’occasion d’admirer l’un des plus grands animaux marins. Qu’il s’agisse des baleines à bosse ou des cachalots, ces cétacés restent sauvages et imprévisibles, si bien que la rencontre n’est pas garantie à 100 %, tout comme pour les dauphins — mais nos équipages dévoués font, la plupart du temps, tout leur possible pour offrir à nos hôtes un souvenir inoubliable, pour toute une vie.

Après ce moment de pur bonheur, place à la recherche des dauphins, joyeux, joueurs, intelligents et charmants. Un briefing sur les règles à respecter concernant l’approche, ainsi que sur toutes les mesures de sécurité, sera donné par le capitaine du bateau ou les membres d’équipage avant d’entrer dans l’eau.

Vous vivrez ensuite un moment magique de snorkeling avec l’une des créatures les plus fantastiques, sous la supervision d’un instructeur. Sur le chemin du retour, selon le temps restant, l’excursion en bateau pourra se poursuivre à l’Aquarium, un site de snorkeling magique où découvrir et apprécier la vie aquatique mauricienne. Le bateau reprendra ensuite la direction du rivage, où votre aventure s’achèvera dans la joie, avec le souvenir de votre toute dernière rencontre.',
  'Tamarin',
  array[
    'Admirez les baleines à bosse ou les cachalots',
    'Retour au rivage',
    'Nagez avec les dauphins à long bec et les grands dauphins dans leur environnement naturel'
  ]::text[],
  array[
    'Supervision par un skipper et un équipage professionnels',
    'Rafraîchissements offerts (eau et boissons gazeuses)'
  ]::text[],
  array[
    'Les enfants de moins de 12 ans doivent être accompagnés d’un adulte'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'encountering-the-whales-and-swim-with-dolphins-excursion'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only — Full Day 3 Northern Island Speed Boat with Lunch(BBQ)
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Journée complète en speedboat aux 3 îles du Nord avec déjeuner (BBQ)',
  'Une excursion privée d’une journée en speedboat au départ de Grand Baie vers l’Île Plate, l’Île aux Gabriel et le Coin de Mire, avec snorkeling, déjeuner BBQ et boissons.',
  'Une excursion privée d’une journée en speedboat pour visiter trois îles du Nord de Maurice. Le départ se fait de Grand Baie, avec un trajet d’environ 45 minutes jusqu’à l’Île Plate, pour un moment de détente et de snorkeling dans les lagons.

Une faune et une flore tropicales vous attendent, aussi bien dans l’eau que sur l’île. Après un déjeuner BBQ, le bateau poursuit sa route vers l’Île aux Gabriel pour une exploration. Une dernière séance de snorkeling a lieu près du Coin de Mire, l’un des plus beaux spots de plongée au nord de Maurice.',
  'Grand Baie',
  array[
    'Île Plate : détente, snorkeling et déjeuner BBQ',
    'Île aux Gabriel : exploration de l’île',
    'Coin de Mire : snorkeling sur l’un des plus beaux spots de plongée au nord de Maurice'
  ]::text[],
  array[
    'Salades et pain au beurre à l’ail',
    'BBQ : poulet, poisson, saucisse',
    'Boissons : eau, Coca, bière, vin, rhum local',
    'Dessert : banane flambée',
    'Séances de snorkeling',
    'Prise en charge et dépose disponibles partout sur l’île'
  ]::text[],
  array[
    'Ne buvez pas d’alcool si vous devez conduire',
    'Arrivez au moins 15 minutes avant l’heure de départ'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- helicotour — Helicopter Tour of Mauritius
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Tour en hélicoptère de Maurice',
  'Découvrez Maurice vue du ciel lors d’un vol privé en hélicoptère au départ de la base de Triolet, dans le Nord, avec trois formules allant d’un court survol panoramique à un tour complet de l’île.',
  'The Must (départ de Triolet, Nord) : Un vol court et des souvenirs gravés à jamais dans votre mémoire. L’itinéraire au départ de la base de Triolet comprend un survol des paysages et des îlots du Nord. Profitez de l’effervescence de Grand Baie vue du ciel et des bateaux alignés près de la plage de sable doré. Survolez ensuite le Coin de Mire, qui domine la côte Nord, et l’Île Plate, refuge de diverses espèces de reptiles. Le vol se termine par un magnifique passage au-dessus de l’Île d’Ambre, où le célèbre Saint-Géran a fait naufrage et qui servit de cadre à Paul et Virginie de Bernardin de Saint-Pierre.

LE MAGIQUE (départ de Triolet, Nord) : Découvrez de magnifiques panoramas de Maurice en survolant l’île pendant 40 minutes avec notre expérience exclusive Le Magique. L’aventure commence par un décollage majestueux depuis notre base de Triolet, où notre équipe dévouée vous réserve l’accueil le plus chaleureux. Profitez d’un moment de détente dans notre élégant salon, suivi d’un briefing de vol complet pour une expérience inoubliable. Embarquez ensuite pour une excursion aérienne fascinante qui révélera les trésors cachés de Maurice. Admirez la vue à couper le souffle sur Port-Louis, survolez les silos emblématiques du Moulin de la Concorde, observez les navires qui animent la capitale, émerveillez-vous devant les vastes espaces verts et le lagon aux eaux cristallines, découvrez l’Île aux Bénitiers et contemplez le majestueux phare d’Albion qui domine fièrement les environs. Une expérience inoubliable vous attend, prête à transformer votre vision de Maurice à jamais. Si vous vous demandez quelle est cette montagne majestueuse où vivent les paille-en-queue, il s’agit du Morne Brabant ! Ne manquez pas la cascade sous-marine et admirez les couleurs magnifiques de Chamarel. Détendez-vous sur les plages de sable blanc de l’Île aux Cerfs et profitez du soleil tropical en sirotant un cocktail rafraîchissant. Explorez les gorges de la Rivière Noire pour découvrir la beauté d’une nature brute, puis admirez les cascades de Tamarin cachées dans une forêt endémique. Plongez dans les eaux cristallines du Blue Bay Marine Park pour une expérience de plongée inoubliable parmi les coraux et les poissons multicolores. Approchez-vous du Pieter Both, une montagne liée à une célèbre légende, avant de terminer votre voyage par un survol à couper le souffle avec Corail Hélicoptères ! N’oubliez pas de goûter aux délices de la cuisine mauricienne locale, comme le carry de poulet et les samoussas épicés, pour une expérience culinaire authentique.

THE EXCELLENCE (départ de Triolet, Nord) : Vous survolerez le Pieter Both et Le Pouce pour démarrer votre aventure en beauté. Admirez ensuite le magnifique panorama de la cascade de Tamarin, au cœur d’une forêt verdoyante et de rochers sculptés par Mère Nature. Vous aurez également l’impression de voler avec les paille-en-queue en approchant des gorges de la Rivière Noire. Après un détour par l’Île aux Bénitiers, immortalisez la cascade sous-marine près du Morne Brabant, classé au patrimoine mondial de l’UNESCO. Vous vous demanderez peut-être si l’arc-en-ciel est tombé du ciel en survolant Chamarel. La magie est toujours présente ici ! Avez-vous déjà vu un îlot au milieu d’un lac ? Vivez cette expérience unique à Ganga Talao. N’oubliez pas de jeter un œil au cratère du volcan endormi de Kanaka, à Maurice. En approchant de l’île, survolez l’Île aux Cerfs à l’Est, puis remontez vers le Nord en passant au-dessus de l’Île d’Ambre et de l’Île Plate, réputée pour ses caméléons aux motifs artistiques ! Près de Cap Malheureux se trouve Le Coin de Mire, visible depuis notre base si les nuages le permettent ! Voici Maurice dans toute sa splendeur !',
  null,
  array[
    'The Must : survol des paysages et îlots du Nord, Grand Baie, Coin de Mire, Île Plate, Île d’Ambre (site du naufrage du Saint-Géran)',
    'Le Magique : Port-Louis, Moulin de la Concorde, Île aux Bénitiers, Morne Brabant, la cascade sous-marine, Chamarel, Île aux Cerfs, Rivière Noire, les cascades de Tamarin, Blue Bay Marine Park, Pieter Both',
    'The Excellence : Pieter Both, Le Pouce, cascade de Tamarin, gorges de la Rivière Noire, Île aux Bénitiers, la cascade sous-marine, Morne Brabant, Chamarel, Ganga Talao, le cratère du volcan Kanaka, Île aux Cerfs, Île d’Ambre, Île Plate, Cap Malheureux, Coin de Mire'
  ]::text[],
  array[
    'Vol panoramique aérien (itinéraire selon la formule choisie)',
    'Briefing de vol complet (Le Magique)',
    'Accès au salon élégant (Le Magique)'
  ]::text[],
  array[
    'Le transport est optionnel (ne buvez pas d’alcool si vous devez conduire)'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'helicotour'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- hiking-at-the-tamarind-falls-7-cascade — Hiking At The Tamarind Falls / 7 Cascade
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Randonnée aux Tamarind Falls / 7 Cascades',
  'Randonnée guidée jusqu’aux Tamarind Falls (7 Cascades), la plus haute chute d’eau de Maurice, à travers des plateaux riches en plantes et en oiseaux exotiques.',
  'Les 7 Cascades, également connues sous le nom de Tamarind Falls, se situent près du petit village de Henrietta, sur les hauts plateaux de Maurice, et prennent leur source dans la Rivière Tamarin. Les 7 Cascades mesurent 293 mètres (961 pieds), ce qui en fait la plus haute chute d’eau de Maurice.

Vous y trouverez une grande variété de plantes et d’oiseaux exotiques, dans ce lieu paisible et enchanteur. Il est recommandé de se faire accompagner d’un guide, qui vous assistera pendant la randonnée, les sentiers précis n’étant pas nombreux.',
  'Henrietta',
  array[
    'Tamarind Falls (7 Cascades), la plus haute chute d’eau de Maurice à 293 mètres / 961 pieds',
    'Une grande variété de plantes et d’oiseaux exotiques',
    'Un lieu paisible et enchanteur sur les hauts plateaux',
    'Baignade facultative'
  ]::text[],
  array[
    'Guide professionnel',
    'Eau incluse'
  ]::text[],
  array[
    'Apportez de l’eau',
    'Chaussures de randonnée confortables',
    'Crème solaire et répulsif anti-moustiques',
    'Si vous souhaitez vous baigner, pensez également à apporter maillots de bain et serviettes'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'hiking-at-the-tamarind-falls-7-cascade'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- hiking-le-morne — Hiking Le Morne
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Randonnée au Morne Brabant',
  'Gravissez le Morne Brabant, site classé au patrimoine mondial de l’UNESCO, jusqu’à son sommet en « V » pour des vues spectaculaires sur des lagons turquoise et des chaînes de montagnes verdoyantes.',
  'Découvrez la beauté et la majesté du Morne Brabant en gravissant la montagne depuis sa base jusqu’au sommet en « V », tout en admirant un paysage spectaculaire.

Touchez presque les nuages et émerveillez-vous devant la splendeur des lagons turquoise et des chaînes de montagnes verdoyantes qui s’étendent devant vous, à perte de vue jusqu’à l’horizon.

Découvrez l’histoire tumultueuse, le folklore et les légendes qui entourent la montagne, et savourez le triomphe d’atteindre le sommet après avoir bravement affronté des terrains d’escalade grisants.

Classée au patrimoine mondial de l’UNESCO en 2006, la montagne est un sanctuaire protégé abritant une multitude d’espèces rares de plantes et d’animaux qui continuent d’y prospérer.',
  'Le Morne Brabant',
  array[
    'Ascension depuis la base jusqu’au sommet en « V »',
    'Vues spectaculaires sur des lagons turquoise et des chaînes de montagnes verdoyantes',
    'Découvrez l’histoire, le folklore et les légendes de la montagne',
    'Site classé au patrimoine mondial de l’UNESCO, sanctuaire d’espèces rares de plantes et d’animaux',
    'Distance : 5,6 km ; dénivelé : 465 m'
  ]::text[],
  array[
    'Randonnée guidée sur la Route des Esclaves du Morne',
    'Eau incluse',
    'Guides de montagne locaux (agréés par la Mauritius Tourism Authority)'
  ]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'hiking-le-morne'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- horse-back-riding-on-the-beach — Horse Back Riding on the Beach
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Balade à cheval sur la plage',
  'Découvrez le parfait équilibre entre aventure et détente lors d’une balade à cheval guidée le long des magnifiques plages de Maurice. À Belle Mare Beach, nos balades vous permettent d’admirer le littoral à couper le souffle de l’île tout en vivant une expérience inoubliable au cœur de la nature.',
  'Que vous soyez un cavalier expérimenté ou que vous essayiez l’équitation pour la première fois, Belle Mare Tours propose des balades à cheval guidées, conçues pour être sûres, relaxantes et mémorables.

Accompagné(e) de guides expérimentés, vous profiterez de paysages côtiers à couper le souffle, de brises marines rafraîchissantes et du charme paisible des plages immaculées de Maurice. Idéale pour les couples, les familles et les voyageurs solo, cette expérience équestre unique offre une manière inoubliable de découvrir la beauté naturelle de l’île.

Veuillez noter que cette balade se fait au pas, le long de la plage uniquement. Pour un autre type de balade, incluant le trot, le galop et la baignade avec les chevaux, veuillez nous contacter directement. Séance photo en option disponible ; contactez-nous pour organiser une expérience sur mesure.',
  'Plage de Belle Mare',
  array[
    'Des chevaux bien dressés et en bonne condition physique',
    'Une équipe chaleureuse à votre service',
    'Poids maximum du cavalier : 200 lbs.'
  ]::text[],
  array[
    'Location de casque',
    'Balade à cheval d’une heure sur la plage de Belle Mare',
    'Guide expérimenté pour vous accompagner'
  ]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'horse-back-riding-on-the-beach'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- la-vallee-des-couleurs-nature-park-2 — Vallée Adventure Park
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Vallée Adventure Park',
  'Excursion d’une journée au parc naturel de La Vallée des Couleurs, avec sa terre aux 23 couleurs, ses quatre cascades, sa faune et sa flore indigènes, dans le sud de Maurice.',
  'Ce site séduira les amoureux de la nature, offrant une expérience unique au cœur d’une faune et d’une flore indigènes. Le parc présente des paysages variés : plateaux, montagnes, vallées, cratères et lacs de cratère.

Une salle d’exposition et un jardin de fougères mettent en valeur des fleurs indigènes telles que la Trochetia et le Banané Bouquet. La faune comprend des tortues, des singes, des cerfs, des poissons et des oiseaux comme le pigeon rose et le paille-en-queue.

Des arbres endémiques (ébène, bois de rotin, takamaka) embellissent le paysage. Quatre cascades — Vacoas, Rattan Wood, Angel Hair et Chamouzé — offrent des lieux de détente. L’attraction principale est la terre aux 23 couleurs distinctes, issue de l’éruption du volcan du Bassin Blanc il y a des millions d’années.',
  'Chamouny',
  array[
    'Formation de terre aux 23 couleurs',
    'Quatre cascades (Vacoas, Rattan Wood, Angel Hair, Chamouzé)',
    'Salle d’exposition',
    'Jardin de fougères avec des fleurs indigènes',
    'Observation de la faune (tortues, singes, cerfs, oiseaux)',
    'Espèces d’arbres endémiques (ébène, bois de rotin, takamaka)',
    'Vues panoramiques sur la côte Sud'
  ]::text[],
  array[
    'Droit d’entrée',
    'Visite du parc'
  ]::text[],
  array[
    'Déjeuner',
    'Services de guide'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'la-vallee-des-couleurs-nature-park-2'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- north-beaches-tour — Beach Hopping Tour (North Beaches)
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Circuit des plages du Nord',
  'Une excursion privée exclusive d’une journée à la découverte de cinq plages du Nord de Maurice, avec chaises longues, parasol, natte, collations et boissons offerts, et un chauffeur parlant anglais et français.',
  'Une excursion privée exclusive à la découverte de cinq plages du Nord de Maurice en une seule journée. Un chauffeur dédié vous emmène à Trou aux Biches, Mont Choisy, La Cuvette, Grand Baie et Pereybère. L’expérience comprend chaises longues, parasols, nattes, collations et boissons rafraîchissantes offerts. Chaque plage a ses particularités : Mont Choisy séduit par ses eaux cristallines et sa vie marine ; Pereybère offre une ambiance animée avec ses cafés locaux ; Grand Baie propose sports nautiques et shopping ; Trou aux Biches offre un cadre paisible, idéal en famille ; La Cuvette est une échappée isolée et tranquille. Le chauffeur vous aide à installer votre coin plage et vous accompagne en anglais et en français tout au long de la journée.',
  null,
  array[
    'Plage de Trou aux Biches',
    'Plage de Mont Choisy',
    'Plage de La Cuvette',
    'Plage de Grand Baie',
    'Plage de Pereybère'
  ]::text[],
  array[
    'Prise en charge et dépose depuis n’importe quel hôtel ou Airbnb à Maurice',
    'Véhicule privé et transport entre les plages',
    'Chauffeur parlant anglais et français',
    'Arrêt au supermarché en chemin',
    'Un parasol, deux chaises longues, une natte de plage (minimum)',
    'Collations et boissons fraîches',
    'Premier siège enfant (sur demande)'
  ]::text[],
  array[
    'Déjeuner non inclus (le chauffeur peut recommander des restaurants)',
    'Billets d’entrée aux sites visités',
    'Chaises longues/parasols supplémentaires au-delà des quantités indiquées'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'north-beaches-tour'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- port-louis-city-tour — Port Louis City Tour
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Visite de la ville de Port-Louis',
  'Une visite privée et personnalisée de la capitale Port-Louis, avec points de vue, temples hindous, le Caudan Waterfront, Chinatown et son bazar, la Citadelle et l’Odysseo Oceanarium, accompagnée d’un chauffeur parlant anglais et français.',
  'Embarquez pour un voyage captivant au cœur de Maurice avec cette visite de la ville de Port-Louis, une exploration complète de la riche mosaïque d’histoire, de culture et de charme contemporain de la capitale. La visite débute au point de vue Marie Reine de la Paix, un havre serein offrant une vue dégagée sur Port-Louis, avec la chaîne de montagnes de Moka en toile de fond. Les visiteurs s’immergent ensuite dans la grandeur spirituelle et architecturale de temples hindous vibrants, ornés de sculptures raffinées et de couleurs éclatantes. Le Caudan Waterfront incarne le visage moderne de Maurice — une promenade animée mêlant shopping, restauration et divertissement, avec de superbes vues sur le port. La visite se poursuit dans les ruelles et les échoppes traditionnelles de Chinatown, le bazar historique avec ses couleurs et ses odeurs, ainsi que des musées offrant une compréhension culturelle plus approfondie. La Citadelle, perchée sur une colline, offre des vues panoramiques sur la ville et le port. La visite se termine à l’Odysseo Oceanarium, un établissement moderne présentant une vie marine et des écosystèmes aquatiques variés. Tout au long de cette expérience privée et personnalisée, accompagnée d’un chauffeur parlant anglais et français, les visiteurs acquièrent une compréhension profonde du passé et du présent de l’île.',
  null,
  array[]::text[],
  array[
    'Prise en charge et dépose depuis n’importe quel hôtel ou Airbnb à Maurice',
    'Transport privé vers tous les sites',
    'Chauffeur parlant anglais et français pour vous guider et vous informer',
    'Premier siège enfant (gratuit, sur demande)'
  ]::text[],
  array[
    'Frais d’entrée sur les sites (Blue Penny Museum, etc.)',
    'Déjeuner non inclus (les clients choisissent leur restaurant ; le chauffeur propose des recommandations)'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'port-louis-city-tour'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-full-day-3-northern-island-speed-boat-with-lunch-bbq — Private Full Day 3 Northern Island Speed Boat with Lunch(BBQ)
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Journée privée en speedboat aux 3 îles du Nord avec déjeuner (BBQ)',
  'Profitez d’une excursion exclusive et privée en speedboat au départ de Grand Baie vers l’Île Plate, l’Île aux Gabriel et le Coin de Mire. Naviguez à votre propre rythme, découvrez des lagons aux eaux cristallines, faites du snorkeling dans une mer foisonnante de vie marine et détendez-vous sur des plages immaculées. Votre expérience comprend un délicieux déjeuner BBQ servi sur l’île, ainsi qu’une sélection de boissons rafraîchissantes tout au long de la journée. Idéal pour les couples, les familles ou les petits groupes en quête d’une aventure insulaire personnalisée.',
  'Profitez d’une excursion exclusive et privée en speedboat à la découverte de trois îles du Nord de Maurice. Au départ de Grand Baie, vous naviguerez pendant environ 45 minutes jusqu’à l’Île Plate, où vous pourrez vous détendre sur la plage, nager dans des eaux cristallines ou faire du snorkeling dans de magnifiques lagons.

Explorez la flore et la faune tropicales uniques de l’île, aussi bien sur terre que sous la surface. Après un délicieux déjeuner BBQ servi sur l’île, poursuivez votre aventure privée jusqu’à l’Île aux Gabriel, où vous pourrez profiter de ses plages immaculées et de sa beauté naturelle à votre propre rythme. La journée se termine par une dernière séance de snorkeling près du Coin de Mire, réputé comme l’un des plus beaux sites de snorkeling et de plongée au large de la côte Nord de Maurice.',
  'Cap Malheureux',
  array[
    'Île Plate : détente, snorkeling et déjeuner BBQ',
    'Île aux Gabriel : exploration de l’île',
    'Coin de Mire : snorkeling sur l’un des plus beaux sites de plongée au large du Nord de Maurice'
  ]::text[],
  array[
    'Salades et pain au beurre à l’ail',
    'BBQ : poulet, poisson, saucisse',
    'Boissons : eau, Coca, bière, vin, rhum local',
    'Dessert : banane flambée',
    'Séances de snorkeling',
    'Prise en charge et dépose disponibles partout sur l’île'
  ]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-full-day-3-northern-island-speed-boat-with-lunch-bbq'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-full-day-3-northern-islands-adventure — Private Full Day 3 Northern Islands Adventure
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Aventure privée d’une journée complète aux 3 îles du Nord',
  'Profitez d’une croisière privée d’une journée complète en catamaran au départ de Grand Baie vers l’Île Plate, avec snorkeling dans le lagon, un déjeuner gastronomique servi à bord, un moment de détente à l’Île aux Gabriel et des vues à couper le souffle sur le Coin de Mire.',
  'Partez de Grand Baie à bord de votre catamaran privé pour une croisière d’une journée complète vers l’Île Plate. Faites du snorkeling dans le lagon aux eaux cristallines, abritant de superbes récifs coralliens et une grande variété de poissons tropicaux. Savourez un délicieux déjeuner gastronomique servi à bord en naviguant à travers les eaux turquoise éblouissantes. Détendez-vous sur la plage immaculée de l’Île aux Gabriel ou profitez du spacieux catamaran à votre propre rythme. Terminez votre journée inoubliable par une vue à couper le souffle sur les falaises spectaculaires du Coin de Mire, avant de rentrer à Grand Baie.',
  'Grand Baie',
  array[
    'Île Plate (région Nord)',
    'Île aux Gabriel (région Nord)',
    'Coin de Mire (région Nord)',
    'Snorkeling (région Nord)'
  ]::text[],
  array[
    'Déjeuner avec salades',
    'Pain au beurre à l’ail',
    'Poulet/poisson/saucisse grillés',
    'Eau, Coca, bière, vin, rhum local',
    'Banane flambée',
    'Salades de fruits',
    'Snorkeling'
  ]::text[],
  array[
    'Ne buvez pas d’alcool si vous devez conduire',
    'Arrivez 15 minutes avant le départ',
    'Les personnes venant par leurs propres moyens doivent se référer à Google Maps pour l’itinéraire'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-full-day-3-northern-islands-adventure'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-full-day-5-islands-tour-ile-aux-cerfs-with-lunch — Private Full Day 5 Islands tour Ile Aux Cerfs with Lunch
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Tour privé d’une journée complète aux 5 îles – Île aux Cerfs avec déjeuner',
  'Profitez d’une excursion privée en speedboat, d’une journée complète, au départ de Trou d’Eau Douce : visite de la cascade GRSE, snorkeling parmi de superbes jardins de corail, découverte des cinq îles, déjeuner BBQ savoureux et détente sur les magnifiques plages du nord de l’Île aux Cerfs.',
  'Embarquez pour une excursion privée en speedboat au départ de Trou d’Eau Douce, pour une journée complète d’aventure et de détente.

Votre périple débute par la visite de la majestueuse cascade de la Grande Rivière Sud-Est, l’une des attractions naturelles les plus spectaculaires de Maurice. Poursuivez avec une halte snorkeling parmi de superbes jardins de corail, où vous pourrez nager aux côtés de poissons tropicaux colorés dans des eaux cristallines.

Naviguez ensuite vers les pittoresques îlots au large, notamment l’Île aux Aigrettes, l’Île aux Prison et l’Île au Phare, chacune offrant des paysages uniques, une histoire fascinante et une nature préservée.

Savourez un délicieux déjeuner BBQ dans un cadre paisible sur la partie sud de l’Île aux Cerfs, avant de passer l’après-midi à vous détendre sur les magnifiques plages du nord de l’île. Nagez dans le lagon turquoise, profitez de l’atmosphère tropicale ou détendez-vous simplement à votre rythme, avant de rentrer à Trou d’Eau Douce.',
  'Route Royale Maho, Trou d’Eau Douce',
  array[
    'Cascade de la Grande Rivière Sud-Est (GRSE)',
    'Snorkeling parmi les jardins de corail et les poissons tropicaux à Eau Bleue',
    'Île aux Aigrettes (région Sud-Est)',
    'Île aux Prison (région Sud-Est)',
    'Île Phare / Île au Phare (région Sud-Est)',
    'Déjeuner BBQ sur la partie sud de l’Île aux Cerfs',
    'Plages du nord de l’Île aux Cerfs et lagon turquoise'
  ]::text[],
  array[
    'Déjeuner et boissons',
    'Déjeuner BBQ avec salades, pain au beurre à l’ail, poulet, poisson, saucisse',
    'Boissons : eau, Coca, bière, vin, rhum local',
    'Dessert banane flambée',
    'Séance de snorkeling',
    'Visite des cinq îles',
    'Prise en charge (en option)'
  ]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-full-day-5-islands-tour-ile-aux-cerfs-with-lunch'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-full-day-catamaran-ile-aux-cerfs — Private Full Day Catamaran Ile Aux Cerfs
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Catamaran privé d’une journée complète – Île aux Cerfs',
  'Embarquez pour une croisière privée en catamaran d’une journée complète au départ de Trou d’Eau Douce, pour une journée inoubliable avec la visite de la cascade de la Grande Rivière Sud-Est, du snorkeling dans des lagons turquoise, un déjeuner BBQ gastronomique à bord et une halte détente à l’idyllique Île aux Cerfs.',
  'Profitez d’une croisière privée exclusive en catamaran d’une journée complète, au départ de Trou d’Eau Douce, sur la côte Est de Maurice. Naviguez jusqu’à la spectaculaire cascade de la Grande Rivière Sud-Est, faites du snorkeling dans des eaux cristallines et savourez un délicieux déjeuner BBQ avec boissons servi à bord. Poursuivez vers l’idyllique Île aux Cerfs, où vous pourrez vous détendre sur des plages de sable blanc immaculées, nager dans le lagon turquoise et profiter à votre rythme de la beauté de ce paradis tropical.',
  'Route Royale Maho, Trou d’Eau Douce',
  array[
    'Île aux Cerfs (région Est)',
    'Cascade GRSE (région Est)',
    'Snorkeling (Eau Bleue)',
    'Déjeuner BBQ et boissons à bord'
  ]::text[],
  array[
    'Salades et pain au beurre à l’ail',
    'BBQ : poulet, poisson, saucisse',
    'Boissons : eau, Coca, bière, vin, rhum local',
    'Dessert : banane flambée',
    'Snorkeling'
  ]::text[],
  array[
    'Activités nautiques (parachute ascensionnel, etc.)'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-full-day-catamaran-ile-aux-cerfs'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-full-day-cataspeed-ile-aux-cerfs — Private Full Day Cataspeed Ile Aux Cerfs
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Cataspeed privé d’une journée complète – Île aux Cerfs',
  'Embarquez pour une aventure privée en Cataspeed, d’une journée complète, au départ de Trou d’Eau Douce, et vivez une journée grisante sur l’eau avec la visite de la cascade de la Grande Rivière Sud-Est, du snorkeling dans des lagons aux eaux cristallines, un déjeuner BBQ gastronomique à bord et une halte détente à la magnifique Île aux Cerfs.',
  'Profitez d’une aventure privée exclusive en Cataspeed, d’une journée complète, au départ de Trou d’Eau Douce, sur la côte Est de Maurice. Filez à travers le lagon turquoise jusqu’à la spectaculaire cascade de la Grande Rivière Sud-Est, faites du snorkeling dans des eaux cristallines et savourez un délicieux déjeuner BBQ avec boissons servi à bord. Poursuivez vers l’idyllique Île aux Cerfs, où vous pourrez vous détendre sur des plages de sable blanc immaculées, nager dans le lagon turquoise et profiter à votre rythme de la beauté de ce paradis tropical.',
  'Route Royale Maho, Trou d’Eau Douce',
  array[
    'Île aux Cerfs (région Est)',
    'Cascade GRSE (région Est)',
    'Snorkeling (Eau Bleue)',
    'Déjeuner BBQ et boissons à bord'
  ]::text[],
  array[
    'Salades et pain au beurre à l’ail',
    'BBQ : poulet, poisson, saucisse',
    'Boissons : eau, Coca, bière, vin, rhum local',
    'Dessert : banane flambée',
    'Snorkeling'
  ]::text[],
  array[
    'Activités nautiques (parachute ascensionnel, etc.)'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-full-day-cataspeed-ile-aux-cerfs'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-full-day-dolphin-swimming-ile-aux-benitiers-with-lunch — Private Full day dolphin swimming Ile aux Bénitiers with lunch
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Journée privée nage avec les dauphins à l’Île aux Bénitiers avec déjeuner',
  'Vivez une excursion privée exclusive en speedboat le long de la magnifique côte Ouest de Maurice. Partez pour une journée d’aventure à la nage avec les dauphins dans leur habitat naturel, faites du snorkeling dans des eaux cristallines foisonnant de vie marine, visitez l’emblématique Crystal Rock et détendez-vous sur les magnifiques rives de l’Île aux Bénitiers. Votre expérience privée comprend également un délicieux déjeuner barbecue servi sur l’île, pour une journée parfaite de détente, d’exploration et de souvenirs inoubliables.',
  'Profitez d’une excursion privée exclusive en speedboat, d’une journée complète, le long de la côte Ouest spectaculaire de Maurice. Cette expérience personnalisée vous offre l’occasion de rencontrer des dauphins dans leur habitat naturel, d’explorer de superbes écosystèmes sous-marins en faisant du snorkeling, de visiter l’emblématique Crystal Rock et de vous détendre sur les rives idylliques de l’Île aux Bénitiers.

Votre aventure privée comprend un délicieux déjeuner barbecue servi sur l’île, alliant rencontres inoubliables avec la faune sauvage, paysages côtiers à couper le souffle et détente insulaire à votre propre rythme.',
  'Tamarin',
  array[
    'Nage avec les dauphins (région Ouest)',
    'Snorkeling (région Ouest)',
    'Visite de Crystal Rock (région Ouest)',
    'Déjeuner barbecue à l’Île aux Bénitiers (région Ouest)'
  ]::text[],
  array[
    'Expérience de nage avec les dauphins',
    'Snorkeling avec équipement fourni (masques, palmes, tubas)',
    'Visite de Crystal Rock',
    'Déjeuner barbecue (salades, pain au beurre à l’ail, poulet, poisson et saucisse grillés ; eau, Coca, bière, vin, rhum local ; dessert banane flambée)',
    'Prise en charge et dépose à l’hôtel (partout sur l’île)'
  ]::text[],
  array[
    'Maillot de bain (à porter avant le début de la visite)',
    'Serviettes'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-full-day-dolphin-swimming-ile-aux-benitiers-with-lunch'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-full-day-speed-boat-ile-aux-cerf-with-lunch — Private Full Day Speed Boat Ile Aux Cerf with Lunch
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Speedboat privé d’une journée complète – Île aux Cerfs avec déjeuner',
  'Profitez d’une excursion d’une journée complète à bord de votre propre speedboat privé vers l’Île aux Cerfs — naviguez à travers des lagons turquoise, découvrez la cascade de la Grande Rivière Sud-Est, savourez un déjeuner BBQ sur l’Îlot Mangénie et ajoutez des activités nautiques selon vos envies.',
  'Vivez une expérience inoubliable à bord de votre propre bateau privé jusqu’à l’Île aux Cerfs.

Découvrez et émerveillez-vous devant les paysages superbes des lagons turquoise de la côte Est, tout en vous détendant sur la plage de sable fin — à votre propre rythme. Ne manquez pas l’occasion de visiter la spectaculaire cascade de la Grande Rivière Sud-Est et de savourer un délicieux déjeuner sur l’Îlot Mangénie, rien que pour vous.

Vous pourrez également profiter des nombreuses activités nautiques disponibles pour agrémenter votre journée, comme le parachute ascensionnel, la bouée tractée, le banana boat ou le ski nautique — sans attendre les autres groupes. Une journée pleine d’aventures et de souvenirs inoubliables vous attend sur cette île paradisiaque, rien que pour vous.',
  'Route Royale Maho, Trou d’Eau Douce',
  array[
    'Île aux Cerfs (région Est)',
    'Déjeuner BBQ sur l’Îlot Mangénie (région Est)',
    'Cascade de la Grande Rivière Sud-Est (G.R.S.E.)',
    'Lagons turquoise de la côte Est et plages de sable fin'
  ]::text[],
  array[
    'Déjeuner BBQ avec salades, pain au beurre à l’ail, poulet, poisson, saucisse',
    'Boissons : eau, Coca, bière, vin, rhum local',
    'Dessert banane flambée',
    'Prise en charge et dépose partout sur l’île'
  ]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-full-day-speed-boat-ile-aux-cerf-with-lunch'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-full-day-western-cruise-catamaran — Private Full Day Western Cruise Catamaran
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Croisière privée en catamaran d’une journée complète – Côte Ouest',
  'Profitez d’une croisière privée en catamaran vers la baie de Tamarin, à la recherche des dauphins dans leur habitat naturel, avec du snorkeling près d’un magnifique récif corallien et un délicieux déjeuner à l’ancre, aux abords de l’emblématique Crystal Rock.',
  'Embarquez à bord de votre catamaran privé en direction de la baie de Tamarin, à la recherche des dauphins dans leur habitat naturel, pour une expérience magique et inoubliable au contact de la faune sauvage. Faites ensuite une halte près d’un magnifique récif corallien pour du snorkeling dans des eaux cristallines et découvrez la vie marine foisonnante sous la surface. Savourez un délicieux déjeuner servi à bord, à l’ancre près de l’emblématique Crystal Rock, entouré des paysages à couper le souffle de Maurice.',
  'Rivière Noire',
  array[
    'Départ de Rivière Noire (région Ouest)',
    'Observation des dauphins dans la baie de Tamarin',
    'Snorkeling à Crystal Rock (région Ouest)',
    'Île aux Bénitiers (région Ouest)',
    'Déjeuner à bord (région Ouest)'
  ]::text[],
  array[
    'Déjeuner à bord : salades',
    'Pain au beurre à l’ail',
    'Poulet, poisson, saucisse',
    'Eau, Coca, bière, vin, rhum local',
    'Banane flambée',
    'Salades de fruits',
    'Snorkeling'
  ]::text[],
  array[
    'Merci de ne pas boire d’alcool si vous devez conduire !',
    'Arrivez au point d’embarquement au moins 15 minutes avant le départ',
    'Les personnes venant par leurs propres moyens doivent se référer à Google Maps pour l’itinéraire'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-full-day-western-cruise-catamaran'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-shopping-tour — Private Shopping Tour
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Excursion shopping privée',
  'Journée complète ou demi-journée : faire du shopping à Maurice peut être une expérience merveilleuse. L’artisanat traditionnel, ainsi que les plus beaux produits de luxe, se trouvent dans divers centres commerciaux et boutiques.',
  'Journée complète ou demi-journée : faire du shopping à Maurice peut être une expérience merveilleuse. L’artisanat traditionnel, ainsi que les plus beaux produits de luxe, se trouvent dans divers centres commerciaux et boutiques.

Il existe également plusieurs grands magasins proposant des prix très attractifs, ainsi que des marchés animés où vous pourrez véritablement ressentir le rythme de vie à Maurice. Lors de cette visite, vous aurez l’occasion de découvrir de nombreux lieux au cours d’une journée passionnante : Port-Louis, Curepipe et Floréal.',
  null,
  array[
    'Excursion shopping d’une journée complète',
    'Visitez les destinations shopping incontournables et emblématiques de Maurice',
    'Possibilité d’acheter toute une gamme d’articles : bijoux, souvenirs, vêtements, etc.',
    'Transport privé aller-retour depuis votre lieu d’hébergement'
  ]::text[],
  array[
    'Floreal Factory Shop',
    'Model Ship Factory',
    'Diamond Factory',
    'Marché de Port-Louis Waterfront',
    'Bagatelle Mall',
    'Tribeca Mall',
    'Transport privé avec chauffeur'
  ]::text[],
  array[
    'Déjeuner non inclus.'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-shopping-tour'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-south-east-tour — Private South East Tour
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Excursion privée dans le Sud-Est',
  'Explorez le Sud-Est de Maurice et découvrez sa riche histoire, son patrimoine culturel et ses trésors cachés pittoresques.',
  'Découvrez les merveilles de Maurice lors de notre excursion dans le Sud-Est, un voyage captivant à travers l’histoire, la culture et la beauté naturelle de l’île.

Explorez les eaux cristallines du Blue Bay Marine Park, remontez le temps au musée de Mahébourg, visitez la célèbre biscuiterie de manioc, flânez le long du pittoresque front de mer de Mahébourg, et découvrez les récits du premier débarquement hollandais et du musée Frederik Hendrik. Cette expérience enrichissante offre le parfait équilibre entre patrimoine, paysages à couper le souffle et traditions locales.',
  null,
  array[]::text[],
  array[]::text[],
  array[
    'Déjeuner non inclus'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-south-east-tour'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- private-swimming-with-dolphins-only — Private Swimming with Dolphins Only
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Nage privée avec les dauphins uniquement',
  'Profitez d’une excursion matinale exclusive en speedboat vers la baie de Tamarin pour nager avec des dauphins sauvages dans leur habitat naturel, suivie d’une séance de snorkeling au-dessus de récifs coralliens éclatants de couleurs. Cette excursion privée offre une expérience plus personnalisée et flexible, à votre propre rythme.',
  'Rendez votre séjour à Maurice véritablement inoubliable grâce à une expérience privée et exclusive de nage avec les dauphins. Embarquez tôt, à 7 h 30, à bord de votre speedboat privé, en direction de la baie de Tamarin, où vous rencontrerez des dauphins sauvages dans leur habitat naturel. Profitez de la liberté d’une excursion personnalisée, à votre propre rythme, en glissant dans des eaux cristallines pour observer ces créatures magnifiques de près. Écoutez leurs cris, admirez leurs mouvements gracieux et vivez un lien extraordinaire avec la nature, dans un cadre paisible et préservé de la foule.

Après votre rencontre avec les dauphins, poursuivez votre aventure en faisant du snorkeling au-dessus de récifs coralliens éclatants de vie marine tropicale. Découvrez des poissons multicolores, explorez les eaux cristallines de l’océan Indien et imprégnez-vous de la beauté du monde sous-marin de Maurice. Grâce à l’intimité et à la flexibilité de votre propre bateau, chaque instant est pensé pour créer des souvenirs durables. N’oubliez pas d’immortaliser cette expérience inoubliable avec de superbes photos à chérir pendant des années.',
  'Tamarin',
  array[
    'Tamarin (région Ouest) — point de départ',
    'Nagez avec les dauphins dans la baie de Tamarin, dans leur habitat naturel (région Ouest)',
    'Snorkeling — explorez des récifs coralliens colorés et des poissons tropicaux dans l’océan Indien (région Ouest)'
  ]::text[],
  array[
    'Équipement de snorkeling (masques, palmes, tubas)',
    'Prise en charge et dépose partout sur l’île',
    'Transport en speedboat jusqu’à la baie de Tamarin'
  ]::text[],
  array[
    'Serviettes',
    'Maillot de bain (à porter avant le début de la visite)',
    'Paiement du transport (non compris dans le prix de l’excursion)'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'private-swimming-with-dolphins-only'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- scubadiving — Scuba Diving
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Plongée sous-marine',
  'Explorez les paysages sous-marins à couper le souffle de Maurice, avec des coraux colorés et une riche variété de poissons dans des eaux cristallines.',
  'Plonger à Maurice offre une expérience inoubliable et extraordinaire : vous explorez des paysages sous-marins à couper le souffle, où des coraux colorés forment des paysages enchanteurs grouillant d’une étonnante variété de poissons chatoyants.

C’est véritablement un paradis terrestre pour les passionnés de plongée désireux de découvrir la richesse de la vie marine fascinante de l’océan Indien, ainsi que les nombreux trésors cachés qui attendent d’être découverts dans ses eaux cristallines, propices à l’émerveillement et à l’aventure.',
  'Grand Baie',
  array[
    'Explorez des coraux colorés et la riche vie marine de l’océan Indien',
    'Trois options de lieu (selon la météo) : Grand Baie (Nord), Belle Mare (Est), Flic-en-Flac (Ouest)'
  ]::text[],
  array[
    'Siège bébé (gratuit sur demande)',
    'Prise en charge et dépose partout sur l’île'
  ]::text[],
  array[
    'Ne buvez pas d’alcool si vous devez conduire',
    'Arrivez au moins 15 minutes avant l’heure de départ',
    'Si vous venez par vos propres moyens, l’itinéraire vers le point d’embarquement est disponible sur Google Maps'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'scubadiving'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- seaplane — Fly Over the Underwater Waterfall: Mauritius Seaplane Tour
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Survolez la cascade sous-marine – Tour en hydravion à Maurice',
  'Décollez pieds nus depuis le lagon turquoise de la plage de La Prairie et survolez la célèbre illusion de cascade sous-marine, aux abords d’un site classé au patrimoine mondial de l’UNESCO.',
  'Nous avons le privilège de survoler chaque jour la cascade sous-marine. Nos hydravions décollent depuis la plage de La Prairie, juste à côté de cette merveille naturelle. À quelques pas de là, pieds nus dans le lagon turquoise, vous embarquez à bord de l’hydravion. Préparez-vous à décoller depuis des eaux cristallines, aux abords d’un site classé au patrimoine mondial de l’UNESCO. Confortablement installé aux côtés du pilote, vous découvrirez cette célèbre illusion : une cascade au fond de l’océan Indien. C’est magique et majestueux. Cette vue, l’une des plus photogéniques au monde, a captivé la planète entière depuis que ses photos ont fait le tour d’internet. Ce trésor naturel se doit vraiment d’être vu de ses propres yeux.',
  null,
  array[
    'Survolez la célèbre illusion de cascade sous-marine, au fond de l’océan Indien',
    'Décollez pieds nus depuis le lagon turquoise de la plage de La Prairie',
    'Installé aux côtés du pilote',
    'Vue sur un site classé au patrimoine mondial de l’UNESCO',
    'Trois formules : 15 min (le court « Ambre »), 30 min (l’expérience Turquoise), 60 min (le mythique Est)'
  ]::text[],
  array[]::text[],
  array[]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'seaplane'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- skydive — Tandem Skydiving in Mauritius
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Saut en parachute en tandem à Maurice',
  'Sautez en parachute en tandem depuis 10 000 pieds au-dessus des champs de canne à sucre de Mon Loisir, avec une chute libre à 200 km/h avant une descente en vol plané au-dessus des lagons et récifs de l’océan Indien.',
  'Profitez des vues spectaculaires de Maurice lors d’un saut en parachute en tandem. Envolez-vous dans les airs, solidement harnaché à votre instructeur expérimenté. Admirez une vue à 360 degrés sur le littoral, l’intérieur des terres et les montagnes avant votre saut. Cette activité riche en adrénaline convient aussi bien aux débutants qu’aux amateurs de sensations fortes expérimentés. À 10 000 pieds, vous effectuerez une chute libre à 200 km/h pendant une minute, puis une descente en vol plané de 5 minutes avant d’atterrir en toute sécurité. Ressentez la montée d’adrénaline en plongeant vers la terre, entouré de panoramas à couper le souffle. Décollez depuis les magnifiques champs de canne à sucre de Mon Loisir, surplombant les lagons et récifs de l’océan Indien. Après cette expérience grisante, détendez-vous et repensez à votre aventure en savourant des rafraîchissements sur la zone d’atterrissage. L’excursion complète de saut en parachute dure environ 1 heure, incluant l’entraînement au sol, 25 minutes de vol, la chute libre et la descente en parachute. Célébrez votre courage et votre sentiment d’accomplissement avec vos amis et votre famille, qui pourront assister à votre saut et vous encourager. Recevez un certificat de saut en parachute en tandem, et optez, moyennant un supplément, pour un DVD souvenir de votre saut. Pensez à réserver à l’avance pour garantir votre place lors de cette aventure inoubliable à Maurice.',
  null,
  array[
    'Vue panoramique à 360 degrés sur le littoral, l’intérieur des terres et les montagnes',
    'Décollage depuis les champs de canne à sucre de Mon Loisir, surplombant les lagons et récifs de l’océan Indien',
    'Chute libre à 200 km/h pendant une minute',
    'Descente en vol plané de 5 minutes',
    'Rafraîchissements sur la zone d’atterrissage'
  ]::text[],
  array[
    'Saut en parachute en tandem depuis 10 000 pieds',
    'Entraînement au sol',
    '25 minutes de vol',
    'Chute libre et descente en parachute',
    'Certificat de saut en parachute en tandem',
    'Rafraîchissements sur la zone d’atterrissage',
    'Prise en charge et dépose partout sur l’île'
  ]::text[],
  array[
    'DVD de votre saut (supplément : Rs 5 000)',
    'Photos (supplément : Rs 6 500)',
    'Ne buvez pas d’alcool si vous conduisez votre propre véhicule'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'skydive'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- south-tour-mauritius — Private South Tour Mauritius
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Excursion privée dans le Sud de Maurice',
  'Lieux à découvrir lors de cette visite du Sud : Trou aux Cerfs (volcan), Floréal (shopping), Grand Bassin — lac sacré du temple hindou, gorges de la Rivière Noire — point de vue, terre des 7 couleurs de Chamarel et sa cascade, point de vue sur l’Île aux Bénitiers',
  'Sur les hauteurs, découvrez l’impressionnant Trou aux Cerfs, cratère d’un volcan éteint depuis 700 000 ans. De là-haut, vous profiterez d’une vue saisissante sur la chaîne de montagnes centrale de Maurice.

Lors de cette visite, vous aurez l’occasion d’explorer de nombreux lieux passionnants en une seule journée : le Trou aux Cerfs, Floréal, Grand Bassin, les gorges de la Rivière Noire, Chamarel, et un point de vue sur l’Île aux Bénitiers. Vous pouvez également personnaliser cette excursion et organiser vos sorties selon votre emploi du temps. Vous avez aussi la possibilité d’ajouter d’autres activités telles que la Vallée des Couleurs, le Curious Corner et la distillerie de rhum de Chamarel.

Prise en charge et dépose depuis n’importe quel hôtel ou lieu d’hébergement, partout à Maurice. Un chauffeur-guide personnel vous accompagnera, vous informera et vous offrira un service sur mesure.',
  'Prise en charge et dépose partout sur l’île',
  array[]::text[],
  array[
    'Prise en charge et dépose partout sur l’île',
    'Transport privé dans un véhicule climatisé confortable',
    'Chauffeur-guide professionnel',
    'Prise en charge et dépose à l’Airbnb et à l’hôtel',
    'Un chauffeur aimable, parlant anglais et français, pour vous guider et vous informer à chaque étape'
  ]::text[],
  array[
    'Billets d’entrée : les visites et le déjeuner ne sont pas inclus dans le prix.'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'south-tour-mauritius'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- speed-boat-ile-aux-cerfs — Full Day Speed Boat Ile Aux Cerf with Lunch
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Speedboat d’une journée complète – Île aux Cerfs avec déjeuner',
  'Une excursion d’une journée complète en speedboat vers l’Île aux Cerfs, avec ses lagons turquoise, la cascade de la Grande Rivière Sud-Est, un déjeuner BBQ sur l’Îlot Mangénie et des activités nautiques en option.',
  'Vivez une expérience inoubliable avec cette excursion en bateau vers l’Île aux Cerfs.

Découvrez et émerveillez-vous devant les paysages superbes des lagons turquoise de la côte Est, tout en vous détendant sur la plage de sable fin. Ne manquez pas l’occasion de visiter la spectaculaire cascade de la Grande Rivière Sud-Est et de savourer un délicieux déjeuner sur l’Îlot Mangénie.

Profitez également des nombreuses activités nautiques disponibles pour agrémenter votre journée, comme le parachute ascensionnel, la bouée tractée, le banana boat ou le ski nautique. Une journée pleine d’aventures et de souvenirs inoubliables vous attend sur cette île paradisiaque.',
  'Trou d’Eau Douce',
  array[
    'Île aux Cerfs (région Est)',
    'Déjeuner BBQ sur l’Îlot Mangénie (région Est)',
    'Cascade de la Grande Rivière Sud-Est (GRSE)',
    'Lagons turquoise de la côte Est et plages de sable fin'
  ]::text[],
  array[
    'Déjeuner BBQ avec salades, pain au beurre à l’ail, poulet, poisson, saucisse',
    'Boissons : eau, Coca, bière, vin, rhum local',
    'Dessert banane flambée',
    'Prise en charge et dépose partout sur l’île'
  ]::text[],
  array[
    'Le transport est organisé séparément, moyennant un supplément',
    'Les activités nautiques (parachute ascensionnel, banana boat, bouée tractée, ski nautique) sont optionnelles/en supplément',
    'Merci de ne pas boire d’alcool si vous devez conduire',
    'Arrivez au point d’embarquement au moins 15 minutes avant l’heure de départ'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'speed-boat-ile-aux-cerfs'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- swimming-with-dolphins — Swimming with Dolphins Only
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Nage avec les dauphins uniquement',
  'Excursion matinale en speedboat vers la baie de Tamarin pour nager avec des dauphins sauvages dans leur habitat naturel, suivie d’une séance de snorkeling au-dessus de récifs coralliens.',
  'Rendez votre séjour à Maurice véritablement inoubliable grâce à l’expérience magique de la nage avec les dauphins. Embarquez tôt, à 7 h 30, à bord d’un speedboat, en direction de la baie de Tamarin, où vous rencontrerez ces créatures extraordinaires dans leur habitat naturel. Ressentez le frisson de plonger dans des eaux cristallines et d’observer les dauphins jouer à quelques mètres de vous. Écoutez leurs cris, observez leurs mouvements gracieux et profitez d’un moment unique de connexion avec la nature. Cette aventure extraordinaire vous comblera de joie, d’émerveillement et d’un sentiment de liberté inégalé.

Après votre rencontre avec les dauphins, explorez la vie marine foisonnante sous les vagues. Faites du snorkeling parmi des récifs coralliens colorés, nagez aux côtés de poissons tropicaux et découvrez le monde sous-marin à couper le souffle de l’océan Indien. Chaque instant est une occasion de vous évader, de vous ressourcer et de renouer avec la beauté de la mer. N’oubliez pas d’immortaliser ces souvenirs inoubliables avec de superbes photos.',
  'Tamarin',
  array[
    'Tamarin (région Ouest) — point de départ',
    'Nagez avec les dauphins dans la baie de Tamarin, dans leur habitat naturel (région Ouest)',
    'Snorkeling — explorez des récifs coralliens colorés et des poissons tropicaux dans l’océan Indien (région Ouest)'
  ]::text[],
  array[
    'Équipement de snorkeling (masques, palmes, tubas)',
    'Prise en charge et dépose partout sur l’île',
    'Transport en speedboat jusqu’à la baie de Tamarin'
  ]::text[],
  array[
    'Maillot de bain (à porter avant le début de la visite)',
    'Serviettes',
    'Paiement du transport (non compris dans le prix de l’excursion)'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'swimming-with-dolphins'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- swimming-with-dolphins-benitier-island-speedboat-all-inclusive — Full day dolphin swimming Ile aux Bénitiers with lunch
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Journée nage avec les dauphins à l’Île aux Bénitiers avec déjeuner',
  'Excursion en speedboat d’une journée complète dans l’Ouest de Maurice : nagez avec les dauphins, faites du snorkeling, visitez Crystal Rock et savourez un déjeuner barbecue à l’Île aux Bénitiers.',
  'Cette excursion en speedboat d’une journée complète offre une immersion totale dans l’océan, dans la région Ouest de Maurice.

Les participants rencontrent des dauphins dans leur habitat naturel, explorent des écosystèmes sous-marins en faisant du snorkeling, visitent l’emblématique formation rocheuse de Crystal Rock, et terminent par un déjeuner barbecue à l’Île aux Bénitiers.

Cette formule tout compris allie observation de la faune sauvage, exploration insulaire et restauration.',
  'Tamarin',
  array[
    'Nage avec les dauphins (région Ouest)',
    'Snorkeling (région Ouest)',
    'Visite de Crystal Rock (région Ouest)',
    'Déjeuner barbecue à l’Île aux Bénitiers (région Ouest)'
  ]::text[],
  array[
    'Expérience de nage avec les dauphins',
    'Snorkeling avec équipement fourni (masques, palmes, tubas)',
    'Visite de Crystal Rock',
    'Déjeuner barbecue (salades, pain au beurre à l’ail, poulet, poisson et saucisse grillés ; eau, Coca, bière, vin, rhum local ; dessert banane flambée)',
    'Prise en charge et dépose à l’hôtel (partout sur l’île)'
  ]::text[],
  array[
    'Maillot de bain (à porter avant le début de la visite)',
    'Serviettes'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'swimming-with-dolphins-benitier-island-speedboat-all-inclusive'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- tea-tasting-tour — Private South - Tea Tasting
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Sud privé – Dégustation de thé',
  'Explorez le Sud de Maurice avec un chauffeur-guide personnel, avec au programme la plantation et la fabrique de thé de Bois Chéri, ainsi que la maison coloniale et la distillerie de rhum de Saint Aubin.',
  'Bois Chéri est l’une des fabriques de thé les plus importantes de l’île. Vous découvrirez les différentes étapes de la production tout en savourant une bonne tasse de thé. Un chauffeur-guide personnel vous accompagnera tout au long de la visite et vous informera, pour un service sur mesure.

Vous pouvez également personnaliser cette visite et organiser vos activités selon votre emploi du temps. Vous pouvez aussi ajouter d’autres activités telles que le Blue Bay (parc marin) et le Musée naval de Mahébourg. Détails : vous explorerez d’abord Bois Chéri, où vous découvrirez la plantation de thé et visiterez la fabrique. Saint Aubin, également appelée Maison Coloniale, fut construite en 1819 ; elle est fière de ses anthuriums et de ses serres, ainsi que de sa distillerie de rhum.

Ensuite, nous visiterons Gris Gris pour observer les vagues se briser contre les falaises. La Vanille Nature Park est un sanctuaire des îles Mascareignes, abritant des crocodiles se prélassant au soleil, des chauves-souris, des tortues géantes et un insectarium comptant plus de 20 000 espèces différentes.',
  null,
  array[
    'Concernant le déjeuner, votre chauffeur pourra vous recommander de bons restaurants en chemin.',
    'Billets d’entrée : les visites et le déjeuner ne sont pas inclus dans le prix.',
    'Les prix s’entendent par véhicule et non par personne'
  ]::text[],
  array[
    'Prise en charge et dépose depuis n’importe quel hôtel ou Airbnb à Maurice.',
    'Transport privé vers tous les sites mentionnés ci-dessus.',
    'Un chauffeur aimable, parlant anglais et français, pour vous guider et vous informer à chaque étape.'
  ]::text[],
  array[
    'Le déjeuner n’est pas inclus dans la formule. Votre chauffeur-guide vous suggérera un restaurant selon vos préférences, ou vous pourrez demander un arrêt dans le restaurant de votre choix en chemin. Le choix vous appartient entièrement.',
    'Les frais d’entrée aux sites tels que la fabrique de thé et La Vanille Nature Park ne sont pas inclus dans le prix. Contactez-nous pour plus d’informations.'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'tea-tasting-tour'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- the-blue-cruise-ile-aux-cerfs-5-islands-visit — Full Day 5 Islands tour Ile Aux Cerfs with Lunch
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Tour d’une journée complète aux 5 îles – Île aux Cerfs avec déjeuner',
  'Une excursion en speedboat d’une journée complète au départ de Trou d’Eau Douce : la cascade GRSE, du snorkeling parmi les jardins de corail, cinq îles, un déjeuner BBQ et les plages du nord de l’Île aux Cerfs.',
  'Cette excursion en speedboat au départ de Trou d’Eau Douce promet une évasion totale.

Votre aventure débute par la découverte de la majestueuse cascade de la Grande Rivière Sud-Est, un spectacle naturel à couper le souffle. Plongez ensuite dans un véritable aquarium naturel lors d’une séance de snorkeling. Explorez les jardins de corail et nagez parmi des poissons tropicaux éclatants de couleurs.

Poursuivez votre périple à travers les trésors cachés de la côte : l’Île aux Aigrettes, l’Île aux Prison et l’Île au Phare. Chaque étape réserve son lot de surprises, entre récits fascinants et paysages préservés.

Le clou de la journée ? Un délicieux déjeuner BBQ dans un cadre idyllique, sur la partie sud de l’Île aux Cerfs. Savourez des saveurs locales, les pieds dans le sable, caressé par la brise marine. Pour clore cette journée magique, détendez-vous sur les plages paradisiaques du nord de l’Île aux Cerfs, où le lagon turquoise vous invite à la baignade et à la détente.',
  'Trou d’Eau Douce',
  array[
    'Cascade de la Grande Rivière Sud-Est (GRSE)',
    'Snorkeling parmi les jardins de corail et les poissons tropicaux à Eau Bleue',
    'Île aux Aigrettes (région Sud-Est)',
    'Île aux Prison (région Sud-Est)',
    'Île Phare / Île au Phare (région Sud-Est)',
    'Déjeuner BBQ sur la partie sud de l’Île aux Cerfs',
    'Plages du nord de l’Île aux Cerfs et lagon turquoise'
  ]::text[],
  array[
    'Déjeuner et boissons',
    'Déjeuner BBQ avec salades, pain au beurre à l’ail, poulet, poisson, saucisse',
    'Boissons : eau, Coca, bière, vin, rhum local',
    'Dessert banane flambée',
    'Séance de snorkeling',
    'Visite des cinq îles',
    'Prise en charge (en option)'
  ]::text[],
  array[
    'Merci de ne pas boire d’alcool si vous devez conduire',
    'Arrivez au point d’embarquement au moins 15 minutes avant l’heure de départ'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'the-blue-cruise-ile-aux-cerfs-5-islands-visit'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- underwater-sea-walk-excursion — Underwater Sea Walk Excursion
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Excursion de marche sous-marine',
  'Marchez sur le fond marin à une profondeur de 10 à 13 pieds, en combinaison de plongée, accompagné d’instructeurs expérimentés, pour observer la faune et la flore marines.',
  'Équipé d’une combinaison de plongée et accompagné d’instructeurs expérimentés, plongez dans le monde sous-marin à une profondeur de 10 à 13 pieds pour une expérience inoubliable et enrichissante.

Explorez le fond marin, observez la faune et la flore marines dans leur habitat naturel, et laissez-vous émerveiller par la beauté et la diversité de cet univers fascinant. Profitez de cette aventure unique pour vous émerveiller devant la nature et en apprendre davantage sur la vie marine.',
  'Belle Mare',
  array[
    'Marchez sur le fond marin en combinaison de plongée',
    'Observez la faune et la flore marines dans leur habitat naturel',
    'Découvrez la beauté et la diversité du monde sous-marin'
  ]::text[],
  array[
    'Combinaison de plongée fournie',
    'Instructeurs expérimentés',
    'Exploration sous-marine à une profondeur de 10 à 13 pieds',
    'Prise en charge et dépose partout sur l’île'
  ]::text[],
  array[
    'Ne buvez pas d’alcool si vous devez conduire',
    'Si vous venez par vos propres moyens, arrivez au moins 15 minutes à l’avance'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'underwater-sea-walk-excursion'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- visit-to-ambre-island-by-kayak — Visit To Ambre Island By Kayak
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Visite de l’Île d’Ambre en kayak',
  'Pagayez en kayak à travers les mangroves paisibles de l’Île d’Ambre, explorez ses recoins secrets et ses ruines anciennes, puis détendez-vous sur l’Île Bernache.',
  'Pagayez en kayak à travers les mangroves de l’Île d’Ambre et découvrez son environnement d’une manière unique et immersive. Imprégnez-vous de la beauté naturelle qui entoure ces eaux paisibles et observez la faune et la flore locales dans leur habitat naturel.

Explorez les recoins cachés de l’île, plongez dans son passé fascinant en visitant des ruines anciennes et en découvrant les récits palpitants qui les entourent. Invitez toute votre famille élargie — grands-parents, oncles, tantes — ainsi que vos amis les plus proches, à vous rejoindre pour cette aventure inoubliable à Maurice. Votre excursion en kayak débutera par un briefing de sécurité détaillé, suivi d’une paisible balade à travers le lagon et les mangroves luxuriantes.

Laissez-vous emporter par les paysages pittoresques et les eaux cristallines en naviguant à travers les chenaux ombragés et les petits îlots pittoresques qui parsèment la région. Prolongez votre exploration de l’Île d’Ambre, imprégnez-vous de sa sérénité et découvrez les mystères qui se cachent derrière chaque recoin. Enfin, offrez-vous un moment de détente bien mérité sur l’Île Bernache, où vous pourrez vous ressourcer et vous imprégner de la beauté naturelle qui vous entoure avant de regagner la terre ferme, des étoiles plein les yeux et des souvenirs inoubliables plein le cœur.',
  'Saint-Antoine, Poudre d’Or',
  array[
    'Briefing de sécurité',
    'Balade à travers le lagon et les mangroves luxuriantes',
    'Navigation à travers des chenaux ombragés et des îlots pittoresques',
    'Explorez les recoins cachés et les ruines anciennes de l’Île d’Ambre',
    'Détente sur l’Île Bernache'
  ]::text[],
  array[
    'Briefing de sécurité',
    'Balade en kayak à travers le lagon et les mangroves',
    'Exploration de l’Île d’Ambre',
    'Visite de l’Île Bernache pour un moment de détente',
    'Prise en charge et dépose partout sur l’île'
  ]::text[],
  array[
    'Ne buvez pas d’alcool si vous devez conduire',
    'Arrivez au moins 15 minutes avant l’heure de départ',
    'Si vous venez par vos propres moyens, l’itinéraire vers le point d’embarquement est disponible sur Google Maps'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'visit-to-ambre-island-by-kayak'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';

-- ---------------------------------------------------------------------------
-- western-cruise-catamaran — Western Cruise Catamaran
-- ---------------------------------------------------------------------------
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select
  a.id,
  'fr'::content_locale,
  'Croisière en catamaran – Côte Ouest',
  'Direction la baie de Tamarin à la recherche des dauphins dans leur habitat naturel, avec du snorkeling près d’un récif corallien et un déjeuner à l’ancre, aux abords de Crystal Rock.',
  'Direction la baie de Tamarin à la recherche des dauphins dans leur habitat naturel, pour une expérience magique et inoubliable d’observation de ces créatures majestueuses en fin de matinée. La croisière comprend une halte près d’un magnifique récif corallien pour une séance de snorkeling dans des eaux cristallines, à la découverte de l’incroyable beauté et diversité de la vie sous-marine. Un délicieux déjeuner est servi à l’ancre, avec vue sur Crystal Rock scintillant sous le soleil tropical.',
  null,
  array[
    'Départ de Rivière Noire (région Ouest)',
    'Observation des dauphins dans la baie de Tamarin',
    'Snorkeling à Crystal Rock (région Ouest)',
    'Île aux Bénitiers (région Ouest)',
    'Déjeuner à bord (région Ouest)'
  ]::text[],
  array[
    'Déjeuner à bord : salades',
    'Pain au beurre à l’ail',
    'Poulet, poisson, saucisse',
    'Eau, Coca, bière, vin, rhum local',
    'Banane flambée',
    'Salades de fruits',
    'Snorkeling'
  ]::text[],
  array[
    'Merci de ne pas boire d’alcool si vous devez conduire !',
    'Arrivez au point d’embarquement au moins 15 minutes avant le départ',
    'Les personnes venant par leurs propres moyens doivent se référer à Google Maps pour l’itinéraire'
  ]::text[],
  null,
  null,
  'machine'
from activities a
where a.slug = 'western-cruise-catamaran'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';
