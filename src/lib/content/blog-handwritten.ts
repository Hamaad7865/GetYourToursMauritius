import type { PostContent, PostTranslation } from './blog';

/**
 * Blog posts written by hand, outside the SEO content workflow. `_blog.gen.ts` is regenerated
 * wholesale, so anything added there by hand would be lost on the next run; posts live here instead
 * and `blog.ts` merges them in. Each carries its own real publish date (generated posts get a
 * synthetic one from their index), so a new post leads the index and the sitemap's lastmod is true.
 *
 * Facts about our own tours (prices, times, menus) are copied from the live tour pages on the
 * publish date. When a tour's price or inclusions change, update the post too.
 */
export const HANDWRITTEN_POSTS: (PostContent & { datePublished: string })[] = [
  {
    slug: 'private-vs-shared-catamaran-mauritius',
    datePublished: '2026-10-09',
    title: 'Private vs Shared Catamaran in Mauritius: Which Should You Book?',
    metaTitle: 'Private vs Shared Catamaran in Mauritius: Which to Book?',
    metaDescription:
      'Private or shared catamaran in Mauritius? Compare price, group size, route and lunch on the Île aux Cerfs day out, and see which one suits your trip.',
    excerpt:
      'The same Île aux Cerfs catamaran day, two ways to book it. Here is how a shared cruise and a private charter really compare on price, pace and who they suit.',
    readMins: 6,
    heroImageUrl: '/blog/catamaran-cruises-mauritius.webp',
    sections: [
      {
        heading: 'The short answer',
        paragraphs: [
          'Book a **shared catamaran** if you are a couple or a small group watching your budget and you enjoy a lively deck. Book a **private catamaran** if you are celebrating, travelling with young children, or simply want the boat, the timing and the quiet spots to yourselves.',
          'On the east coast the choice is easier than it looks, because both trips run the same classic day out of Trou d’Eau Douce: the Grand River South East waterfall, snorkelling, a barbecue lunch and free time on Île aux Cerfs. What changes is who is on board with you, how flexible the day is, and how the price is split.',
          '**Shared:** from €55 per person, about 7 hours, 09:00 departure, you share the deck with other guests.',
          '**Private:** from €700 for the boat, up to 4 guests, about 7 hours, 09:00 departure, only your group on board.',
        ],
      },
      {
        heading: 'What is the same on both',
        paragraphs: [
          'Both cruises leave from the jetty at Trou d’Eau Douce, about ten minutes by road from the hotels at Belle Mare. You sail down the lagoon to the Grand River South East waterfall, where the river drops straight into the sea, then on to the reef for snorkelling and across to Île aux Cerfs for a swim and time on the beach.',
          'Lunch is the same generous barbecue on board: chicken, fish and sausages with salads and garlic bread, then a flambéed banana for dessert. Water, soft drinks, beer, wine and local rum are included. The food is halal, and vegetarian meals can be arranged if you ask in advance.',
          'On both trips the skipper may change the order of stops if the wind or the sea calls for it.',
        ],
      },
      {
        heading: 'What a shared catamaran is like',
        paragraphs: [
          'A shared cruise is a social day. You board with other travellers, swap snorkelling tips and stories over lunch, and share the deck for the trip across the lagoon. If you enjoy meeting people on holiday, that is part of the fun.',
          'It is the best value way to see the east coast lagoon. At [€55 per person](/activities/catamaran-cruise-ile-aux-cerfs) with lunch and drinks included, it is a full day out at a fixed price, and infants aged one to four travel free.',
          'The trade-off is that the boat keeps to a fixed timetable and stops where every shared boat stops, so Île aux Cerfs can feel busy at midday in high season. Bring your own snorkelling mask on the shared trip, as gear is not provided.',
        ],
      },
      {
        heading: 'What a private catamaran gets you',
        paragraphs: [
          'On a [private charter](/activities/private-full-day-catamaran-ile-aux-cerfs) the boat is yours. You can ask the skipper to linger at the waterfall, snorkel longer, or look for a quieter spot instead of the busiest part of the Île aux Cerfs beach, weather permitting.',
          'It is the natural choice for a honeymoon, a proposal or an anniversary, and it takes a lot of stress out of a day with small children: naps, snacks and swim breaks happen when your family needs them, not when the timetable says so.',
          'It also suits anyone who is not keen on crowds or loud music. A private boat is calm, and the day revolves around your group.',
        ],
      },
      {
        heading: 'The maths: when private is worth it',
        paragraphs: [
          'For a couple, shared wins clearly on price: €110 for the two of you against €700 for the boat.',
          'For a group of four, the shared cruise comes to €220 and the private charter to €700, or €175 each. You pay about three times as much for the whole boat, the flexible day and no other guests. For a once-in-a-trip occasion, many families and friends decide that is worth it.',
          'The private catamaran on Île aux Cerfs takes up to 4 guests. If your group is bigger, [message us](/contact) before booking and we will suggest the best option for your numbers.',
        ],
      },
      {
        heading: 'Other private boat days from the coast',
        paragraphs: [
          'Île aux Cerfs is not the only private trip we run. The [Private Cataspeed 5 Islands](/activities/catapseed-5-islands) covers more of the east coast islets in a faster boat. In the north, the [Private Full Day 3 Northern Islands Adventure](/activities/private-full-day-3-northern-islands-adventure) visits Gabriel Island and the Coin de Mire area, with a [shared version](/activities/catamaran-cruise-3-northern-island-adventure) too.',
          'For a shorter outing, the [Catamaran Sunset Cruise](/activities/catamaran-sunset-cruise) is an easy evening on the water. You can compare every boat trip on our [Mauritius catamaran cruise](/mauritius-catamaran-cruise) page, or read our route-by-route [catamaran cruise guide](/blog/catamaran-cruises-mauritius).',
        ],
      },
      {
        heading: 'Getting to Trou d’Eau Douce from Belle Mare and beyond',
        paragraphs: [
          'If you are staying in [Belle Mare](/belle-mare), the jetty is a ten-minute drive, and hotel pickup and drop-off can be added to either cruise at checkout. The price depends on your pickup area. From the north or west coast, allow an hour or more and add pickup so you are not driving back after a day in the sun.',
          'Arriving in Mauritius on the day before your cruise? Book your [airport transfer](/airport-transfers) to your east coast hotel and you are set for a 09:00 start. For more ideas on the area, see [things to do in Belle Mare](/things-to-do-in-belle-mare) and our [Île aux Cerfs guide](/blog/ile-aux-cerfs-guide).',
        ],
      },
    ],
    faq: [
      {
        q: 'How much is a private catamaran in Mauritius?',
        a: 'Our private full-day catamaran to Île aux Cerfs costs from €700 for the boat, for up to 4 guests, with a barbecue lunch, drinks and snorkelling included.',
      },
      {
        q: 'How much is a shared catamaran cruise to Île aux Cerfs?',
        a: 'The shared Île aux Cerfs catamaran cruise costs from €55 per person for about 7 hours, including the waterfall stop, snorkelling, a barbecue lunch and drinks. Infants aged 1 to 4 travel free.',
      },
      {
        q: 'Where do Île aux Cerfs catamarans leave from?',
        a: 'Both the shared and private cruises leave from Trou d’Eau Douce on the east coast at 09:00, about ten minutes from the Belle Mare hotels. Hotel pickup can be added at checkout.',
      },
      {
        q: 'Is lunch included on the catamaran?',
        a: 'Yes. Both trips include a barbecue lunch of chicken, fish and sausages with salads and garlic bread, a flambéed banana dessert, and water, soft drinks, beer, wine and local rum.',
      },
      {
        q: 'Can I cancel my catamaran booking?',
        a: 'Yes. You get a full refund if you cancel at least 24 hours before departure. Cancellations within 24 hours are not refundable.',
      },
    ],
  },
];

