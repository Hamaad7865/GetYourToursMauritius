import type { FrenchMeta } from './override';

/**
 * French search snippets for the landing pages, keyed by their English path.
 *
 * Before these existed /fr/<path> showed the English title — /fr/mauritius-catamaran-cruise sat at
 * #46 for "catamaran ile maurice" and "croisière catamaran île maurice" (Search Console, Sep 2026),
 * searches about as frequent as the English ones. French searchers type "île Maurice", so every
 * title carries it. Titles are absolute: no " | Belle Mare Tours" suffix, ~60 characters max.
 */
export const LANDING_META_FR: Record<string, FrenchMeta> = {
  '/mauritius-catamaran-cruise': {
    title: 'Croisière catamaran à l’île Maurice : sorties et excursions',
    description:
      'Croisières en catamaran à l’île Maurice en direct avec l’opérateur : snorkeling, barbecue à bord, Île aux Cerfs ou îlots du nord. Partagées ou privées.',
  },
  '/mauritius-tours': {
    title: 'Excursions à l’île Maurice : sorties et visites à la journée',
    description:
      'Réservez vos excursions à l’île Maurice en direct : catamaran, dauphins, Île aux Cerfs et visites privées de l’île. Prix fixes, sans intermédiaire.',
  },
  '/ile-aux-cerfs-tours': {
    title: 'Excursion à l’Île aux Cerfs, île Maurice : bateau et lagon',
    description:
      'Excursions à l’Île aux Cerfs depuis Belle Mare : catamaran ou bateau rapide, lagon, cascade de la GRSE et barbecue sur la plage. Réservation directe.',
  },
  '/dolphin-swim-mauritius': {
    title: 'Nager avec les dauphins à l’île Maurice : sorties en mer',
    description:
      'Nagez avec les dauphins sauvages à l’île Maurice : sortie matinale en petit bateau dans les baies de Tamarin et Rivière Noire. Réservation directe.',
  },
  '/belle-mare-tours': {
    title: 'Belle Mare Tours : tour-opérateur agréé à l’île Maurice',
    description:
      'Tour-opérateur agréé sur la côte est de l’île Maurice : catamaran, excursions, dauphins et transferts aéroport. Prix fixes, réservation directe.',
  },
  '/things-to-do-in-belle-mare': {
    title: 'Que faire à Belle Mare, île Maurice : activités et plages',
    description:
      'Que faire à Belle Mare, île Maurice : plage et lagon, Île aux Cerfs, catamaran, kitesurf, golf et excursions, avec l’opérateur local de la côte est.',
  },
};
