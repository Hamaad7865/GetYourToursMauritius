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
export const HANDWRITTEN_POSTS: (PostContent & { datePublished: string; dateModified?: string })[] =
  [
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
    {
      // Was a generated post (synthetic date 2026-01-28, kept so its place in the index doesn't move).
      // Rewritten on 2026-10-17 for the December 2026 season: real dates, live tour prices, our own
      // weather and cancellation rules. Check the prices and the dates again before December 2027.
      slug: 'mauritius-in-december',
      datePublished: '2026-01-28',
      dateModified: '2026-10-17',
      title: 'Mauritius in December 2026: Weather, Festive Dates and What to Book',
      metaTitle: 'Mauritius in December 2026: Weather, Prices & What to Do',
      metaDescription:
        'Mauritius in December 2026: summer weather, cyclone advice, the festive dates that fill up, tour prices and when to book, from a local tour operator.',
      excerpt:
        'December is summer in Mauritius: hot days, a 27 °C sea and the busiest fortnight of the year. Here are the dates that matter in 2026, what the weather really does, and what to book before you fly.',
      readMins: 8,
      heroImageUrl: '/blog/mauritius-in-december.webp',
      sections: [
        {
          heading: 'December 2026 at a glance',
          paragraphs: [
            '**Weather:** summer. Coastal highs of 29 to 31 °C, nights around 23 °C, and the sea at 27 to 28 °C.',
            '**Daylight:** the longest days of the year. The sun rises around 05:30 and sets around 18:50.',
            '**Public holidays:** Christmas Day on Friday 25 December, then New Year on Friday 1 and Saturday 2 January 2027.',
            '**French school holidays:** Saturday 19 December 2026 to Monday 4 January 2027, the same dates for every zone.',
            '**Busiest stretch:** from about 19 December to the first weekend of January. The first half of December is calmer and cheaper.',
            '**Cyclone season:** November to April. A direct hit in December is uncommon, but plan one flexible day.',
          ],
        },
        {
          heading: 'What the weather really does in December',
          paragraphs: [
            'December is high summer. The days are hot and humid, the lagoons are as warm as they get all year, and you can snorkel for an hour without a wetsuit. Nights stay warm, so pack light clothes for evenings too.',
            'Rain comes as short, heavy showers rather than grey days. The central plateau around Curepipe gets the most of it. The west and north coasts, around Flic en Flac and Grand Baie, are the driest. On the east coast near Belle Mare, mornings are often clear and a shower may pass through in the afternoon, so we run boat trips early in the day.',
            'The sun is strong. With the sun almost overhead at midday, you burn fast even under cloud. Use reef-safe sunscreen, wear a rash vest or T-shirt for snorkelling, and drink more water than you think you need.',
          ],
        },
        {
          heading: 'Cyclones: what happens if one comes',
          paragraphs: [
            'Cyclone season runs from November to April, and January and February are the riskiest months. Most Decembers pass without a cyclone warning, but a tropical storm can bring a day or two of wind and rough sea.',
            'The Mauritius Meteorological Services issue warnings in four classes. When a warning is in force, boats stay in harbour. At Class III, offices, banks and most of the island close until the warning is lifted. Forecasts give several days of notice, so a storm never arrives as a surprise.',
            'If we cancel a trip because of the weather or the sea, you choose between a free new date and a full refund. Most of our trips can also be cancelled free of charge until the day before. The exact cut-off is on each tour page and on our [cancellations page](/refunds). Keep one flexible day in your plans and a lost boat day is easy to move.',
          ],
        },
        {
          heading: 'Christmas and New Year on the island',
          paragraphs: [
            'Christmas in Mauritius is warm and relaxed. Port Louis and the Caudan Waterfront put up lights, churches hold midnight mass on the 24th, and hotels stage gala dinners. On Christmas Day many Mauritian families head to the beach with a picnic, so public beaches are lively.',
            'New Year is the big night. On 31 December families camp on the public beaches, including Belle Mare, Mont Choisy and Flic en Flac, with barbecues, sega music and fireworks at midnight. Many restaurants and shops close or open short hours on 25 December and 1 January, so book dinners ahead.',
            'Hotels usually charge a compulsory gala-dinner supplement for the 24th and the 31st. Check your booking so it doesn’t surprise you at checkout.',
          ],
        },
        {
          heading: 'How busy it gets, and when to book',
          paragraphs: [
            'Two crowds meet in late December: visitors escaping the European winter, and Mauritian families on their long summer school holiday. From about 19 December the beaches, boats and roads are at their busiest of the year.',
            'Most of our guests book only a few days ahead, and in early December that works fine. For trips between 20 December and 3 January, book two to three weeks ahead, especially boat trips on weekends. Popular days fill first, and private boats go quickest.',
            'Booking early costs little. Most trips can be cancelled free of charge until the day before, so you can hold your favourite date and still change your plans.',
          ],
        },
        {
          heading: 'What to book in December, with prices',
          paragraphs: [
            'Warm, calm mornings make December a month for the water. These are our most-booked trips, with prices from our live booking pages in October 2026:',
            '**Île aux Cerfs by catamaran:** about 7 hours with the waterfall, snorkelling and a barbecue lunch on board, [from €55 per person](/activities/catamaran-cruise-ile-aux-cerfs). Prefer the boat to yourselves? Read [private vs shared catamaran](/blog/private-vs-shared-catamaran-mauritius).',
            '**The 5-island day on the east coast:** a speedboat from Trou d’Eau Douce to the waterfall, the coral gardens and five islands, with a barbecue lunch on Île aux Cerfs, [from €80 per person](/activities/the-blue-cruise-ile-aux-cerfs-5-islands-visit).',
            '**Swimming with dolphins:** an early-morning trip into Tamarin Bay on the calm west coast, [from €45 per person](/activities/swimming-with-dolphins). The full day with Crystal Rock and a barbecue lunch on Île aux Bénitiers is [from €60](/activities/swimming-with-dolphins-benitier-island-speedboat-all-inclusive).',
            '**The northern islands:** a catamaran day from Grand Baie to Île Plate and Île Gabriel, past Coin de Mire, [from €55 per person](/activities/catamaran-cruise-3-northern-island-adventure).',
            '**Sunset catamaran:** two hours sailing out of Grand Baie as the sun goes down, [from €65 per person](/activities/catamaran-sunset-cruise).',
            '**The seaplane over the underwater waterfall:** the view of Le Morne most people only see in photos, [from €205 per person](/activities/seaplane).',
            '**Sightseeing by private car:** the [south tour](/activities/south-tour-mauritius) to Chamarel, Black River Gorges and Grand Bassin, or the [north tour](/activities/north-tour) to Port Louis and Pamplemousses, each from €90 for the car with a driver. On a showery day, go inland in the morning and keep the afternoon for the coast.',
          ],
        },
        {
          heading: 'Arriving in December',
          paragraphs: [
            'The airport is in the south-east, near Mahébourg. Belle Mare is about 50 minutes away by road and Grand Baie about 75. In late December many flights land at once and the taxi queue can be long, so a driver who meets you in arrivals takes the stress out of a holiday landing.',
            'Our [airport transfers](/airport-transfers) start from €40 per car, at a fixed price agreed when you book. Traffic around Port Louis, Grand Baie and the busy beaches is at its heaviest over the festive fortnight, so allow extra time on departure day.',
          ],
        },
        {
          heading: 'Packing and practical tips',
          paragraphs: [
            'Pack light, breathable clothes, a hat, reef-safe sunscreen and a light rain jacket for the plateau. Bring water shoes if you plan to explore the reef, and a dry bag for boat days.',
            'Plan boat trips for the first half of your stay. If the weather moves one, you still have days left to rebook. Save the sightseeing for days with showers in the forecast.',
            'Want help planning your days? Message us on WhatsApp with your dates and where you’re staying, and we’ll suggest a plan that works with the weather and the festive dates.',
          ],
        },
      ],
      faq: [
        {
          q: 'Is December a good time to visit Mauritius?',
          a: 'Yes, if you want hot weather and a warm sea for swimming and snorkelling. Expect short tropical showers, higher hotel prices and busy beaches from about 19 December to early January. The first half of December is calmer and cheaper.',
        },
        {
          q: 'What is the weather like in Mauritius in December?',
          a: 'It is summer: coastal highs of 29 to 31 °C, warm nights around 23 °C and a sea of 27 to 28 °C. Rain falls as short, heavy showers, most often over the central plateau. The west and north coasts are the driest.',
        },
        {
          q: 'Is December cyclone season in Mauritius?',
          a: 'Cyclone season runs from November to April, with the highest risk in January and February. A cyclone in December is uncommon. If we cancel a trip because of the weather, you can choose a free new date or a full refund.',
        },
        {
          q: 'When are the Christmas holidays in 2026?',
          a: 'Christmas Day is Friday 25 December 2026 and New Year falls on Friday 1 and Saturday 2 January 2027, all public holidays in Mauritius. French school holidays run from Saturday 19 December 2026 to Monday 4 January 2027.',
        },
        {
          q: 'Should I book tours in advance for December?',
          a: 'For trips between 20 December and 3 January, book two to three weeks ahead, especially boat trips and private boats. Earlier in December a few days ahead is usually enough. Most trips can be cancelled free of charge until the day before.',
        },
      ],
    },
    {
      // Written 2026-10-17 for "mauritius november weather" (~2,400 searches a month in the UK) and
      // "île Maurice en novembre" / "météo île Maurice novembre" (~1,000 in France), which had no page.
      // Prices are from the live tour pages on that date. Check the dates again before November 2027.
      slug: 'mauritius-in-november',
      datePublished: '2026-10-17',
      title: 'Mauritius in November 2026: Weather, Sea and What to Book',
      metaTitle: 'Mauritius in November 2026: Weather, Prices & What to Do',
      metaDescription:
        'Mauritius in November 2026: early-summer weather, sea temperature, rain, festivals and tour prices, with what to book, from a local tour operator.',
      excerpt:
        'November is the start of summer in Mauritius: dry, sunny days, a warming sea and calm lagoons, before the December crowds. Here is what the weather does, what is on, and what to book.',
      readMins: 7,
      heroImageUrl: '/blog/best-time-to-visit-mauritius.webp',
      sections: [
        {
          heading: 'November 2026 at a glance',
          paragraphs: [
            '**Weather:** early summer. Coastal highs of 27 to 29 °C, nights around 20 to 21 °C, and the sea at about 25 to 26 °C, getting warmer through the month.',
            '**Rain:** one of the drier months of the year. Showers are short and fall mostly inland.',
            '**Daylight:** long, sunny days. The sun rises around 05:30 and sets around 18:30.',
            '**Public holidays:** the Arrival of Indentured Labourers on Monday 2 November, and Divali, the festival of lights, expected on Sunday 8 November.',
            '**Crowds:** quieter than December. The holiday rush starts around 19 December, so most of November is calm.',
            '**Cyclone season:** it opens in November, but a cyclone this early is rare.',
          ],
        },
        {
          heading: 'What the weather is like in November',
          paragraphs: [
            'November is the turn from winter to summer, and for many visitors it is the best month of the year. The days are warm and sunny without the heavy humidity of January, the evenings are pleasant, and rain is light compared with the summer months that follow.',
            'The winter trade winds ease off in November. The east coast near Belle Mare still gets a fresh breeze, which keeps the heat comfortable, while the west and north coasts are often flat calm. That makes it a good month for boat trips on every side of the island.',
            'The sea warms up week by week. Early in the month it is cool enough that some swimmers like a shortie wetsuit for a long snorkel; by the end of November it is pleasant for everyone. Underwater visibility is usually good.',
            'The sun is strong already. Use reef-safe sunscreen, wear a hat at midday, and cover up for long boat days.',
          ],
        },
        {
          heading: 'Is November a good time to visit Mauritius?',
          paragraphs: [
            'Yes. November combines summer weather with shoulder-season calm. Flights and hotels are usually cheaper than over Christmas, beaches are quieter, and you can book most trips only a few days ahead.',
            'The trade-off is small. The odd afternoon shower passes through, especially over the central plateau, and the first cyclone of the season can appear late in the month in some years. Keep one flexible day in your plans and you lose nothing.',
            'If we cancel a trip because of the weather or the sea, you choose between a free new date and a full refund. Most of our trips can also be cancelled free of charge until the day before. The exact cut-off is on each tour page.',
          ],
        },
        {
          heading: 'Festivals and holidays in November',
          paragraphs: [
            '**Arrival of Indentured Labourers, 2 November:** a public holiday marking the arrival of the first indentured workers from India in 1834. Ceremonies are held at the Aapravasi Ghat in Port Louis, a UNESCO World Heritage Site.',
            '**Divali:** the Hindu festival of lights, expected on Sunday 8 November in 2026. Homes and streets glow with clay lamps and fairy lights, and families share sweets with neighbours. Drive through a village in the evening and you will see it everywhere.',
            'Banks and offices close on public holidays, but boat trips, tours and transfers usually run as normal.',
          ],
        },
        {
          heading: 'What to book in November, with prices',
          paragraphs: [
            'Calm seas and dry days make November good for both the water and the hills. These are the trips we recommend this month, with prices from our live booking pages in October 2026:',
            '**Île aux Cerfs by catamaran:** about 7 hours with the waterfall, snorkelling and a barbecue lunch on board, [from €55 per person](/activities/catamaran-cruise-ile-aux-cerfs).',
            '**Swimming with dolphins:** an early-morning trip into Tamarin Bay on the calm west coast, [from €45 per person](/activities/swimming-with-dolphins).',
            '**The 5-island day on the east coast:** a speedboat from Trou d’Eau Douce to the waterfall, the coral gardens and five islands, with a barbecue lunch on Île aux Cerfs, [from €80 per person](/activities/the-blue-cruise-ile-aux-cerfs-5-islands-visit).',
            '**The seaplane over the underwater waterfall:** clear November skies give the best view of the illusion off Le Morne, [from €205 per person](/activities/seaplane).',
            '**Hiking before the heat:** November mornings are still cool enough for [Le Morne](/activities/hiking-le-morne) or [Tamarind Falls](/activities/hiking-at-the-tamarind-falls-7-cascade), each from €50 per person with a guide. By January the climbs get hot and the trails muddy.',
            '**Sightseeing by private car:** the [south tour](/activities/south-tour-mauritius) to Chamarel, Black River Gorges and Grand Bassin, from €90 for the car with a driver.',
          ],
        },
        {
          heading: 'Arriving in November',
          paragraphs: [
            'The airport is in the south-east, near Mahébourg. Belle Mare is about 50 minutes away by road and Grand Baie about 75. Our [airport transfers](/airport-transfers) start from €40 per car, at a fixed price agreed when you book.',
            'Travelling later, over Christmas or New Year? Read our guide to [Mauritius in December](/blog/mauritius-in-december) for the festive dates and when to book.',
          ],
        },
        {
          heading: 'Packing and practical tips',
          paragraphs: [
            'Pack light summer clothes, a light jumper for breezy evenings on the east coast, a hat, reef-safe sunscreen and water shoes for the reef. A light rain jacket is enough for the plateau.',
            'Book the trips you care about most for the first half of your stay. If the weather moves one, you still have days to rebook. In November a few days ahead is usually enough.',
            'Want help planning your days? Message us on WhatsApp with your dates and where you’re staying, and we’ll suggest a plan for the weather that week.',
          ],
        },
      ],
      faq: [
        {
          q: 'Is November a good time to visit Mauritius?',
          a: 'Yes. November brings warm, sunny, mostly dry weather at the start of summer, with calmer lagoons than in winter and fewer visitors than in December. Flights and hotels are usually cheaper than over Christmas.',
        },
        {
          q: 'What is the weather like in Mauritius in November?',
          a: 'Expect coastal highs of 27 to 29 °C, nights around 20 to 21 °C and a sea of about 25 to 26 °C that warms through the month. It is one of the drier months, with short showers mostly over the central plateau.',
        },
        {
          q: 'Is it cyclone season in Mauritius in November?',
          a: 'Cyclone season officially opens in November and runs to April, but a cyclone in November is rare; the highest risk is in January and February. If we cancel a trip because of the weather, you can choose a free new date or a full refund.',
        },
        {
          q: 'Is the sea warm enough to swim in November?',
          a: 'Yes. The sea is about 25 to 26 °C and warms through the month. Some people like a shortie wetsuit for a long snorkel early in November; by the end of the month most swim without one.',
        },
        {
          q: 'Do I need to book tours in advance in November?',
          a: 'Usually a few days ahead is enough in November, because it is quieter than December. Book earlier for private boats, the seaplane and anything in the last week of the month. Most trips can be cancelled free of charge until the day before.',
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
  'mauritius-in-december': {
    title: 'L’île Maurice en décembre 2026 : météo, dates des fêtes et que réserver',
    excerpt:
      'En décembre, c’est l’été à Maurice : journées chaudes, mer à 27 °C et la quinzaine la plus chargée de l’année. Voici les dates qui comptent en 2026, ce que fait vraiment la météo et ce qu’il faut réserver avant de partir.',
    sections: [
      {
        heading: 'Décembre 2026 en un coup d’œil',
        paragraphs: [
          '**Météo :** l’été. Maximales de 29 à 31 °C sur la côte, nuits autour de 23 °C, mer à 27–28 °C.',
          '**Ensoleillement :** les jours les plus longs de l’année. Le soleil se lève vers 5 h 30 et se couche vers 18 h 50.',
          '**Jours fériés :** Noël le vendredi 25 décembre, puis le Nouvel An le vendredi 1er et le samedi 2 janvier 2027.',
          '**Vacances scolaires en France :** du samedi 19 décembre 2026 au lundi 4 janvier 2027, mêmes dates pour toutes les zones.',
          '**Période la plus chargée :** du 19 décembre environ au premier week-end de janvier. La première quinzaine de décembre est plus calme et moins chère.',
          '**Saison cyclonique :** de novembre à avril. Un cyclone en décembre est rare, mais gardez une journée de souplesse.',
        ],
      },
      {
        heading: 'Ce que fait vraiment la météo en décembre',
        paragraphs: [
          'Décembre, c’est le plein été. Les journées sont chaudes et humides, les lagons atteignent leur température la plus haute de l’année, et l’on peut faire une heure de snorkeling sans combinaison. Les nuits restent chaudes : prévoyez aussi des vêtements légers pour le soir.',
          'La pluie tombe en averses courtes et fortes plutôt qu’en journées grises. C’est le plateau central, autour de Curepipe, qui en reçoit le plus. Les côtes ouest et nord, autour de Flic en Flac et Grand Baie, sont les plus sèches. Sur la côte est, près de Belle Mare, les matinées sont souvent dégagées et une averse peut passer l’après-midi : c’est pour cela que nos sorties en mer partent tôt.',
          'Le soleil tape fort. À midi il est presque à la verticale, et l’on brûle vite même sous les nuages. Utilisez une crème solaire respectueuse des coraux, portez un lycra ou un t-shirt pour le snorkeling, et buvez plus d’eau que vous ne le pensez.',
        ],
      },
      {
        heading: 'Cyclones : ce qui se passe si l’un d’eux arrive',
        paragraphs: [
          'La saison cyclonique va de novembre à avril, et janvier et février sont les mois les plus exposés. La plupart des mois de décembre se passent sans avis de cyclone, mais une tempête tropicale peut apporter un ou deux jours de vent et de mer agitée.',
          'Les services météorologiques de Maurice émettent des avis en quatre classes. Tant qu’un avis est en vigueur, les bateaux restent au port. En classe III, les bureaux, les banques et la plupart de l’île ferment jusqu’à la levée de l’avis. Les prévisions annoncent un cyclone plusieurs jours à l’avance : il n’arrive jamais par surprise.',
          'Si nous annulons une sortie à cause de la météo ou de l’état de la mer, vous choisissez entre une nouvelle date sans frais et un remboursement intégral. La plupart de nos sorties s’annulent aussi gratuitement jusqu’à la veille. Le délai exact figure sur chaque page d’excursion. Gardez une journée libre dans votre programme : une sortie en mer reportée se replace alors facilement.',
        ],
      },
      {
        heading: 'Noël et le Nouvel An sur l’île',
        paragraphs: [
          'Noël à Maurice est chaud et détendu. Port-Louis et le Caudan Waterfront s’illuminent, les églises célèbrent la messe de minuit le 24 et les hôtels organisent des dîners de gala. Le jour de Noël, beaucoup de familles mauriciennes vont pique-niquer à la plage : les plages publiques sont animées.',
          'Le Nouvel An est la grande soirée. Le 31 décembre, les familles campent sur les plages publiques, dont Belle Mare, Mont Choisy et Flic en Flac, avec barbecues, séga et feux d’artifice à minuit. Beaucoup de restaurants et de commerces ferment ou réduisent leurs horaires le 25 décembre et le 1er janvier : réservez vos dîners à l’avance.',
          'Les hôtels facturent souvent un supplément obligatoire pour les dîners de gala du 24 et du 31. Vérifiez votre réservation pour ne pas avoir de surprise au départ.',
        ],
      },
      {
        heading: 'L’affluence, et quand réserver',
        paragraphs: [
          'Fin décembre, deux publics se croisent : les visiteurs qui fuient l’hiver européen et les familles mauriciennes en pleines grandes vacances scolaires d’été. À partir du 19 décembre environ, plages, bateaux et routes connaissent leur plus forte affluence de l’année.',
          'La plupart de nos clients réservent quelques jours avant, et début décembre cela suffit. Pour les sorties entre le 20 décembre et le 3 janvier, réservez deux à trois semaines à l’avance, surtout les sorties en mer le week-end. Les jours les plus demandés partent en premier, et les bateaux privés encore plus vite.',
          'Réserver tôt ne coûte pas grand-chose. La plupart des sorties s’annulent gratuitement jusqu’à la veille : vous bloquez votre date préférée tout en gardant la liberté de changer d’avis.',
        ],
      },
      {
        heading: 'Que réserver en décembre, avec les prix',
        paragraphs: [
          'Les matinées chaudes et calmes font de décembre un mois pour la mer. Voici nos sorties les plus réservées, aux prix affichés sur nos pages de réservation en octobre 2026 :',
          '**L’île aux Cerfs en catamaran :** environ 7 heures avec la cascade, le snorkeling et un déjeuner barbecue à bord, [à partir de 55 € par personne](/fr/activities/catamaran-cruise-ile-aux-cerfs). Vous préférez le bateau pour vous seuls ? Lisez [catamaran privé ou partagé](/fr/blog/private-vs-shared-catamaran-mauritius).',
          '**La journée des 5 îles sur la côte est :** en bateau rapide depuis Trou d’Eau Douce, la cascade, les jardins de corail et cinq îles, avec un déjeuner barbecue à l’île aux Cerfs, [à partir de 80 € par personne](/fr/activities/the-blue-cruise-ile-aux-cerfs-5-islands-visit).',
          '**Nager avec les dauphins :** une sortie tôt le matin dans la baie de Tamarin, sur la côte ouest abritée, [à partir de 45 € par personne](/fr/activities/swimming-with-dolphins). La journée complète avec Crystal Rock et un déjeuner barbecue à l’île aux Bénitiers est [à partir de 60 €](/fr/activities/swimming-with-dolphins-benitier-island-speedboat-all-inclusive).',
          '**Les îles du nord :** une journée en catamaran depuis Grand Baie vers l’île Plate et l’îlot Gabriel, en passant par le Coin de Mire, [à partir de 55 € par personne](/fr/activities/catamaran-cruise-3-northern-island-adventure).',
          '**Catamaran au coucher du soleil :** deux heures de navigation au départ de Grand Baie à l’heure où le soleil se couche, [à partir de 65 € par personne](/fr/activities/catamaran-sunset-cruise).',
          '**L’hydravion au-dessus de la cascade sous-marine :** la vue sur Le Morne que la plupart des gens ne connaissent qu’en photo, [à partir de 205 € par personne](/fr/activities/seaplane).',
          '**Visites en voiture privée :** le [circuit sud](/fr/activities/south-tour-mauritius) vers Chamarel, les gorges de Rivière Noire et Grand Bassin, ou le [circuit nord](/fr/activities/north-tour) vers Port-Louis et Pamplemousses, chacun à partir de 90 € la voiture avec chauffeur. Un jour d’averses, partez dans les terres le matin et gardez l’après-midi pour la côte.',
        ],
      },
      {
        heading: 'Arriver en décembre',
        paragraphs: [
          'L’aéroport se trouve dans le sud-est, près de Mahébourg. Belle Mare est à environ 50 minutes de route et Grand Baie à environ 75. Fin décembre, beaucoup de vols atterrissent en même temps et la file des taxis peut être longue : un chauffeur qui vous attend à l’arrivée enlève le stress d’un atterrissage en pleines fêtes.',
          'Nos [transferts aéroport](/fr/airport-transfers) commencent à 40 € par voiture, à un prix fixe convenu à la réservation. La circulation autour de Port-Louis, de Grand Baie et des plages les plus fréquentées est à son maximum pendant la quinzaine des fêtes : prévoyez de la marge le jour du départ.',
        ],
      },
      {
        heading: 'Bagages et conseils pratiques',
        paragraphs: [
          'Prévoyez des vêtements légers et respirants, un chapeau, une crème solaire respectueuse des coraux et une veste de pluie légère pour le plateau. Emportez des chaussures d’eau si vous comptez explorer le récif, et un sac étanche pour les sorties en mer.',
          'Placez les sorties en mer dans la première moitié de votre séjour. Si la météo en décale une, il vous reste des jours pour la reporter. Gardez les visites pour les jours où des averses sont annoncées.',
          'Envie d’un coup de main pour organiser vos journées ? Écrivez-nous sur WhatsApp avec vos dates et votre lieu de séjour, et nous vous proposerons un programme adapté à la météo et aux dates des fêtes.',
        ],
      },
    ],
    faq: [
      {
        q: 'Décembre est-il une bonne période pour aller à l’île Maurice ?',
        a: 'Oui, si vous cherchez la chaleur et une mer chaude pour la baignade et le snorkeling. Attendez-vous à de courtes averses tropicales, à des hôtels plus chers et à des plages animées du 19 décembre environ jusqu’à début janvier. La première quinzaine de décembre est plus calme et moins chère.',
      },
      {
        q: 'Quel temps fait-il à l’île Maurice en décembre ?',
        a: 'C’est l’été : maximales de 29 à 31 °C sur la côte, nuits chaudes autour de 23 °C et mer à 27–28 °C. La pluie tombe en averses courtes et fortes, surtout sur le plateau central. Les côtes ouest et nord sont les plus sèches.',
      },
      {
        q: 'Décembre est-il en saison cyclonique à Maurice ?',
        a: 'La saison cyclonique va de novembre à avril, avec le risque le plus élevé en janvier et février. Un cyclone en décembre est rare. Si nous annulons une sortie à cause de la météo, vous choisissez une nouvelle date sans frais ou un remboursement intégral.',
      },
      {
        q: 'Quelles sont les dates des fêtes en 2026 ?',
        a: 'Noël tombe le vendredi 25 décembre 2026 et le Nouvel An le vendredi 1er et le samedi 2 janvier 2027, tous jours fériés à Maurice. Les vacances scolaires françaises vont du samedi 19 décembre 2026 au lundi 4 janvier 2027.',
      },
      {
        q: 'Faut-il réserver ses excursions à l’avance en décembre ?',
        a: 'Pour les sorties entre le 20 décembre et le 3 janvier, réservez deux à trois semaines à l’avance, surtout les sorties en mer et les bateaux privés. Plus tôt dans le mois, quelques jours suffisent en général. La plupart des sorties s’annulent gratuitement jusqu’à la veille.',
      },
    ],
  },
  'mauritius-in-november': {
    title: 'L’île Maurice en novembre 2026 : météo, mer et que réserver',
    excerpt:
      'En novembre commence l’été à Maurice : journées sèches et ensoleillées, mer qui se réchauffe et lagons calmes, avant l’affluence de décembre. Voici la météo, ce qui se passe sur l’île et ce qu’il faut réserver.',
    sections: [
      {
        heading: 'Novembre 2026 en un coup d’œil',
        paragraphs: [
          '**Météo :** début de l’été. Maximales de 27 à 29 °C sur la côte, nuits autour de 20–21 °C, mer à 25–26 °C environ, de plus en plus chaude au fil du mois.',
          '**Pluie :** l’un des mois les plus secs de l’année. Les averses sont courtes et tombent surtout dans les terres.',
          '**Ensoleillement :** de longues journées de soleil. Le soleil se lève vers 5 h 30 et se couche vers 18 h 30.',
          '**Jours fériés :** l’Arrivée des travailleurs engagés le lundi 2 novembre, et Divali, la fête des lumières, attendue le dimanche 8 novembre.',
          '**Affluence :** plus calme qu’en décembre. Le rush des fêtes commence vers le 19 décembre : la majeure partie de novembre reste tranquille.',
          '**Saison cyclonique :** elle s’ouvre en novembre, mais un cyclone aussi tôt est rare.',
        ],
      },
      {
        heading: 'Quel temps fait-il en novembre ?',
        paragraphs: [
          'Novembre marque le passage de l’hiver à l’été, et pour beaucoup de voyageurs c’est le meilleur mois de l’année. Les journées sont chaudes et ensoleillées sans la lourde humidité de janvier, les soirées sont agréables, et la pluie reste faible par rapport aux mois d’été qui suivent.',
          'Les alizés de l’hiver faiblissent en novembre. La côte est, près de Belle Mare, garde une brise fraîche qui rend la chaleur agréable, tandis que les côtes ouest et nord sont souvent d’huile. C’est donc un bon mois pour les sorties en mer, de tous les côtés de l’île.',
          'La mer se réchauffe de semaine en semaine. En début de mois, certains apprécient un shorty pour un long snorkeling ; à la fin de novembre, elle est agréable pour tout le monde. La visibilité sous l’eau est en général bonne.',
          'Le soleil tape déjà fort. Utilisez une crème solaire respectueuse des coraux, portez un chapeau à midi et couvrez-vous pour les longues journées en bateau.',
        ],
      },
      {
        heading: 'Novembre est-il une bonne période pour partir à l’île Maurice ?',
        paragraphs: [
          'Oui. Novembre réunit la météo de l’été et le calme de l’intersaison. Les vols et les hôtels sont en général moins chers qu’à Noël, les plages plus tranquilles, et la plupart des sorties se réservent quelques jours avant.',
          'La contrepartie est faible. Une averse passe parfois l’après-midi, surtout sur le plateau central, et certaines années le premier cyclone de la saison apparaît en fin de mois. Gardez une journée de souplesse dans votre programme et vous ne perdez rien.',
          'Si nous annulons une sortie à cause de la météo ou de l’état de la mer, vous choisissez entre une nouvelle date sans frais et un remboursement intégral. La plupart de nos sorties s’annulent aussi gratuitement jusqu’à la veille. Le délai exact figure sur chaque page d’excursion.',
        ],
      },
      {
        heading: 'Fêtes et jours fériés en novembre',
        paragraphs: [
          '**Arrivée des travailleurs engagés, 2 novembre :** un jour férié qui commémore l’arrivée des premiers travailleurs engagés venus d’Inde en 1834. Des cérémonies ont lieu à l’Aapravasi Ghat, à Port-Louis, inscrit au patrimoine mondial de l’UNESCO.',
          '**Divali :** la fête hindoue des lumières, attendue le dimanche 8 novembre en 2026. Maisons et rues s’illuminent de lampes en terre cuite et de guirlandes, et les familles partagent des gâteaux avec leurs voisins. Traversez un village le soir et vous la verrez partout.',
          'Les banques et les bureaux ferment les jours fériés, mais les sorties en mer, les excursions et les transferts fonctionnent en général normalement.',
        ],
      },
      {
        heading: 'Que réserver en novembre, avec les prix',
        paragraphs: [
          'Mer calme et journées sèches : novembre convient aussi bien à la mer qu’aux sentiers. Voici les sorties que nous recommandons ce mois-ci, aux prix affichés sur nos pages de réservation en octobre 2026 :',
          '**L’île aux Cerfs en catamaran :** environ 7 heures avec la cascade, le snorkeling et un déjeuner barbecue à bord, [à partir de 55 € par personne](/fr/activities/catamaran-cruise-ile-aux-cerfs).',
          '**Nager avec les dauphins :** une sortie tôt le matin dans la baie de Tamarin, sur la côte ouest abritée, [à partir de 45 € par personne](/fr/activities/swimming-with-dolphins).',
          '**La journée des 5 îles sur la côte est :** en bateau rapide depuis Trou d’Eau Douce, la cascade, les jardins de corail et cinq îles, avec un déjeuner barbecue à l’île aux Cerfs, [à partir de 80 € par personne](/fr/activities/the-blue-cruise-ile-aux-cerfs-5-islands-visit).',
          '**L’hydravion au-dessus de la cascade sous-marine :** le ciel dégagé de novembre offre la meilleure vue sur l’illusion au large du Morne, [à partir de 205 € par personne](/fr/activities/seaplane).',
          '**Randonner avant la chaleur :** les matinées de novembre sont encore assez fraîches pour [le Morne](/fr/activities/hiking-le-morne) ou [les Tamarind Falls](/fr/activities/hiking-at-the-tamarind-falls-7-cascade), chacune à partir de 50 € par personne avec un guide. En janvier, les montées deviennent chaudes et les sentiers boueux.',
          '**Visites en voiture privée :** le [circuit sud](/fr/activities/south-tour-mauritius) vers Chamarel, les gorges de Rivière Noire et Grand Bassin, à partir de 90 € la voiture avec chauffeur.',
        ],
      },
      {
        heading: 'Arriver en novembre',
        paragraphs: [
          'L’aéroport se trouve dans le sud-est, près de Mahébourg. Belle Mare est à environ 50 minutes de route et Grand Baie à environ 75. Nos [transferts aéroport](/fr/airport-transfers) commencent à 40 € par voiture, à un prix fixe convenu à la réservation.',
          'Vous partez plus tard, pour Noël ou le Nouvel An ? Lisez notre guide de [l’île Maurice en décembre](/fr/blog/mauritius-in-december) pour les dates des fêtes et le bon moment pour réserver.',
        ],
      },
      {
        heading: 'Bagages et conseils pratiques',
        paragraphs: [
          'Prévoyez des vêtements d’été légers, un pull léger pour les soirées venteuses de la côte est, un chapeau, une crème solaire respectueuse des coraux et des chaussures d’eau pour le récif. Une veste de pluie légère suffit pour le plateau.',
          'Placez les sorties qui vous tiennent le plus à cœur dans la première moitié du séjour. Si la météo en décale une, il vous reste des jours pour la reporter. En novembre, réserver quelques jours avant suffit en général.',
          'Envie d’un coup de main pour organiser vos journées ? Écrivez-nous sur WhatsApp avec vos dates et votre lieu de séjour, et nous vous proposerons un programme adapté à la météo de la semaine.',
        ],
      },
    ],
    faq: [
      {
        q: 'Novembre est-il une bonne période pour aller à l’île Maurice ?',
        a: 'Oui. Novembre apporte une météo chaude, ensoleillée et plutôt sèche en début d’été, avec des lagons plus calmes qu’en hiver et moins de monde qu’en décembre. Les vols et les hôtels sont en général moins chers qu’à Noël.',
      },
      {
        q: 'Quel temps fait-il à l’île Maurice en novembre ?',
        a: 'Comptez 27 à 29 °C en journée sur la côte, des nuits autour de 20–21 °C et une mer à 25–26 °C environ qui se réchauffe au fil du mois. C’est l’un des mois les plus secs, avec de courtes averses surtout sur le plateau central.',
      },
      {
        q: 'Novembre est-il en saison cyclonique à Maurice ?',
        a: 'La saison cyclonique s’ouvre officiellement en novembre et dure jusqu’en avril, mais un cyclone en novembre est rare ; le risque le plus élevé se situe en janvier et février. Si nous annulons une sortie à cause de la météo, vous choisissez une nouvelle date sans frais ou un remboursement intégral.',
      },
      {
        q: 'La mer est-elle assez chaude pour se baigner en novembre ?',
        a: 'Oui. La mer est à 25–26 °C environ et se réchauffe au fil du mois. Certains apprécient un shorty pour un long snorkeling début novembre ; à la fin du mois, la plupart se baignent sans.',
      },
      {
        q: 'Faut-il réserver ses excursions à l’avance en novembre ?',
        a: 'En novembre, quelques jours avant suffisent en général, car c’est plus calme qu’en décembre. Réservez plus tôt pour les bateaux privés, l’hydravion et toute sortie la dernière semaine du mois. La plupart des sorties s’annulent gratuitement jusqu’à la veille.',
      },
    ],
  },
};