/** French overlays for the posts above, same shape and order rules as `_blog.fr.gen.ts`. */
export const HANDWRITTEN_POSTS_FR: Record<string, PostTranslation> = {
  'private-vs-shared-catamaran-mauritius': {
    title: 'Catamaran privé ou partagé à l’île Maurice : lequel réserver ?',
    excerpt:
      'La même journée en catamaran à l’île aux Cerfs, deux façons de la réserver. Voici comment une croisière partagée et une sortie privée se comparent vraiment : prix, rythme et pour qui.',
    sections: [
      {
        heading: 'La réponse courte',
        paragraphs: [
          'Choisissez un **catamaran partagé** si vous êtes en couple ou en petit groupe avec un budget à surveiller et que vous aimez l’ambiance animée à bord. Choisissez un **catamaran privé** si vous fêtez un moment important, voyagez avec de jeunes enfants ou voulez simplement le bateau, l’horaire et les coins tranquilles pour vous seuls.',
          'Sur la côte est, le choix est plus simple qu’il n’y paraît, car les deux sorties suivent la même journée classique au départ de Trou d’Eau Douce : la cascade de Grande Rivière Sud-Est, le snorkeling, un déjeuner barbecue et du temps libre à l’île aux Cerfs. Ce qui change, c’est qui est à bord avec vous, la souplesse de la journée et la façon dont le prix se répartit.',
          '**Partagé :** à partir de 55 € par personne, environ 7 heures, départ à 9 h, le pont est partagé avec d’autres passagers.',
          '**Privé :** à partir de 700 € le bateau, jusqu’à 4 personnes, environ 7 heures, départ à 9 h, seulement votre groupe à bord.',
        ],
      },
      {
        heading: 'Ce qui est identique dans les deux cas',
        paragraphs: [
          'Les deux croisières partent de la jetée de Trou d’Eau Douce, à une dizaine de minutes en voiture des hôtels de Belle Mare. Vous descendez le lagon jusqu’à la cascade de Grande Rivière Sud-Est, où la rivière se jette directement dans la mer, puis vous rejoignez le récif pour le snorkeling avant de traverser vers l’île aux Cerfs pour une baignade et du temps sur la plage.',
          'Le déjeuner est le même barbecue généreux à bord : poulet, poisson et saucisses avec salades et pain à l’ail, puis une banane flambée en dessert. L’eau, les boissons gazeuses, la bière, le vin et le rhum local sont compris. La nourriture est halal, et un repas végétarien peut être prévu si vous le demandez à l’avance.',
          'Dans les deux cas, le skipper peut modifier l’ordre des arrêts si le vent ou la mer l’exigent.',
        ],
      },
      {
        heading: 'À quoi ressemble un catamaran partagé',
        paragraphs: [
          'Une croisière partagée, c’est une journée conviviale. Vous embarquez avec d’autres voyageurs, échangez conseils de snorkeling et anecdotes autour du déjeuner, et partagez le pont pendant la traversée du lagon. Si vous aimez faire des rencontres en vacances, cela fait partie du plaisir.',
          'C’est la façon la plus économique de découvrir le lagon de la côte est. À [55 € par personne](/fr/activities/catamaran-cruise-ile-aux-cerfs), déjeuner et boissons compris, c’est une journée complète à prix fixe, et les enfants de 1 à 4 ans voyagent gratuitement.',
          'La contrepartie : le bateau suit un horaire fixe et s’arrête là où s’arrêtent tous les bateaux partagés, si bien que l’île aux Cerfs peut être animée vers midi en haute saison. Pensez à apporter votre masque de snorkeling pour la sortie partagée, l’équipement n’étant pas fourni.',
        ],
      },
      {
        heading: 'Ce qu’apporte un catamaran privé',
        paragraphs: [
          'Avec une [sortie privée](/fr/activities/private-full-day-catamaran-ile-aux-cerfs), le bateau est à vous. Vous pouvez demander au skipper de prolonger l’arrêt à la cascade, de rester plus longtemps au snorkeling ou de chercher un coin plus calme que la partie la plus fréquentée de la plage de l’île aux Cerfs, si la météo le permet.',
          'C’est le choix naturel pour une lune de miel, une demande en mariage ou un anniversaire, et c’est beaucoup plus serein avec de jeunes enfants : siestes, goûters et baignades se font au rythme de votre famille, pas selon l’horaire.',
          'Il convient aussi à ceux qui n’aiment ni la foule ni la musique forte. Un bateau privé est calme, et la journée s’organise autour de votre groupe.',
        ],
      },
      {
        heading: 'Le calcul : quand le privé vaut le coup',
        paragraphs: [
          'Pour un couple, le partagé l’emporte nettement sur le prix : 110 € à deux contre 700 € pour le bateau.',
          'Pour un groupe de quatre, la croisière partagée revient à 220 € et la sortie privée à 700 €, soit 175 € chacun. Vous payez environ trois fois plus pour avoir le bateau entier, une journée souple et aucun autre passager. Pour une occasion unique pendant le voyage, beaucoup de familles et d’amis estiment que cela en vaut la peine.',
          'Le catamaran privé pour l’île aux Cerfs accueille jusqu’à 4 personnes. Si votre groupe est plus grand, [écrivez-nous](/fr/contact) avant de réserver et nous vous proposerons la meilleure option selon votre nombre.',
        ],
      },
      {
        heading: 'D’autres sorties privées en bateau',
        paragraphs: [
          'L’île aux Cerfs n’est pas notre seule sortie privée. Le [Cataspeed privé 5 îles](/fr/activities/catapseed-5-islands) couvre davantage d’îlots de la côte est à bord d’un bateau plus rapide. Au nord, la [journée privée aux 3 îles du nord](/fr/activities/private-full-day-3-northern-islands-adventure) passe par l’île Gabriel et le secteur du Coin de Mire, avec aussi une [version partagée](/fr/activities/catamaran-cruise-3-northern-island-adventure).',
          'Pour une sortie plus courte, la [croisière en catamaran au coucher du soleil](/fr/activities/catamaran-sunset-cruise) est une soirée facile sur l’eau. Vous pouvez comparer toutes nos sorties en bateau sur la page [croisière en catamaran à l’île Maurice](/fr/mauritius-catamaran-cruise), ou lire notre [guide des croisières en catamaran](/fr/blog/catamaran-cruises-mauritius), itinéraire par itinéraire.',
        ],
      },
      {
        heading: 'Rejoindre Trou d’Eau Douce depuis Belle Mare et ailleurs',
        paragraphs: [
          'Si vous séjournez à [Belle Mare](/fr/belle-mare), la jetée est à dix minutes en voiture, et la prise en charge à l’hôtel peut être ajoutée aux deux croisières lors du paiement. Le prix dépend de votre zone de prise en charge. Depuis le nord ou l’ouest, comptez une heure ou plus et ajoutez la prise en charge pour ne pas reprendre le volant après une journée au soleil.',
          'Vous arrivez à l’île Maurice la veille de votre croisière ? Réservez votre [transfert aéroport](/fr/airport-transfers) vers votre hôtel de la côte est et vous serez prêt pour un départ à 9 h. Pour d’autres idées dans le secteur, consultez [que faire à Belle Mare](/fr/things-to-do-in-belle-mare) et notre [guide de l’île aux Cerfs](/fr/blog/ile-aux-cerfs-guide).',
        ],
      },
    ],
    faq: [
      {
        q: 'Combien coûte un catamaran privé à l’île Maurice ?',
        a: 'Notre catamaran privé pour une journée à l’île aux Cerfs coûte à partir de 700 € le bateau, jusqu’à 4 personnes, avec déjeuner barbecue, boissons et snorkeling compris.',
      },
      {
        q: 'Combien coûte une croisière partagée en catamaran à l’île aux Cerfs ?',
        a: 'La croisière partagée en catamaran à l’île aux Cerfs coûte à partir de 55 € par personne pour environ 7 heures, avec l’arrêt à la cascade, le snorkeling, un déjeuner barbecue et les boissons. Les enfants de 1 à 4 ans voyagent gratuitement.',
      },
      {
        q: 'D’où partent les catamarans pour l’île aux Cerfs ?',
        a: 'Les croisières partagées et privées partent de Trou d’Eau Douce, sur la côte est, à 9 h, à une dizaine de minutes des hôtels de Belle Mare. La prise en charge à l’hôtel peut être ajoutée lors du paiement.',
      },
      {
        q: 'Le déjeuner est-il compris à bord du catamaran ?',
        a: 'Oui. Les deux sorties comprennent un déjeuner barbecue avec poulet, poisson et saucisses, salades et pain à l’ail, une banane flambée en dessert, ainsi que l’eau, les boissons gazeuses, la bière, le vin et le rhum local.',
      },
      {
        q: 'Puis-je annuler ma réservation de catamaran ?',
        a: 'Oui. Le remboursement est intégral si vous annulez au moins 24 heures avant le départ. Les annulations dans les 24 heures ne sont pas remboursées.',
      },
    ],
  },
};
