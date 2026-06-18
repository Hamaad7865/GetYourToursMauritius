/**
 * French translations, keyed by the English source string used inline in components (gettext-style).
 * A missing key falls back to English, so the app never shows a raw key. Place names, tour titles
 * pulled from the DB, and other real-world proper nouns are NOT translated — only UI chrome and copy.
 *
 * Grouped by area for readability; it's one flat map at runtime.
 */
export const fr: Record<string, string> = {
  // ── Navigation ──
  'About Us': 'À propos',
  Activities: 'Activités',
  'AI Trip Planner': 'Planificateur IA',
  Rent: 'Location',
  'Airport Transfer': 'Transfert aéroport',
  Taxi: 'Taxi',
  'Contact us': 'Contactez-nous',
  'Rent a car': 'Louer une voiture',
  'Rent a scooter': 'Louer un scooter',
  'Self-drive across the island': "Au volant à travers l'île",
  'Zip around the east coast': 'Filez le long de la côte est',

  // ── Header / preferences ──
  Language: 'Langue',
  Currency: 'Devise',
  'Language and currency': 'Langue et devise',
  Wishlist: 'Favoris',
  Cart: 'Panier',
  'Sign in': 'Se connecter',
  'Sign out': 'Se déconnecter',
  'My account': 'Mon compte',
  'My bookings': 'Mes réservations',
  Search: 'Rechercher',
  'Search tours & activities': 'Rechercher des excursions et activités',
  'Search places or activities': 'Rechercher des lieux ou activités',

  // ── Common ──
  'See all': 'Voir tout',
  'Book now': 'Réserver',
  Continue: 'Continuer',
  'Add to cart': 'Ajouter au panier',
  'From': 'À partir de',
  from: 'à partir de',
  'per person': 'par personne',
  'per vehicle': 'par véhicule',
  'per group': 'par groupe',
  'On request': 'Sur demande',
  'New activity': 'Nouvelle activité',
  'Top rated': 'Très bien noté',
  experience: 'expérience',
  experiences: 'expériences',
  'Free cancellation up to 24 hours before':
    "Annulation gratuite jusqu'à 24 heures avant",
  'Loading…': 'Chargement…',

  // ── Footer ──
  'Belle Mare Tours': 'Belle Mare Tours',
  'Book direct with the local operator': "Réservez en direct avec l'opérateur local",
  Company: 'Société',
  Support: 'Assistance',
  Legal: 'Mentions légales',
  'Terms & conditions': 'Conditions générales',
  'Privacy policy': 'Politique de confidentialité',
  'Refund policy': 'Politique de remboursement',
  'All rights reserved.': 'Tous droits réservés.',
};
