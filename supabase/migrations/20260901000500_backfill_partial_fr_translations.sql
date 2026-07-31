-- Backfill French fields the catalogue seed skipped.
--
-- 20260901000400 guarded its upsert with "where activity_translations.source = 'machine'" so a
-- redeploy could never discard the owner's reviewed copy. That guard is correct in intent but
-- ROW-level, and the rest of this feature resolves translations PER FIELD. The difference bit:
-- the owner reviewed a French title for catapseed-5-islands in /admin (making the row 'human'),
-- and the seed then skipped the row wholesale — so that tour kept a French title and shipped an
-- English description and English highlights, which is exactly the half-translated state the
-- project exists to remove.
--
-- This re-applies the drafted copy with PER-FIELD merge: a field the owner has filled is never
-- touched, a field they left empty is filled. Arrays count as empty at length 0, matching the
-- nullif(...,'{}') rule the RPCs use.
--
-- source becomes 'machine' because the row now contains unreviewed machine copy again. Leaving it
-- 'human' would hide fresh machine text behind a reviewed badge; prompting one extra review is the
-- safer error.

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
  set title           = coalesce(activity_translations.title, excluded.title),
      summary         = coalesce(activity_translations.summary, excluded.summary),
      description     = coalesce(activity_translations.description, excluded.description),
      meeting_point   = coalesce(activity_translations.meeting_point, excluded.meeting_point),
      seo_title       = coalesce(activity_translations.seo_title, excluded.seo_title),
      seo_description = coalesce(activity_translations.seo_description, excluded.seo_description),
      highlights = case when coalesce(array_length(activity_translations.highlights, 1), 0) = 0
                        then excluded.highlights else activity_translations.highlights end,
      inclusions = case when coalesce(array_length(activity_translations.inclusions, 1), 0) = 0
                        then excluded.inclusions else activity_translations.inclusions end,
      exclusions = case when coalesce(array_length(activity_translations.exclusions, 1), 0) = 0
                        then excluded.exclusions else activity_translations.exclusions end,
      source = 'machine';
