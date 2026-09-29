import type { FrenchMeta } from './override';

/**
 * French search snippets for public pages, keyed by their English path.
 *
 * Before these existed /fr/<path> showed the English title — /fr/mauritius-catamaran-cruise sat at
 * #46 for "catamaran ile maurice" and "croisière catamaran île maurice" (Search Console, Sep 2026),
 * searches about as frequent as the English ones — and 65 French pages shared their English twin's
 * title (Site Audit, 30 Sep 2026). French searchers type "île Maurice", so every title that targets a
 * search carries it. Titles are absolute: no " | Belle Mare Tours" suffix, ~60 characters max.
 * On /fr these beat the /admin/seo override, which is English (see overrideMetadata).
 */
export const PAGE_META_FR: Record<string, FrenchMeta> = {
  '/': {
    title: 'Belle Mare Tours : excursions et taxi à l’île Maurice',
    description:
      'Réservez vos excursions, activités et transferts aéroport à l’île Maurice en direct : catamaran, dauphins, Île aux Cerfs et visites privées de l’île.',
  },
  '/activities': {
    title: 'Activités et excursions à l’île Maurice | Belle Mare Tours',
    description:
      'Réservez vos activités à l’île Maurice en direct : catamaran, dauphins, Île aux Cerfs, marche sous-marine et visites privées. Confirmation immédiate.',
  },
  '/attractions': {
    title: 'Que voir à l’île Maurice : sites et lieux à visiter',
    description:
      'Les plus beaux sites de l’île Maurice par un guide local : plages, cascades, points de vue, temples et jardins, avec comment y aller et quand les visiter.',
  },
  '/airport-transfers': {
    title: 'Transfert aéroport île Maurice : taxi privé à prix fixe',
    description:
      'Transferts privés à prix fixe en euros entre l’aéroport SSR (MRU) et votre hôtel, Airbnb ou port à l’île Maurice. Accueil à l’arrivée et suivi du vol.',
  },
  '/rent': {
    title: 'Location de voiture à l’île Maurice pas chère',
    description:
      'Location de voiture et de scooter à l’île Maurice depuis Belle Mare, à petit prix. Choisissez votre véhicule et réservez simplement sur WhatsApp.',
  },
  '/blog': {
    title: 'Blog voyage île Maurice : guides, conseils et itinéraires',
    description:
      'Guides de voyage, conseils et itinéraires pour l’île Maurice, écrits par l’équipe locale de Belle Mare Tours.',
  },
  '/destinations': {
    title: 'Régions de l’île Maurice : guides par destination',
    description:
      'Les régions et stations balnéaires de l’île Maurice : où dormir, que faire et comment se déplacer, par un opérateur local.',
  },
  '/mauritius-travel-guide': {
    title: 'Guide de voyage île Maurice 2026-2027 : préparer son séjour',
    description:
      'Tout pour préparer votre voyage à l’île Maurice : quand partir, où dormir, comment se déplacer et les expériences à réserver.',
  },
  '/reviews': {
    title: 'Avis Belle Mare Tours, île Maurice : 4,8/5 sur 1 000+ avis',
    description:
      'Avis de voyageurs sur Belle Mare Tours issus de TripAdvisor et Google : 4,8/5 sur plus de mille avis.',
  },
  '/about': {
    title: 'À propos de Belle Mare Tours, tour-opérateur à l’île Maurice',
    description:
      'Belle Mare Tours est un tour-opérateur agréé de la côte est de l’île Maurice : excursions, croisières et transferts, en direct et sans intermédiaire.',
  },
  '/ai-road-trip-planner': {
    title: 'Planificateur de road trip IA à l’île Maurice',
    description:
      'Composez votre journée à l’île Maurice avec notre planificateur IA : itinéraire, sites et chauffeur privé, puis réservez en ligne.',
  },
  '/contact': {
    title: 'Contacter Belle Mare Tours, île Maurice',
    description:
      'Contactez Belle Mare Tours par WhatsApp ou par e-mail : questions, devis, prise en charge à l’hôtel. Opérateur local basé à Belle Mare, île Maurice.',
  },
  '/help': {
    title: 'Centre d’aide Belle Mare Tours, île Maurice',
    description:
      'Réponses sur les réservations, les paiements, les annulations et la prise en charge à l’hôtel pour vos excursions à l’île Maurice.',
  },
  '/cookies': {
    title: 'Politique relative aux cookies · Belle Mare Tours',
    description:
      'Les cookies et le stockage du navigateur utilisés par Belle Mare Tours, leur rôle et comment les gérer.',
  },
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
