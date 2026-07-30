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
  'Randonnée dans les Black River Gorges',
  'Randonnée au cœur du parc national des Black River Gorges à la découverte de cascades secrètes, d’une faune endémique et de vues panoramiques depuis la crête.',
  'Explorez avec nous le cœur des Black River Gorges et laissez-vous surprendre par des trésors cachés qui se révèlent peu à peu à vous.

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
    'Île Phare / Île aux Phare (région Sud-Est)',
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
  'Black River',
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
  'Une excursion privée d’une journée en speedboat au départ de Grand Baie vers Flat Island, Gabriel Island et Gunner’s Coin, avec snorkeling, déjeuner BBQ et boissons.',
  'Une excursion privée d’une journée en speedboat pour visiter trois îles du Nord de Maurice. Le départ se fait de Grand Baie, avec un trajet d’environ 45 minutes jusqu’à Flat Island, pour un moment de détente et de snorkeling dans les lagons.

Une faune et une flore tropicales vous attendent, aussi bien dans l’eau que sur l’île. Après un déjeuner BBQ, le bateau poursuit sa route vers Gabriel Island pour une exploration. Une dernière séance de snorkeling a lieu près de Gunner’s Coin, l’un des plus beaux spots de plongée au nord de Maurice.',
  'Grand Baie',
  array[
    'Flat Island : détente, snorkeling et déjeuner BBQ',
    'Gabriel Island : exploration de l’île',
    'Gunner’s Coin : snorkeling sur l’un des plus beaux spots de plongée au nord de Maurice'
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
  'The Must (départ de Triolet, Nord) : Un vol court et des souvenirs gravés à jamais dans votre mémoire. L’itinéraire au départ de la base de Triolet comprend un survol des paysages et des îlots du Nord. Profitez de l’effervescence de Grand-Baie vue du ciel et des bateaux alignés près de la plage de sable doré. Survolez ensuite le Coin de Mire, qui domine la côte Nord, et l’Île Plate, refuge de diverses espèces de reptiles. Le vol se termine par un magnifique passage au-dessus de l’Île d’Ambre, où le célèbre Saint-Géran a fait naufrage et qui servit de cadre à Paul et Virginie de Bernardin de Saint-Pierre.

LE MAGIQUE (départ de Triolet, Nord) : Découvrez de magnifiques panoramas de Maurice en survolant l’île pendant 40 minutes avec notre expérience exclusive Le Magique. L’aventure commence par un décollage majestueux depuis notre base de Triolet, où notre équipe dévouée vous réserve l’accueil le plus chaleureux. Profitez d’un moment de détente dans notre élégant salon, suivi d’un briefing de vol complet pour une expérience inoubliable. Embarquez ensuite pour une excursion aérienne fascinante qui révélera les trésors cachés de Maurice. Admirez la vue à couper le souffle sur Port-Louis, survolez les silos emblématiques du Moulin de la Concorde, observez les navires qui animent la capitale, émerveillez-vous devant les vastes espaces verts et le lagon aux eaux cristallines, découvrez l’Île aux Bénitiers et contemplez le majestueux phare d’Albion qui domine fièrement les environs. Une expérience inoubliable vous attend, prête à transformer votre vision de Maurice à jamais. Si vous vous demandez quelle est cette montagne majestueuse où vivent les paille-en-queue, il s’agit du Morne Brabant ! Ne manquez pas la cascade sous-marine et admirez les couleurs magnifiques de Chamarel. Détendez-vous sur les plages de sable blanc de l’Île aux Cerfs et profitez du soleil tropical en sirotant un cocktail rafraîchissant. Explorez les gorges de la Rivière Noire pour découvrir la beauté d’une nature brute, puis admirez les cascades de Tamarin cachées dans une forêt endémique. Plongez dans les eaux cristallines du Blue Bay Marine Park pour une expérience de plongée inoubliable parmi les coraux et les poissons multicolores. Approchez-vous du Pieter Both, une montagne liée à une célèbre légende, avant de terminer votre voyage par un survol à couper le souffle avec Corail Hélicoptères ! N’oubliez pas de goûter aux délices de la cuisine mauricienne locale, comme le carry de poulet et les samoussas épicés, pour une expérience culinaire authentique.

THE EXCELLENCE (départ de Triolet, Nord) : Vous survolerez le Pieter Both et Le Pouce pour démarrer votre aventure en beauté. Admirez ensuite le magnifique panorama de la cascade de Tamarin, au cœur d’une forêt verdoyante et de rochers sculptés par Mère Nature. Vous aurez également l’impression de voler avec les paille-en-queue en approchant des gorges de la Rivière Noire. Après un détour par l’Île aux Bénitiers, immortalisez la cascade sous-marine près du Morne Brabant, classé au patrimoine mondial de l’UNESCO. Vous vous demanderez peut-être si l’arc-en-ciel est tombé du ciel en survolant Chamarel. La magie est toujours présente ici ! Avez-vous déjà vu un îlot au milieu d’un lac ? Vivez cette expérience unique à Ganga Talao. N’oubliez pas de jeter un œil au cratère du volcan endormi de Kanaka, à Maurice. En approchant de l’île, survolez l’Île aux Cerfs à l’Est, puis remontez vers le Nord en passant au-dessus de l’Île d’Ambre et de l’Île Plate, réputée pour ses caméléons aux motifs artistiques ! Près de Cap Malheureux se trouve Le Coin de Mire, visible depuis notre base si les nuages le permettent ! Voici Maurice dans toute sa splendeur !',
  null,
  array[
    'The Must : survol des paysages et îlots du Nord, Grand-Baie, Coin de Mire, Île Plate, Île d’Ambre (site du naufrage du Saint-Géran)',
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
