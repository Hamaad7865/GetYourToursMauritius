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
            '**Private:** from €850 for the boat, up to 4 guests, about 7 hours, 09:00 departure, only your group on board.',
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
            'For a couple, shared wins clearly on price: €110 for the two of you against €850 for the boat.',
            'For a group of four, the shared cruise comes to €220 and the private charter to €850, or €212.50 each. You pay nearly four times as much for the whole boat, the flexible day and no other guests. For a once-in-a-trip occasion, many families and friends decide that is worth it.',
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
          a: 'Our private full-day catamaran to Île aux Cerfs costs from €850 for the boat, for up to 4 guests, with a barbecue lunch, drinks and snorkelling included.',
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
            'Christmas Day, Friday 25 December, and New Year on 1 and 2 January are public holidays. Christmas is a warm family day with beach picnics, and New Year’s Eve is the loudest night of the year, with families on the public beaches and fireworks everywhere at midnight.',
            'Hotels usually charge a compulsory gala-dinner supplement for the 24th and the 31st, and many shops and restaurants close or open short hours on 25 December and 1 January. Our guide to [Christmas and New Year in Mauritius](/blog/christmas-and-new-year-in-mauritius) covers each festive day, where to see the fireworks and what is open.',
          ],
        },
        {
          heading: 'How busy it gets, and when to book',
          paragraphs: [
            'Two crowds meet in late December: visitors escaping the European winter, and Mauritian families on their end-of-year holidays. From about 19 December the beaches, boats and roads are at their busiest of the year.',
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
            '**Swimming with dolphins:** an early-morning trip into Tamarin Bay on the calm west coast, [from €45 per person](/activities/swimming-with-dolphins). The full day with Crystal Rock and a barbecue lunch on Île aux Bénitiers is [from €75](/activities/swimming-with-dolphins-benitier-island-speedboat-all-inclusive).',
            '**The northern islands:** a catamaran day from Grand Baie to Île Plate and Île Gabriel, past Coin de Mire, [from €65 per person](/activities/catamaran-cruise-3-northern-island-adventure).',
            '**Sunset catamaran:** two hours sailing out of Grand Baie as the sun goes down, [from €65 per person](/activities/catamaran-sunset-cruise).',
            '**The seaplane over the underwater waterfall:** the view of Le Morne most people only see in photos, [from €205 per person](/activities/seaplane).',
            '**Sightseeing by private car:** the [south tour](/activities/south-tour-mauritius) to Chamarel, Black River Gorges and Grand Bassin, or the [north tour](/activities/north-tour) to Port Louis and Pamplemousses, each from €90 for the car with a driver. On a showery day, go inland in the morning and keep the afternoon for the coast.',
          ],
        },
        {
          heading: 'Arriving in December',
          paragraphs: [
            'The airport is in the south-east, near Mahébourg. Belle Mare is about 50 minutes away by road and Grand Baie about 75. In late December many flights land at once and the taxi queue can be long, so a driver who meets you in arrivals takes the stress out of a holiday landing.',
            'Our [airport transfers](/airport-transfers) start from €40 per car, at a fixed price agreed when you book. Traffic around Port Louis, Grand Baie and the busy beaches is at its heaviest over the festive fortnight, so allow extra time on departure day. Staying into the new year? Read [Mauritius in January](/blog/mauritius-in-january).',
          ],
        },
        {
          heading: 'Packing and practical tips',
          paragraphs: [
            'Pack light, breathable clothes, a hat, reef-safe sunscreen and a light rain jacket for the plateau. Bring water shoes if you plan to explore the reef, and a dry bag for boat days.',
            'Plan boat trips for the first half of your stay. If the weather moves one, you still have days left to rebook. Save the sightseeing for days with showers in the forecast; our [rainy-day guide](/blog/things-to-do-in-mauritius-when-it-rains) has ideas.',
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
    {
      // Written 2026-10-24 for "christmas in mauritius", "new years eve mauritius", "noël île Maurice"
      // and "réveillon île Maurice", which peak in December and had no page (Google showed the December
      // guide at #36). This post owns the festive days; the December guide keeps the month and links
      // here. Do not say a trip runs on 25 Dec, 31 Dec or 1–2 Jan: no operator has confirmed those days.
      slug: 'christmas-and-new-year-in-mauritius',
      datePublished: '2026-10-24',
      title: 'Christmas and New Year in Mauritius 2026: What to Expect and How to Plan',
      metaTitle: 'Christmas & New Year in Mauritius 2026: What to Expect',
      metaDescription:
        'Christmas and New Year in Mauritius 2026: what happens on 24, 25 and 31 December, where to see the fireworks, what closes, and what to book ahead.',
      excerpt:
        'Christmas in Mauritius means 30 °C, a warm sea and a beach picnic, and New Year’s Eve is the loudest night of the year. Here is what happens on each festive day, what closes, and how to plan around them.',
      readMins: 7,
      heroImageUrl: '/blog/mauritius-honeymoon-guide.webp',
      sections: [
        {
          heading: 'The festive season at a glance',
          paragraphs: [
            '**Christmas Eve, Thursday 24 December:** midnight mass in churches across the island and gala dinners in the hotels.',
            '**Christmas Day, Friday 25 December:** a public holiday. Families gather for a long lunch, then head to the beach.',
            '**New Year’s Eve, Thursday 31 December:** the biggest night of the year, with fireworks over every bay at midnight.',
            '**New Year, Friday 1 and Saturday 2 January 2027:** both are public holidays. 26 December is a normal working day in Mauritius.',
            '**Weather:** high summer. Coastal highs of 29 to 31 °C, a sea of 27 to 28 °C, and short tropical showers.',
            '**Busiest fortnight:** from about 19 December to the first weekend of January, when hotels, boats and beaches are at their busiest.',
          ],
        },
        {
          heading: 'How Mauritius celebrates Christmas',
          paragraphs: [
            'Christmas is a public holiday in Mauritius, and it is celebrated well beyond the island’s Christian community. Shopping centres put up their trees, the Caudan Waterfront in Port Louis is lit up, and the supermarkets fill with toys, cakes and gift hampers.',
            'On Christmas Eve, churches hold midnight mass. The little red-roofed church at Cap Malheureux in the north, with Coin de Mire island behind it, is one of the most photographed on the island. Hotels stage gala dinners on the 24th, often with a band and a buffet.',
            'Christmas Day itself is a family day. Many Mauritian families share a big lunch, where a biryani or a curry is as likely as a roast, and then spend the afternoon at the beach. Public beaches such as Belle Mare, Mont Choisy and Flic en Flac are lively from late morning, so arrive early if you want shade.',
          ],
        },
        {
          heading: 'New Year’s Eve: the loudest night of the year',
          paragraphs: [
            'New Year’s Eve, _le réveillon_, is the big celebration. From the afternoon of 31 December, families set up on the public beaches with tents, barbecues and music, and many stay the night. Sega, the island’s own music, plays until late.',
            'At midnight, fireworks and firecrackers go off all over the island at once, from the hotels, the villages and the beaches. It is loud, and it goes on well past midnight. Any beach or hillside with a view of the coast will give you a show; the public beaches at Belle Mare, Grand Baie, Mont Choisy and Flic en Flac are the liveliest places to be.',
            'Hotels hold a gala dinner on the 31st, usually with a compulsory supplement for every guest. Check your booking, so it does not surprise you at checkout. 1 and 2 January are quiet family days: people visit relatives, and the beaches fill up again.',
          ],
        },
        {
          heading: 'What is open over Christmas and New Year',
          paragraphs: [
            'On 25 December and 1 January, many shops, restaurants and offices close or open for short hours. Banks are closed on public holidays. Hotels and their restaurants stay open, and so do the beaches and the lagoons. If you plan to eat out, book a table ahead, especially on the 24th and the 31st.',
            'Some of our trips run on the public holidays and some do not, depending on the boat crews and drivers. If you want a trip on 25 or 31 December, or on 1 or 2 January, [message us](/contact) before you book and we will confirm the day for you. On the other days of the festive fortnight, trips run as usual and you can book them online.',
            'Traffic is heaviest around Port Louis, Grand Baie and the popular beaches on the 24th, the 25th and the 31st. Allow extra time for any drive, and more for a run to the airport.',
          ],
        },
        {
          heading: 'How to plan a festive trip',
          paragraphs: [
            'Book the days that matter first. For trips between 20 December and 3 January, book two to three weeks ahead, especially boat trips at weekends. Private boats go first. Most of our trips can be cancelled free of charge until the day before, so holding a date costs you little.',
            'Put your boat days either side of the holidays. A catamaran on 23 or 26 December is quieter than the beach on the 25th, and you keep Christmas Day and New Year for your family or your hotel’s celebrations.',
            'Keep one day free. December is summer, and a passing storm can move a boat trip. If we cancel because of the weather or the sea, you choose between a free new date and a full refund.',
          ],
        },
        {
          heading: 'Ideas for the festive fortnight, with prices',
          paragraphs: [
            'These trips suit the festive fortnight well. Prices are from our live booking pages in October 2026:',
            '**A day on the lagoon:** the [Île aux Cerfs catamaran](/activities/catamaran-cruise-ile-aux-cerfs), about 7 hours with the waterfall, snorkelling and a barbecue lunch on board, from €55 per person.',
            '**A family day out:** [Casela World of Adventures](/activities/casela-world-of-adventures) on the west coast, with safaris, zip lines and animals, from €32.',
            '**An evening for two:** the [sunset catamaran](/activities/catamaran-sunset-cruise) from Grand Baie, two hours on the water with a cocktail, from €65 per person.',
            '**The whole boat to yourselves:** a [private catamaran to Île aux Cerfs](/activities/private-full-day-catamaran-ile-aux-cerfs) for up to 4 guests, from €850 for the boat. Read [private vs shared catamaran](/blog/private-vs-shared-catamaran-mauritius) before you choose.',
            '**A gift to remember:** the [seaplane over the underwater waterfall](/activities/seaplane) from €205 per person, or a [helicopter flight](/activities/helicotour) from €250.',
            '**City lights and last-minute gifts:** the [Port Louis city tour](/activities/port-louis-city-tour) with the Caudan Waterfront and Chinatown, or a [private shopping tour](/activities/private-shopping-tour), each from €90 for the car with a driver.',
          ],
        },
        {
          heading: 'Arriving for the holidays',
          paragraphs: [
            'The airport is in the south-east, near Mahébourg. In the week before Christmas many flights land at once and the taxi queue can be long. Our [airport transfers](/airport-transfers) start from €40 per car, at a fixed price agreed when you book, and the driver meets you in arrivals.',
            'For the weather, the cyclone rules and the whole December calendar, read [Mauritius in December](/blog/mauritius-in-december). Staying into the new year? See [Mauritius in January](/blog/mauritius-in-january). Want help planning the fortnight? Message us on WhatsApp with your dates and your hotel, and we’ll suggest a plan around the festive days.',
          ],
        },
      ],
      faq: [
        {
          q: 'Does Mauritius celebrate Christmas?',
          a: 'Yes. Christmas Day, 25 December, is a public holiday in Mauritius and it is celebrated across the island’s communities, with midnight mass on Christmas Eve, family lunches and beach picnics on the day.',
        },
        {
          q: 'Is Boxing Day a public holiday in Mauritius?',
          a: 'No. 26 December is a normal working day in Mauritius. The festive public holidays are Christmas Day on 25 December and New Year on 1 and 2 January.',
        },
        {
          q: 'Where can I see the New Year’s Eve fireworks in Mauritius?',
          a: 'Fireworks go up all over the island at midnight, so any beach or hillside with a view of the coast works. The public beaches at Belle Mare, Grand Baie, Mont Choisy and Flic en Flac are the liveliest places, with families celebrating there from the afternoon.',
        },
        {
          q: 'Do tours run on Christmas Day and New Year’s Day?',
          a: 'Some do and some do not, depending on the crews and drivers. Message us before booking a trip on 25 or 31 December, or on 1 or 2 January, and we will confirm the day. On the other festive days, trips run as usual.',
        },
        {
          q: 'What is the weather like at Christmas in Mauritius?',
          a: 'It is summer: coastal highs of 29 to 31 °C, warm nights and a sea of 27 to 28 °C. Expect short tropical showers rather than grey days. A cyclone in December is uncommon, and if we cancel a trip because of the weather, you choose a free new date or a full refund.',
        },
      ],
    },
    {
      // Written 2026-10-24 for "île Maurice en janvier" (192 impressions at #35 in Sep–Oct with no page
      // of its own) and "mauritius in january" / "mauritius weather in january", searched in December by
      // people travelling after the holidays. The cyclone detail stays in the cyclone guide; this post
      // links to it. Cavadee's date is lunar and not yet gazetted: keep it "expected". Check every date
      // and price again before January 2028.
      slug: 'mauritius-in-january',
      datePublished: '2026-10-24',
      title: 'Mauritius in January 2027: Weather, Cyclones and What to Book',
      metaTitle: 'Mauritius in January 2027: Weather, Rain & What to Do',
      metaDescription:
        'Mauritius in January 2027: summer heat, rain and cyclone advice, sea temperature, Cavadee and New Year, and tour prices, from a local tour operator.',
      excerpt:
        'January is the heart of summer in Mauritius: the hottest days, the warmest sea and the start of the rainy season. Here is what the weather really does, how cyclones work, and what to book.',
      readMins: 7,
      heroImageUrl: '/blog/snorkeling-in-mauritius.webp',
      sections: [
        {
          heading: 'January 2027 at a glance',
          paragraphs: [
            '**Weather:** the hottest weeks of the year. Coastal highs of 30 to 31 °C, nights around 23 to 24 °C, and the sea at 27 to 28 °C.',
            '**Rain:** the wet season begins. January to March bring the most rain, mostly as heavy afternoon showers over the hills.',
            '**Daylight:** long days. The sun rises around 05:50 and sets around 19:00.',
            '**Public holidays:** New Year on Friday 1 and Saturday 2 January, then Thaipoosam Cavadee, expected in late January. Abolition of Slavery follows on Monday 1 February.',
            '**Crowds:** busy until the first weekend of January, then quiet. The rest of the month is one of the calmest times of the summer.',
            '**Cyclones:** January and February are the peak of the season. Most weeks pass without a warning, but plan a flexible day.',
          ],
        },
        {
          heading: 'What the weather is like in January',
          paragraphs: [
            'January is high summer. The days are hot and humid, the winds are light, and the lagoons are at their warmest. Nights stay warm, so a fan or air conditioning matters more than a jumper.',
            'Rain usually comes as short, heavy showers, or a thunderstorm that builds over the hills in the afternoon and then clears. Mornings are often bright. The central plateau around Curepipe is by far the wettest part of the island. The west coast, from Flic en Flac to Le Morne, is the driest, and the north is drier than the east.',
            'On the east coast near Belle Mare, showers come in off the sea and move on, and most pass in under an hour. That is why our boat trips leave early: the morning is usually the calmest, clearest part of the day.',
            'The sun is at its strongest. Use reef-safe sunscreen, wear a hat and a rash vest, and drink plenty of water. Mosquitoes are more active in the wet season, so pack repellent for the evenings.',
          ],
        },
        {
          heading: 'Cyclones in January: what really happens',
          paragraphs: [
            'Cyclone season runs from November to April, and January and February are the months with the most cyclones. Many summers pass without a cyclone warning in Mauritius, but a tropical storm in the region can still bring a day or two of wind, rough sea and heavy rain.',
            'The Mauritius Meteorological Services issue warnings in four classes, with several days of forecasts before a storm arrives. When a warning is in force, boats stay in harbour. At Class III, offices, banks and most of the island close until the warning is lifted. Our [cyclone season guide](/blog/mauritius-cyclone-season) explains each class and what to do.',
            'If we cancel a trip because of the weather or the sea, you choose between a free new date and a full refund. Most of our trips can also be cancelled free of charge until the day before. Book boat trips early in your stay so a lost day can be moved, and check that your travel insurance covers weather delays.',
          ],
        },
        {
          heading: 'Is January a good time to visit Mauritius?',
          paragraphs: [
            'Yes, if you want heat, a warm sea and quieter beaches after the New Year rush. From the second week of January, hotels are often cheaper than over Christmas, and you can book most trips only a few days ahead.',
            'The trade-off is rain and the small chance of a cyclone. If a dry, breezy holiday matters most, May to November will suit you better; read our guide to the [best time to visit Mauritius](/blog/best-time-to-visit-mauritius). If you love heat and the water, January is a good month for snorkelling and diving whenever the sea is calm.',
            'Plan with the weather, not against it: boat trips in the morning and early in your stay, sightseeing and museums on the showery days, and one day kept free.',
          ],
        },
        {
          heading: 'Festivals and holidays in January',
          paragraphs: [
            '**New Year, 1 and 2 January:** two public holidays after the loudest night of the year. Families visit relatives and fill the public beaches. Read [Christmas and New Year in Mauritius](/blog/christmas-and-new-year-in-mauritius) for what happens and what closes.',
            '**Thaipoosam Cavadee:** a Tamil festival and a public holiday, expected in late January 2027; the government confirms the date each year. After days of fasting, devotees walk to the temples carrying the _cavadee_, a wooden arch decorated with flowers and pots of milk, and some pierce their cheeks or tongue with fine needles. Processions start early in the morning.',
            '**Just after January:** Abolition of Slavery on Monday 1 February, and the Chinese Spring Festival on Saturday 6 February 2027, with dragon dances and firecrackers in Port Louis’s Chinatown. Banks and offices close on these public holidays; message us if you want a trip on one of them.',
          ],
        },
        {
          heading: 'What to book in January, with prices',
          paragraphs: [
            'Calm mornings and a warm sea make January a month for the water, with a plan for the showery days. Prices are from our live booking pages in October 2026:',
            '**Île aux Cerfs by catamaran:** about 7 hours with the waterfall, snorkelling and a barbecue lunch on board, [from €55 per person](/activities/catamaran-cruise-ile-aux-cerfs).',
            '**Swimming with dolphins:** an early-morning trip into Tamarin Bay on the sheltered west coast, [from €45 per person](/activities/swimming-with-dolphins).',
            '**Under the sea:** the [Blue Safari submarine and subscooter](/activities/blue-safari-submarine-subscooter) from €125, or the [underwater sea walk](/activities/underwater-sea-walk-excursion) from €40. Rain on the surface makes little difference a few metres down: what counts is the wind and the swell, and the operator decides on the morning.',
            '**A showery-day tour by private car:** the [tea tasting tour](/activities/tea-tasting-tour) to the Bois Chéri tea factory and museum, Saint Aubin and La Vanille, or the [Port Louis city tour](/activities/port-louis-city-tour) with the Caudan Waterfront and the Odysseo Oceanarium, each from €90 for the car with a driver. More ideas in [things to do in Mauritius when it rains](/blog/things-to-do-in-mauritius-when-it-rains).',
            '**Waterfalls at their fullest:** summer rain fills the falls at Chamarel and in the Black River Gorges. See them from the viewpoints on the [south tour](/activities/south-tour-mauritius), from €90 for the car with a driver.',
            '**From the air:** on a clear morning, the [seaplane over the underwater waterfall](/activities/seaplane), from €205 per person.',
          ],
        },
        {
          heading: 'Arriving in January',
          paragraphs: [
            'The airport is in the south-east, near Mahébourg. Belle Mare is about 50 minutes away by road and Grand Baie about 75. Our [airport transfers](/airport-transfers) start from €40 per car, at a fixed price agreed when you book.',
            'The first days of January are busy with departures after the holidays, so allow extra time on the road to the airport. Arriving before the New Year? Read [Mauritius in December](/blog/mauritius-in-december) for the festive dates and when to book.',
          ],
        },
        {
          heading: 'Packing and practical tips',
          paragraphs: [
            'Pack light, breathable clothes, a light rain jacket or a small umbrella, a hat, reef-safe sunscreen and insect repellent. A dry bag keeps your phone safe on boat days and in sudden showers.',
            'Book the trips you care about most for the first half of your stay, and in the morning. If the weather moves one, you still have days to rebook.',
            'Want help planning your days? Message us on WhatsApp with your dates and where you’re staying, and we’ll suggest a plan for the weather that week.',
          ],
        },
      ],
      faq: [
        {
          q: 'Is January a good time to visit Mauritius?',
          a: 'Yes, if you like heat and a warm sea. January is hot and humid, with the warmest water of the year and quieter beaches after the first week. It is also the start of the rainy season and the peak of cyclone season, so keep a day free.',
        },
        {
          q: 'What is the weather like in Mauritius in January?',
          a: 'Expect coastal highs of 30 to 31 °C, nights around 23 to 24 °C and a sea of 27 to 28 °C. Rain falls as heavy, short showers, mostly in the afternoon and over the central plateau. The west coast is the driest.',
        },
        {
          q: 'Does it rain every day in Mauritius in January?',
          a: 'Not usually. Showers are frequent but short, and many days have a sunny morning before clouds build over the hills. The central plateau gets far more rain than the coasts, so moving to the west coast often means moving to the sun.',
        },
        {
          q: 'Is January cyclone season in Mauritius?',
          a: 'Yes. Cyclone season runs from November to April, and January and February are the riskiest months. Warnings come days ahead, boats stay in harbour while one is in force, and if we cancel a trip you choose a free new date or a full refund.',
        },
        {
          q: 'Do I need to book tours in advance in January?',
          a: 'Book two to three weeks ahead for the first days of January, which are still part of the festive rush. After that, a few days ahead is usually enough. Most trips can be cancelled free of charge until the day before.',
        },
      ],
    },
    {
      // Written 2026-10-24 for "things to do in mauritius when it rains", "rainy day activities
      // mauritius" and "que faire à l'île Maurice quand il pleut": in-island searches that peak in the
      // summer rains (Dec–Mar), when 41% of our search clicks already come from Mauritius. Third-party
      // places are named without hours or prices; the bookable ones are stops on our own itineraries.
      slug: 'things-to-do-in-mauritius-when-it-rains',
      datePublished: '2026-10-24',
      title: 'Things to Do in Mauritius When It Rains',
      metaTitle: 'Things to Do in Mauritius When It Rains: Local Tips',
      metaDescription:
        'Rain in Mauritius? Head for the dry west coast, Port Louis, a tea or rum tasting, the museums of Mahébourg or a submarine. Local tips from a tour operator.',
      excerpt:
        'Rain in Mauritius rarely lasts all day, and it rarely falls everywhere at once. Here is where to find the sun, and the best things to do under a roof while a shower passes.',
      readMins: 7,
      heroImageUrl: '/blog/best-waterfalls-in-mauritius.webp',
      sections: [
        {
          heading: 'First, find out where it is raining',
          paragraphs: [
            'Mauritius is small, but its weather changes within a few kilometres. The central plateau around Curepipe gets several times more rain than the coast, and the south-east trade winds push showers onto the east and south coasts. The west coast, from Flic en Flac to Le Morne, sits in the shelter of the mountains and is the driest part of the island.',
            'So the first rainy-day plan is a drive. From Belle Mare it is a little over an hour to the west coast, where it is often sunny while the east is grey. Showers are also short: a wet morning often clears by lunch.',
            'Before you change plans, look at the forecast and the rain radar from the Mauritius Meteorological Services. If you are out with one of our drivers, ask them: they watch the sky every day and will change the route to follow the sun.',
          ],
        },
        {
          heading: 'Spend the day in Port Louis',
          paragraphs: [
            'The capital is the best rainy-day base on the island, because so much of it is under a roof. The Central Market is covered, with fruit, spices and street-food stalls, and the Caudan Waterfront has shops, cafés and the Blue Penny Museum, home of the famous Mauritius stamps.',
            'Close by are Chinatown; the Aapravasi Ghat, the immigration depot where indentured workers from India arrived in the 19th century, now a UNESCO World Heritage Site; and the Odysseo Oceanarium, an indoor aquarium of Indian Ocean marine life.',
            'Our [Port Louis city tour](/activities/port-louis-city-tour) takes in the Caudan Waterfront, Chinatown, the Citadel, the Odysseo Oceanarium and a Tamil temple, from €90 for the car with a driver. Read our [Port Louis guide](/blog/port-louis-things-to-do) for more.',
          ],
        },
        {
          heading: 'Tea, sugar and rum tastings',
          paragraphs: [
            'The south has the island’s best-known tasting. At the Bois Chéri tea factory and museum, you see how tea is grown and processed, then taste the estate’s teas with a view over the plantation. Our [tea tasting tour](/activities/tea-tasting-tour) adds Saint Aubin and La Vanille Nature Park, from €90 for the car with a driver.',
            'Sugar made Mauritius. L’Aventure du Sucre, an old sugar mill in Pamplemousses, tells its story and ends with a tasting of unrefined sugars and rums. In the south-west, the Rhumerie de Chamarel distils its rum straight from cane juice and offers tours and tastings.',
            'Both are easy stops on a [custom road trip](/activities/custom-road-trip), where you choose the places and the driver plans the route, from €95.',
          ],
        },
        {
          heading: 'Museums and old houses',
          paragraphs: [
            'Mahébourg, on the south-east coast, is full of history and a good wet-day stop. The National History Museum, in an 18th-century French colonial house, covers the Dutch, French and British eras, and the Frederik Hendrik Museum stands on the site of the first Dutch settlement at Vieux Grand Port.',
            'Nearby, the Rault biscuit factory has made its manioc biscuits by hand since 1870 and shows visitors how. All three are stops on our [private south-east tour](/activities/private-south-east-tour), together with the Mahébourg waterfront and Blue Bay, from €90 for the car with a driver.',
            'Further inland, Eureka in Moka is a 19th-century Creole house with its rooms still furnished, a short drive from Port Louis.',
          ],
        },
        {
          heading: 'Go under the sea',
          paragraphs: [
            'Rain on the surface makes little difference a few metres down. If the sea is calm, underwater trips still run in light rain: the [Blue Safari submarine and subscooter](/activities/blue-safari-submarine-subscooter) in the north from €125, or the [underwater sea walk](/activities/underwater-sea-walk-excursion) from €40, where you walk on the sea floor in a diving helmet.',
            'What stops boats is wind and swell, not rain. The operators decide on the morning, and if we cancel a trip because of the weather or the sea, you choose between a free new date and a full refund.',
          ],
        },
        {
          heading: 'See the waterfalls at their best',
          paragraphs: [
            'Rain is good news for the waterfalls. After a wet night, Chamarel Falls and Alexandra Falls in the Black River Gorges are at their fullest, and the forest is at its greenest. Both viewpoints are a short walk from the car park, so you can see them between showers.',
            'Skip the hiking trails during and just after heavy rain: paths get slippery and rivers rise fast. The [south tour](/activities/south-tour-mauritius) stops at Chamarel and the Black River Gorges viewpoint, from €90 for the car with a driver. See also our [waterfall guide](/blog/best-waterfalls-in-mauritius).',
          ],
        },
        {
          heading: 'Shop and eat under a roof',
          paragraphs: [
            'Mauritius has good shopping for a wet afternoon. Bagatelle Mall in Moka is one of the largest shopping centres, the Caudan Waterfront mixes shops with the harbour, and Floréal has factory shops for knitwear and clothing.',
            'Our [private shopping tour](/activities/private-shopping-tour) covers the Floréal factory shop, Bagatelle Mall and the Caudan Waterfront, for a full day or half a day, from €90 for the car with a driver.',
            'Rain is also a good excuse to eat. Try dholl puri, gâteaux piments and a curry from a market stall, or book a table for a long Creole lunch. Our guides to [Mauritian food](/blog/mauritian-food-dishes) and [street food](/blog/street-food-mauritius) list what to order.',
          ],
        },
        {
          heading: 'Plan a rainy day with a driver',
          paragraphs: [
            'A private driver is the simplest rainy-day plan. You keep the car all day, change the order of stops when a shower arrives, and finish on the coast if the sun comes out. Our sightseeing tours start from your hotel.',
            'Send us your hotel and the day on WhatsApp, and we’ll suggest a route that fits the forecast. Travelling in the wet season? Read [Mauritius in January](/blog/mauritius-in-january) and our [cyclone season guide](/blog/mauritius-cyclone-season).',
          ],
        },
      ],
      faq: [
        {
          q: 'What can you do in Mauritius when it rains?',
          a: 'Drive to the drier west coast, spend the day in Port Louis at the market, the Caudan Waterfront and the Odysseo Oceanarium, do a tea or rum tasting, visit the museums in Mahébourg, go shopping at Bagatelle Mall, or go under the sea on a submarine trip if the sea is calm.',
        },
        {
          q: 'Does it rain all day in Mauritius?',
          a: 'Rarely. Rain usually comes as short, heavy showers, often in the afternoon, and many wet mornings clear by lunch. The central plateau is much wetter than the coasts.',
        },
        {
          q: 'Which part of Mauritius gets the least rain?',
          a: 'The west coast, from Flic en Flac to Le Morne, is the driest part of the island. The central plateau around Curepipe is the wettest, and the east and south coasts get more showers than the west.',
        },
        {
          q: 'When is the rainy season in Mauritius?',
          a: 'Summer, from November to April, is the wetter season, and January to March bring the most rain. May to October is cooler and drier.',
        },
        {
          q: 'Do boat trips run in the rain?',
          a: 'Usually, yes, in light rain. What stops a boat is strong wind or rough sea. The operator decides on the morning, and if we cancel because of the weather or the sea, you choose a free new date or a full refund.',
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
          '**Privé :** à partir de 850 € le bateau, jusqu’à 4 personnes, environ 7 heures, départ à 9 h, seulement votre groupe à bord.',
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
          'Pour un couple, le partagé l’emporte nettement sur le prix : 110 € à deux contre 850 € pour le bateau.',
          'Pour un groupe de quatre, la croisière partagée revient à 220 € et la sortie privée à 850 €, soit 212,50 € chacun. Vous payez près de quatre fois plus pour avoir le bateau entier, une journée souple et aucun autre passager. Pour une occasion unique pendant le voyage, beaucoup de familles et d’amis estiment que cela en vaut la peine.',
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
        a: 'Notre catamaran privé pour une journée à l’île aux Cerfs coûte à partir de 850 € le bateau, jusqu’à 4 personnes, avec déjeuner barbecue, boissons et snorkeling compris.',
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
          'Noël, le vendredi 25 décembre, et le Nouvel An, les 1er et 2 janvier, sont des jours fériés. Noël est une journée chaude et familiale avec pique-niques à la plage, et le réveillon du 31 est la nuit la plus bruyante de l’année, avec des familles sur les plages publiques et des feux d’artifice partout à minuit.',
          'Les hôtels facturent souvent un supplément obligatoire pour les dîners de gala du 24 et du 31, et beaucoup de commerces et de restaurants ferment ou réduisent leurs horaires le 25 décembre et le 1er janvier. Notre guide [Noël et Nouvel An à l’île Maurice](/fr/blog/christmas-and-new-year-in-mauritius) détaille chaque jour de fête, où voir les feux d’artifice et ce qui est ouvert.',
        ],
      },
      {
        heading: 'L’affluence, et quand réserver',
        paragraphs: [
          'Fin décembre, deux publics se croisent : les visiteurs qui fuient l’hiver européen et les familles mauriciennes en vacances de fin d’année. À partir du 19 décembre environ, plages, bateaux et routes connaissent leur plus forte affluence de l’année.',
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
          '**Nager avec les dauphins :** une sortie tôt le matin dans la baie de Tamarin, sur la côte ouest abritée, [à partir de 45 € par personne](/fr/activities/swimming-with-dolphins). La journée complète avec Crystal Rock et un déjeuner barbecue à l’île aux Bénitiers est [à partir de 75 €](/fr/activities/swimming-with-dolphins-benitier-island-speedboat-all-inclusive).',
          '**Les îles du nord :** une journée en catamaran depuis Grand Baie vers l’île Plate et l’îlot Gabriel, en passant par le Coin de Mire, [à partir de 65 € par personne](/fr/activities/catamaran-cruise-3-northern-island-adventure).',
          '**Catamaran au coucher du soleil :** deux heures de navigation au départ de Grand Baie à l’heure où le soleil se couche, [à partir de 65 € par personne](/fr/activities/catamaran-sunset-cruise).',
          '**L’hydravion au-dessus de la cascade sous-marine :** la vue sur Le Morne que la plupart des gens ne connaissent qu’en photo, [à partir de 205 € par personne](/fr/activities/seaplane).',
          '**Visites en voiture privée :** le [circuit sud](/fr/activities/south-tour-mauritius) vers Chamarel, les gorges de Rivière Noire et Grand Bassin, ou le [circuit nord](/fr/activities/north-tour) vers Port-Louis et Pamplemousses, chacun à partir de 90 € la voiture avec chauffeur. Un jour d’averses, partez dans les terres le matin et gardez l’après-midi pour la côte.',
        ],
      },
      {
        heading: 'Arriver en décembre',
        paragraphs: [
          'L’aéroport se trouve dans le sud-est, près de Mahébourg. Belle Mare est à environ 50 minutes de route et Grand Baie à environ 75. Fin décembre, beaucoup de vols atterrissent en même temps et la file des taxis peut être longue : un chauffeur qui vous attend à l’arrivée enlève le stress d’un atterrissage en pleines fêtes.',
          'Nos [transferts aéroport](/fr/airport-transfers) commencent à 40 € par voiture, à un prix fixe convenu à la réservation. La circulation autour de Port-Louis, de Grand Baie et des plages les plus fréquentées est à son maximum pendant la quinzaine des fêtes : prévoyez de la marge le jour du départ. Vous restez en janvier ? Lisez [l’île Maurice en janvier](/fr/blog/mauritius-in-january).',
        ],
      },
      {
        heading: 'Bagages et conseils pratiques',
        paragraphs: [
          'Prévoyez des vêtements légers et respirants, un chapeau, une crème solaire respectueuse des coraux et une veste de pluie légère pour le plateau. Emportez des chaussures d’eau si vous comptez explorer le récif, et un sac étanche pour les sorties en mer.',
          'Placez les sorties en mer dans la première moitié de votre séjour. Si la météo en décale une, il vous reste des jours pour la reporter. Gardez les visites pour les jours où des averses sont annoncées ; notre [guide des jours de pluie](/fr/blog/things-to-do-in-mauritius-when-it-rains) vous donne des idées.',
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
  'christmas-and-new-year-in-mauritius': {
    title: 'Noël et Nouvel An à l’île Maurice 2026 : à quoi s’attendre et comment s’organiser',
    excerpt:
      'Noël à Maurice, c’est 30 °C, une mer chaude et un pique-nique à la plage, et le réveillon du 31 est la nuit la plus bruyante de l’année. Voici ce qui se passe chaque jour de fête, ce qui ferme et comment vous organiser.',
    sections: [
      {
        heading: 'Les fêtes en un coup d’œil',
        paragraphs: [
          '**Veille de Noël, jeudi 24 décembre :** messe de minuit dans les églises de toute l’île et dîners de gala dans les hôtels.',
          '**Noël, vendredi 25 décembre :** jour férié. Les familles se retrouvent pour un long déjeuner, puis filent à la plage.',
          '**Réveillon du Nouvel An, jeudi 31 décembre :** la plus grande soirée de l’année, avec des feux d’artifice au-dessus de chaque baie à minuit.',
          '**Nouvel An, vendredi 1er et samedi 2 janvier 2027 :** deux jours fériés. Le 26 décembre est un jour ouvré normal à Maurice.',
          '**Météo :** le plein été. Maximales de 29 à 31 °C sur la côte, mer à 27–28 °C et courtes averses tropicales.',
          '**Quinzaine la plus chargée :** du 19 décembre environ au premier week-end de janvier, quand hôtels, bateaux et plages sont les plus fréquentés.',
        ],
      },
      {
        heading: 'Comment Maurice fête Noël',
        paragraphs: [
          'Noël est un jour férié à Maurice, et on le fête bien au-delà de la communauté chrétienne de l’île. Les centres commerciaux installent leurs sapins, le Caudan Waterfront à Port-Louis s’illumine, et les supermarchés se remplissent de jouets, de gâteaux et de paniers garnis.',
          'La veille de Noël, les églises célèbrent la messe de minuit. La petite église au toit rouge du Cap Malheureux, dans le nord, avec l’île du Coin de Mire en arrière-plan, est l’une des plus photographiées de l’île. Les hôtels organisent des dîners de gala le 24, souvent avec orchestre et buffet.',
          'Le jour de Noël est un jour de famille. Beaucoup de familles mauriciennes partagent un grand déjeuner, où un briani ou un cari est aussi probable qu’une volaille rôtie, puis passent l’après-midi à la plage. Les plages publiques comme Belle Mare, Mont Choisy et Flic en Flac sont animées dès la fin de matinée : arrivez tôt si vous voulez de l’ombre.',
        ],
      },
      {
        heading: 'Le réveillon du 31 : la nuit la plus bruyante de l’année',
        paragraphs: [
          'Le réveillon de la Saint-Sylvestre est la grande fête. Dès l’après-midi du 31 décembre, les familles s’installent sur les plages publiques avec tentes, barbecues et musique, et beaucoup y passent la nuit. Le séga, la musique propre à l’île, résonne jusque tard.',
          'À minuit, feux d’artifice et pétards éclatent partout sur l’île en même temps, depuis les hôtels, les villages et les plages. C’est bruyant, et cela dure bien après minuit. N’importe quelle plage ou colline avec vue sur la côte vous offrira le spectacle ; les plages publiques de Belle Mare, Grand Baie, Mont Choisy et Flic en Flac sont les plus animées.',
          'Les hôtels organisent un dîner de gala le 31, généralement avec un supplément obligatoire pour chaque client. Vérifiez votre réservation pour éviter une surprise au départ. Les 1er et 2 janvier sont des journées calmes en famille : on rend visite aux proches, et les plages se remplissent à nouveau.',
        ],
      },
      {
        heading: 'Ce qui est ouvert à Noël et au Nouvel An',
        paragraphs: [
          'Le 25 décembre et le 1er janvier, beaucoup de commerces, de restaurants et de bureaux ferment ou réduisent leurs horaires. Les banques sont fermées les jours fériés. Les hôtels et leurs restaurants restent ouverts, tout comme les plages et les lagons. Si vous comptez dîner dehors, réservez une table à l’avance, surtout le 24 et le 31.',
          'Certaines de nos sorties ont lieu les jours fériés et d’autres non, selon les équipages et les chauffeurs. Si vous souhaitez une sortie le 25 ou le 31 décembre, ou le 1er ou le 2 janvier, [écrivez-nous](/fr/contact) avant de réserver et nous vous confirmerons la date. Les autres jours de la quinzaine des fêtes, les sorties ont lieu normalement et se réservent en ligne.',
          'La circulation est la plus dense autour de Port-Louis, de Grand Baie et des plages fréquentées les 24, 25 et 31. Prévoyez de la marge pour tout trajet, et davantage pour aller à l’aéroport.',
        ],
      },
      {
        heading: 'Comment organiser un séjour pendant les fêtes',
        paragraphs: [
          'Réservez d’abord les jours qui comptent. Pour les sorties entre le 20 décembre et le 3 janvier, réservez deux à trois semaines à l’avance, surtout les sorties en mer le week-end. Les bateaux privés partent en premier. La plupart de nos sorties s’annulent gratuitement jusqu’à la veille : bloquer une date ne vous coûte presque rien.',
          'Placez vos journées en mer autour des fêtes. Un catamaran le 23 ou le 26 décembre est plus tranquille que la plage le 25, et vous gardez Noël et le Nouvel An pour votre famille ou les festivités de votre hôtel.',
          'Gardez une journée libre. Décembre, c’est l’été, et une tempête de passage peut décaler une sortie en mer. Si nous annulons à cause de la météo ou de l’état de la mer, vous choisissez entre une nouvelle date sans frais et un remboursement intégral.',
        ],
      },
      {
        heading: 'Idées pour la quinzaine des fêtes, avec les prix',
        paragraphs: [
          'Ces sorties conviennent bien à la période des fêtes. Les prix sont ceux de nos pages de réservation en octobre 2026 :',
          '**Une journée sur le lagon :** le [catamaran pour l’île aux Cerfs](/fr/activities/catamaran-cruise-ile-aux-cerfs), environ 7 heures avec la cascade, le snorkeling et un déjeuner barbecue à bord, à partir de 55 € par personne.',
          '**Une journée en famille :** [Casela World of Adventures](/fr/activities/casela-world-of-adventures) sur la côte ouest, avec safaris, tyroliennes et animaux, à partir de 32 €.',
          '**Une soirée à deux :** le [catamaran au coucher du soleil](/fr/activities/catamaran-sunset-cruise) au départ de Grand Baie, deux heures sur l’eau avec un cocktail, à partir de 65 € par personne.',
          '**Le bateau rien que pour vous :** un [catamaran privé pour l’île aux Cerfs](/fr/activities/private-full-day-catamaran-ile-aux-cerfs) jusqu’à 4 personnes, à partir de 850 € le bateau. Lisez [catamaran privé ou partagé](/fr/blog/private-vs-shared-catamaran-mauritius) avant de choisir.',
          '**Un cadeau inoubliable :** l’[hydravion au-dessus de la cascade sous-marine](/fr/activities/seaplane) à partir de 205 € par personne, ou un [vol en hélicoptère](/fr/activities/helicotour) à partir de 250 €.',
          '**Illuminations et derniers cadeaux :** la [visite de Port-Louis](/fr/activities/port-louis-city-tour) avec le Caudan Waterfront et Chinatown, ou une [journée shopping privée](/fr/activities/private-shopping-tour), chacune à partir de 90 € la voiture avec chauffeur.',
        ],
      },
      {
        heading: 'Arriver pour les fêtes',
        paragraphs: [
          'L’aéroport se trouve dans le sud-est, près de Mahébourg. La semaine avant Noël, beaucoup de vols atterrissent en même temps et la file des taxis peut être longue. Nos [transferts aéroport](/fr/airport-transfers) commencent à 40 € par voiture, à un prix fixe convenu à la réservation, et le chauffeur vous attend à l’arrivée.',
          'Pour la météo, les règles en cas de cyclone et tout le calendrier de décembre, lisez [l’île Maurice en décembre](/fr/blog/mauritius-in-december). Vous restez après le Nouvel An ? Consultez [l’île Maurice en janvier](/fr/blog/mauritius-in-january). Besoin d’aide pour organiser la quinzaine ? Écrivez-nous sur WhatsApp avec vos dates et votre hôtel, et nous vous proposerons un programme autour des jours de fête.',
        ],
      },
    ],
    faq: [
      {
        q: 'Fête-t-on Noël à l’île Maurice ?',
        a: 'Oui. Le jour de Noël, le 25 décembre, est férié à Maurice et se fête dans toutes les communautés de l’île : messe de minuit la veille, déjeuners en famille et pique-niques à la plage le jour même.',
      },
      {
        q: 'Le 26 décembre est-il férié à l’île Maurice ?',
        a: 'Non. Le 26 décembre est un jour ouvré normal à Maurice. Les jours fériés des fêtes sont Noël le 25 décembre et le Nouvel An les 1er et 2 janvier.',
      },
      {
        q: 'Où voir les feux d’artifice du Nouvel An à l’île Maurice ?',
        a: 'Les feux d’artifice partent de partout sur l’île à minuit : n’importe quelle plage ou colline avec vue sur la côte fait l’affaire. Les plages publiques de Belle Mare, Grand Baie, Mont Choisy et Flic en Flac sont les plus animées, avec des familles qui y font la fête dès l’après-midi.',
      },
      {
        q: 'Les excursions ont-elles lieu le jour de Noël et le jour de l’An ?',
        a: 'Certaines oui, d’autres non, selon les équipages et les chauffeurs. Écrivez-nous avant de réserver une sortie le 25 ou le 31 décembre, ou le 1er ou le 2 janvier, et nous vous confirmerons la date. Les autres jours des fêtes, les sorties ont lieu normalement.',
      },
      {
        q: 'Quel temps fait-il à Noël à l’île Maurice ?',
        a: 'C’est l’été : maximales de 29 à 31 °C sur la côte, nuits chaudes et mer à 27–28 °C. Attendez-vous à de courtes averses tropicales plutôt qu’à des journées grises. Un cyclone en décembre est rare, et si nous annulons une sortie à cause de la météo, vous choisissez une nouvelle date sans frais ou un remboursement intégral.',
      },
    ],
  },
  'mauritius-in-january': {
    title: 'L’île Maurice en janvier 2027 : météo, cyclones et que réserver',
    excerpt:
      'Janvier, c’est le cœur de l’été à Maurice : les journées les plus chaudes, la mer la plus chaude et le début de la saison des pluies. Voici ce que fait vraiment la météo, comment fonctionnent les cyclones et ce qu’il faut réserver.',
    sections: [
      {
        heading: 'Janvier 2027 en un coup d’œil',
        paragraphs: [
          '**Météo :** les semaines les plus chaudes de l’année. Maximales de 30 à 31 °C sur la côte, nuits autour de 23–24 °C, mer à 27–28 °C.',
          '**Pluie :** la saison humide commence. De janvier à mars tombent les plus fortes pluies, surtout en averses l’après-midi sur les hauteurs.',
          '**Ensoleillement :** de longues journées. Le soleil se lève vers 5 h 50 et se couche vers 19 h.',
          '**Jours fériés :** le Nouvel An le vendredi 1er et le samedi 2 janvier, puis le Thaipoosam Cavadee, attendu fin janvier. L’Abolition de l’esclavage suit le lundi 1er février.',
          '**Affluence :** chargé jusqu’au premier week-end de janvier, puis calme. Le reste du mois est l’une des périodes les plus tranquilles de l’été.',
          '**Cyclones :** janvier et février sont le cœur de la saison. La plupart des semaines passent sans avis, mais prévoyez une journée de souplesse.',
        ],
      },
      {
        heading: 'Quel temps fait-il en janvier ?',
        paragraphs: [
          'Janvier, c’est le plein été. Les journées sont chaudes et humides, le vent est faible et les lagons atteignent leur température la plus haute. Les nuits restent chaudes : un ventilateur ou la climatisation comptent plus qu’un pull.',
          'La pluie tombe en général en averses courtes et fortes, ou en orage qui se forme sur les hauteurs l’après-midi avant de se dissiper. Les matinées sont souvent lumineuses. Le plateau central, autour de Curepipe, est de loin la région la plus arrosée. La côte ouest, de Flic en Flac au Morne, est la plus sèche, et le nord est plus sec que l’est.',
          'Sur la côte est, près de Belle Mare, les averses arrivent de la mer et repartent, et la plupart passent en moins d’une heure. C’est pour cela que nos sorties en mer partent tôt : la matinée est en général le moment le plus calme et le plus dégagé de la journée.',
          'Le soleil est à son maximum. Utilisez une crème solaire respectueuse des coraux, portez un chapeau et un lycra, et buvez beaucoup d’eau. Les moustiques sont plus actifs pendant la saison humide : prévoyez un répulsif pour les soirées.',
        ],
      },
      {
        heading: 'Les cyclones en janvier : ce qui se passe vraiment',
        paragraphs: [
          'La saison cyclonique va de novembre à avril, et janvier et février sont les mois où les cyclones sont les plus fréquents. Beaucoup d’étés passent sans avis de cyclone à Maurice, mais une tempête tropicale dans la région peut tout de même apporter un ou deux jours de vent, de mer agitée et de fortes pluies.',
          'Les services météorologiques de Maurice émettent des avis en quatre classes, avec plusieurs jours de prévisions avant l’arrivée d’une tempête. Tant qu’un avis est en vigueur, les bateaux restent au port. En classe III, les bureaux, les banques et la plupart de l’île ferment jusqu’à la levée de l’avis. Notre [guide de la saison cyclonique](/fr/blog/mauritius-cyclone-season) explique chaque classe et que faire.',
          'Si nous annulons une sortie à cause de la météo ou de l’état de la mer, vous choisissez entre une nouvelle date sans frais et un remboursement intégral. La plupart de nos sorties s’annulent aussi gratuitement jusqu’à la veille. Placez les sorties en mer au début du séjour pour pouvoir les reporter, et vérifiez que votre assurance voyage couvre les retards liés à la météo.',
        ],
      },
      {
        heading: 'Janvier est-il une bonne période pour partir à l’île Maurice ?',
        paragraphs: [
          'Oui, si vous cherchez la chaleur, une mer chaude et des plages plus calmes après le rush du Nouvel An. À partir de la deuxième semaine de janvier, les hôtels sont souvent moins chers qu’à Noël, et la plupart des sorties se réservent quelques jours avant.',
          'La contrepartie, c’est la pluie et le petit risque de cyclone. Si des vacances sèches et ventées comptent avant tout, mai à novembre vous conviendront mieux ; lisez notre guide [quand partir à l’île Maurice](/fr/blog/best-time-to-visit-mauritius). Si vous aimez la chaleur et l’eau, janvier est un bon mois pour le snorkeling et la plongée dès que la mer est calme.',
          'Organisez-vous avec la météo, pas contre elle : les sorties en mer le matin et en début de séjour, les visites et les musées les jours d’averses, et une journée libre.',
        ],
      },
      {
        heading: 'Fêtes et jours fériés en janvier',
        paragraphs: [
          '**Nouvel An, 1er et 2 janvier :** deux jours fériés après la nuit la plus bruyante de l’année. Les familles rendent visite à leurs proches et remplissent les plages publiques. Lisez [Noël et Nouvel An à l’île Maurice](/fr/blog/christmas-and-new-year-in-mauritius) pour savoir ce qui se passe et ce qui ferme.',
          '**Thaipoosam Cavadee :** une fête tamoule et un jour férié, attendu fin janvier 2027 ; le gouvernement en confirme la date chaque année. Après des jours de jeûne, les fidèles marchent jusqu’aux temples en portant le _cavadee_, une arche en bois décorée de fleurs et de pots de lait, et certains se percent les joues ou la langue de fines aiguilles. Les processions commencent tôt le matin.',
          '**Juste après janvier :** l’Abolition de l’esclavage le lundi 1er février, et la fête du Printemps chinois le samedi 6 février 2027, avec danses du dragon et pétards dans le Chinatown de Port-Louis. Les banques et les bureaux ferment ces jours fériés ; écrivez-nous si vous voulez une sortie l’un de ces jours.',
        ],
      },
      {
        heading: 'Que réserver en janvier, avec les prix',
        paragraphs: [
          'Des matinées calmes et une mer chaude font de janvier un mois pour l’eau, avec un plan pour les jours d’averses. Les prix sont ceux de nos pages de réservation en octobre 2026 :',
          '**L’île aux Cerfs en catamaran :** environ 7 heures avec la cascade, le snorkeling et un déjeuner barbecue à bord, [à partir de 55 € par personne](/fr/activities/catamaran-cruise-ile-aux-cerfs).',
          '**Nager avec les dauphins :** une sortie tôt le matin dans la baie de Tamarin, sur la côte ouest abritée, [à partir de 45 € par personne](/fr/activities/swimming-with-dolphins).',
          '**Sous la mer :** le [sous-marin et le subscooter Blue Safari](/fr/activities/blue-safari-submarine-subscooter) à partir de 125 €, ou la [marche sous-marine](/fr/activities/underwater-sea-walk-excursion) à partir de 40 €. La pluie en surface change peu de chose à quelques mètres de profondeur : ce qui compte, c’est le vent et la houle, et l’opérateur décide le matin même.',
          '**Une visite en voiture privée les jours d’averses :** la [visite avec dégustation de thé](/fr/activities/tea-tasting-tour) à l’usine et au musée de Bois Chéri, à Saint Aubin et à La Vanille, ou la [visite de Port-Louis](/fr/activities/port-louis-city-tour) avec le Caudan Waterfront et l’Odysseo Oceanarium, chacune à partir de 90 € la voiture avec chauffeur. D’autres idées dans [que faire à l’île Maurice quand il pleut](/fr/blog/things-to-do-in-mauritius-when-it-rains).',
          '**Les cascades au plus fort :** les pluies d’été gonflent les chutes de Chamarel et des gorges de Rivière Noire. Admirez-les depuis les points de vue du [circuit sud](/fr/activities/south-tour-mauritius), à partir de 90 € la voiture avec chauffeur.',
          '**Vu du ciel :** par une matinée dégagée, l’[hydravion au-dessus de la cascade sous-marine](/fr/activities/seaplane), à partir de 205 € par personne.',
        ],
      },
      {
        heading: 'Arriver en janvier',
        paragraphs: [
          'L’aéroport se trouve dans le sud-est, près de Mahébourg. Belle Mare est à environ 50 minutes de route et Grand Baie à environ 75. Nos [transferts aéroport](/fr/airport-transfers) commencent à 40 € par voiture, à un prix fixe convenu à la réservation.',
          'Les premiers jours de janvier sont chargés de départs après les fêtes : prévoyez de la marge sur la route de l’aéroport. Vous arrivez avant le Nouvel An ? Lisez [l’île Maurice en décembre](/fr/blog/mauritius-in-december) pour les dates des fêtes et le bon moment pour réserver.',
        ],
      },
      {
        heading: 'Bagages et conseils pratiques',
        paragraphs: [
          'Prévoyez des vêtements légers et respirants, une veste de pluie légère ou un petit parapluie, un chapeau, une crème solaire respectueuse des coraux et un répulsif anti-moustiques. Un sac étanche protège votre téléphone en mer et sous les averses soudaines.',
          'Placez les sorties qui vous tiennent le plus à cœur dans la première moitié du séjour, et le matin. Si la météo en décale une, il vous reste des jours pour la reporter.',
          'Envie d’un coup de main pour organiser vos journées ? Écrivez-nous sur WhatsApp avec vos dates et votre lieu de séjour, et nous vous proposerons un programme adapté à la météo de la semaine.',
        ],
      },
    ],
    faq: [
      {
        q: 'Janvier est-il une bonne période pour aller à l’île Maurice ?',
        a: 'Oui, si vous aimez la chaleur et une mer chaude. Janvier est chaud et humide, avec l’eau la plus chaude de l’année et des plages plus calmes après la première semaine. C’est aussi le début de la saison des pluies et le cœur de la saison cyclonique : gardez une journée libre.',
      },
      {
        q: 'Quel temps fait-il à l’île Maurice en janvier ?',
        a: 'Comptez 30 à 31 °C en journée sur la côte, des nuits autour de 23–24 °C et une mer à 27–28 °C. La pluie tombe en averses courtes et fortes, surtout l’après-midi et sur le plateau central. La côte ouest est la plus sèche.',
      },
      {
        q: 'Pleut-il tous les jours à l’île Maurice en janvier ?',
        a: 'Pas en général. Les averses sont fréquentes mais courtes, et beaucoup de journées commencent par une matinée ensoleillée avant que les nuages ne se forment sur les hauteurs. Le plateau central reçoit bien plus de pluie que les côtes : rejoindre la côte ouest, c’est souvent rejoindre le soleil.',
      },
      {
        q: 'Janvier est-il en saison cyclonique à Maurice ?',
        a: 'Oui. La saison cyclonique va de novembre à avril, et janvier et février sont les mois les plus exposés. Les avis sont émis plusieurs jours à l’avance, les bateaux restent au port tant qu’un avis est en vigueur, et si nous annulons une sortie, vous choisissez une nouvelle date sans frais ou un remboursement intégral.',
      },
      {
        q: 'Faut-il réserver ses excursions à l’avance en janvier ?',
        a: 'Réservez deux à trois semaines à l’avance pour les premiers jours de janvier, qui font encore partie du rush des fêtes. Ensuite, quelques jours avant suffisent en général. La plupart des sorties s’annulent gratuitement jusqu’à la veille.',
      },
    ],
  },
  'things-to-do-in-mauritius-when-it-rains': {
    title: 'Que faire à l’île Maurice quand il pleut ?',
    excerpt:
      'À Maurice, la pluie dure rarement toute la journée, et elle tombe rarement partout à la fois. Voici où trouver le soleil, et les meilleures choses à faire à l’abri pendant qu’une averse passe.',
    sections: [
      {
        heading: 'D’abord, regardez où il pleut',
        paragraphs: [
          'Maurice est petite, mais la météo change en quelques kilomètres. Le plateau central, autour de Curepipe, reçoit plusieurs fois plus de pluie que la côte, et les alizés du sud-est poussent les averses sur les côtes est et sud. La côte ouest, de Flic en Flac au Morne, est abritée par les montagnes : c’est la partie la plus sèche de l’île.',
          'Le premier plan pour un jour de pluie, c’est donc la route. Depuis Belle Mare, comptez un peu plus d’une heure jusqu’à la côte ouest, où il fait souvent beau quand l’est est gris. Les averses sont aussi courtes : une matinée pluvieuse se dégage souvent avant midi.',
          'Avant de changer vos plans, consultez les prévisions et le radar de pluie des services météorologiques de Maurice. Si vous êtes en sortie avec l’un de nos chauffeurs, demandez-lui : il observe le ciel tous les jours et adaptera l’itinéraire pour suivre le soleil.',
        ],
      },
      {
        heading: 'Passez la journée à Port-Louis',
        paragraphs: [
          'La capitale est la meilleure base par temps de pluie, parce qu’une grande partie se visite à l’abri. Le marché central est couvert, avec ses fruits, ses épices et ses stands de cuisine de rue, et le Caudan Waterfront réunit boutiques, cafés et le Blue Penny Museum, qui abrite les célèbres timbres de Maurice.',
          'Tout près se trouvent Chinatown ; l’Aapravasi Ghat, l’ancien dépôt d’immigration où sont arrivés les travailleurs engagés venus d’Inde au XIXe siècle, inscrit au patrimoine mondial de l’UNESCO ; et l’Odysseo Oceanarium, un aquarium couvert consacré à la vie marine de l’océan Indien.',
          'Notre [visite de Port-Louis](/fr/activities/port-louis-city-tour) passe par le Caudan Waterfront, Chinatown, la Citadelle, l’Odysseo Oceanarium et un temple tamoul, à partir de 90 € la voiture avec chauffeur. Lisez notre [guide de Port-Louis](/fr/blog/port-louis-things-to-do) pour aller plus loin.',
        ],
      },
      {
        heading: 'Dégustations de thé, de sucre et de rhum',
        paragraphs: [
          'Le sud abrite la dégustation la plus connue de l’île. À l’usine et au musée du thé de Bois Chéri, vous découvrez comment le thé est cultivé et transformé, puis vous goûtez les thés du domaine avec vue sur la plantation. Notre [visite avec dégustation de thé](/fr/activities/tea-tasting-tour) ajoute Saint Aubin et le parc de La Vanille, à partir de 90 € la voiture avec chauffeur.',
          'Le sucre a fait Maurice. L’Aventure du Sucre, une ancienne sucrerie de Pamplemousses, en raconte l’histoire et se termine par une dégustation de sucres non raffinés et de rhums. Dans le sud-ouest, la Rhumerie de Chamarel distille son rhum directement à partir du jus de canne et propose visites et dégustations.',
          'Les deux sont des étapes faciles d’un [road trip sur mesure](/fr/activities/custom-road-trip), où vous choisissez les lieux et le chauffeur organise l’itinéraire, à partir de 95 €.',
        ],
      },
      {
        heading: 'Musées et vieilles demeures',
        paragraphs: [
          'Mahébourg, sur la côte sud-est, est chargée d’histoire et parfaite par temps de pluie. Le Musée d’histoire nationale, installé dans une demeure coloniale française du XVIIIe siècle, couvre les époques hollandaise, française et britannique, et le musée Frederik Hendrik se dresse sur le site du premier établissement hollandais, à Vieux Grand Port.',
          'Tout près, la biscuiterie Rault fabrique ses biscuits de manioc à la main depuis 1870 et montre aux visiteurs comment. Ces trois lieux sont des étapes de notre [circuit privé sud-est](/fr/activities/private-south-east-tour), avec le front de mer de Mahébourg et Blue Bay, à partir de 90 € la voiture avec chauffeur.',
          'Plus à l’intérieur des terres, Eureka, à Moka, est une maison créole du XIXe siècle dont les pièces sont toujours meublées, à peu de distance de Port-Louis.',
        ],
      },
      {
        heading: 'Passez sous la mer',
        paragraphs: [
          'La pluie en surface change peu de chose à quelques mètres de profondeur. Si la mer est calme, les sorties sous-marines ont lieu même sous une pluie légère : le [sous-marin et le subscooter Blue Safari](/fr/activities/blue-safari-submarine-subscooter) dans le nord à partir de 125 €, ou la [marche sous-marine](/fr/activities/underwater-sea-walk-excursion) à partir de 40 €, où l’on marche sur le fond avec un casque de plongée.',
          'Ce qui arrête les bateaux, c’est le vent et la houle, pas la pluie. Les opérateurs décident le matin même, et si nous annulons une sortie à cause de la météo ou de l’état de la mer, vous choisissez entre une nouvelle date sans frais et un remboursement intégral.',
        ],
      },
      {
        heading: 'Voyez les cascades sous leur meilleur jour',
        paragraphs: [
          'La pluie est une bonne nouvelle pour les cascades. Après une nuit humide, les chutes de Chamarel et les chutes d’Alexandra, dans les gorges de Rivière Noire, sont au plus fort, et la forêt est à son plus vert. Les deux points de vue sont à quelques minutes à pied du parking : vous pouvez les voir entre deux averses.',
          'Évitez les sentiers de randonnée pendant et juste après de fortes pluies : les chemins deviennent glissants et les rivières montent vite. Le [circuit sud](/fr/activities/south-tour-mauritius) s’arrête à Chamarel et au point de vue des gorges de Rivière Noire, à partir de 90 € la voiture avec chauffeur. Voir aussi notre [guide des cascades](/fr/blog/best-waterfalls-in-mauritius).',
        ],
      },
      {
        heading: 'Shopping et cuisine à l’abri',
        paragraphs: [
          'Maurice offre un bon shopping pour un après-midi pluvieux. Bagatelle Mall, à Moka, est l’un des plus grands centres commerciaux, le Caudan Waterfront mêle boutiques et port, et Floréal compte des magasins d’usine pour la maille et les vêtements.',
          'Notre [journée shopping privée](/fr/activities/private-shopping-tour) passe par le magasin d’usine de Floréal, Bagatelle Mall et le Caudan Waterfront, à la journée ou à la demi-journée, à partir de 90 € la voiture avec chauffeur.',
          'La pluie est aussi une bonne excuse pour manger. Goûtez un dholl puri, des gâteaux piments et un cari au marché, ou réservez une table pour un long déjeuner créole. Nos guides de la [cuisine mauricienne](/fr/blog/mauritian-food-dishes) et de la [cuisine de rue](/fr/blog/street-food-mauritius) vous disent quoi commander.',
        ],
      },
      {
        heading: 'Un jour de pluie avec chauffeur',
        paragraphs: [
          'Un chauffeur privé est le plan le plus simple pour un jour de pluie. Vous gardez la voiture toute la journée, changez l’ordre des étapes quand une averse arrive, et terminez sur la côte si le soleil revient. Nos visites en voiture partent de votre hôtel.',
          'Envoyez-nous votre hôtel et la date sur WhatsApp, et nous vous proposerons un itinéraire adapté aux prévisions. Vous voyagez pendant la saison humide ? Lisez [l’île Maurice en janvier](/fr/blog/mauritius-in-january) et notre [guide de la saison cyclonique](/fr/blog/mauritius-cyclone-season).',
        ],
      },
    ],
    faq: [
      {
        q: 'Que faire à l’île Maurice quand il pleut ?',
        a: 'Rejoignez la côte ouest, plus sèche, passez la journée à Port-Louis entre le marché, le Caudan Waterfront et l’Odysseo Oceanarium, faites une dégustation de thé ou de rhum, visitez les musées de Mahébourg, faites du shopping à Bagatelle Mall, ou passez sous la mer en sous-marin si la mer est calme.',
      },
      {
        q: 'Pleut-il toute la journée à l’île Maurice ?',
        a: 'Rarement. La pluie tombe en général en averses courtes et fortes, souvent l’après-midi, et beaucoup de matinées pluvieuses se dégagent avant midi. Le plateau central est bien plus arrosé que les côtes.',
      },
      {
        q: 'Quelle est la région la moins pluvieuse de l’île Maurice ?',
        a: 'La côte ouest, de Flic en Flac au Morne, est la partie la plus sèche de l’île. Le plateau central, autour de Curepipe, est le plus arrosé, et les côtes est et sud reçoivent plus d’averses que l’ouest.',
      },
      {
        q: 'Quelle est la saison des pluies à l’île Maurice ?',
        a: 'L’été, de novembre à avril, est la saison la plus humide, et c’est de janvier à mars qu’il pleut le plus. De mai à octobre, il fait plus frais et plus sec.',
      },
      {
        q: 'Les sorties en bateau ont-elles lieu sous la pluie ?',
        a: 'En général oui, sous une pluie légère. Ce qui arrête un bateau, c’est un vent fort ou une mer agitée. L’opérateur décide le matin même, et si nous annulons à cause de la météo ou de l’état de la mer, vous choisissez une nouvelle date sans frais ou un remboursement intégral.',
      },
    ],
  },
};
