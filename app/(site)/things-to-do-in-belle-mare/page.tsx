import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { Breadcrumb } from '@/components/catalogue/Breadcrumb';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  ContentSection,
  InlineLink,
  FaqAccordion,
  FeaturedTours,
  RelatedLinks,
  BookDirectCta,
} from '@/components/seo/LandingSections';
import { breadcrumbListJsonLd, faqPageJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { belleMareActivityGroups } from '@/lib/seo/landing';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import { getT, getLocale } from '@/lib/i18n/server';

export const runtime = 'edge';

/* The local "belle mare things to do / belle mare activities" landing page. ONE page deliberately
   covers that whole query cluster — the two searches share an intent (and a SERP), and splitting them
   across near-duplicate pages would cannibalise this domain's thin early authority. The island-wide
   sibling is /attractions; the area overview (where to stay, who it suits) is /destinations/belle-mare —
   this page is the activity-first middle: what to actually DO from a Belle Mare base. */

const PATH = '/things-to-do-in-belle-mare';
const TITLE = 'Things to Do in Belle Mare — Best Activities, Beaches & Day Trips';
const DESCRIPTION =
  'The best things to do in Belle Mare, Mauritius — beach and lagoon activities, Île aux Cerfs boat trips, catamaran cruises, kitesurfing, golf and day tours, from the licensed local operator based right here on the east coast.';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'Belle Mare things to do',
    'things to do in Belle Mare',
    'Belle Mare activities',
    'Belle Mare Mauritius',
    'Belle Mare excursions',
    'what to do in Belle Mare',
  ],
  alternates: { canonical: PATH },
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE.url}${PATH}`,
    locale: 'en_GB',
    images: [OG_IMAGE],
  },
};

const FAQS_EN = [
  {
    q: 'What are the best things to do in Belle Mare?',
    a: 'Start with the beach itself — Belle Mare Public Beach is one of the longest white-sand stretches on the island, with a calm, shallow lagoon that is ideal for swimming and snorkelling. From there the classics are a boat or catamaran trip to Île aux Cerfs, a glass-bottom boat or snorkel over the reef, kitesurfing or windsurfing on the trade winds, a round of golf at Constance Belle Mare Plage’s Legend or Links courses, and day tours to the island’s south or north with a local driver-guide.',
  },
  {
    q: 'How do I get to Île aux Cerfs from Belle Mare?',
    a: 'Boats leave from Trou d’Eau Douce, just down the coast from Belle Mare — about 15 minutes by road. You can go by speedboat or spend the day on a catamaran cruise, usually with snorkelling, the GRSE waterfall and a barbecue lunch included. We run both, with pickup from Belle Mare hotels.',
  },
  {
    q: 'Do your tours pick up from Belle Mare hotels?',
    a: 'Yes — every tour, boat trip and transfer we run includes door-to-door pickup. We are based in Belle Mare itself, so east-coast pickups are the quickest on the island, and we collect from hotels, villas and guesthouses island-wide too.',
  },
  {
    q: 'Is Belle Mare good for families?',
    a: 'Very. The lagoon is shallow, calm and protected by the reef, the public beach has natural shade from filao trees, and gentle activities like glass-bottom boat trips and Île aux Cerfs sandbanks suit all ages. Day tours are private, so the pace is set by your family, not a coach schedule.',
  },
  {
    q: 'What can you do in Belle Mare when it’s windy?',
    a: 'The steady south-east trade winds are part of Belle Mare’s character — kitesurfers and windsurfers plan trips around them. If you would rather escape the breeze, that is the day for an inland tour: the south’s waterfalls and viewpoints, the central plateau, or the sheltered west coast for a dolphin swim.',
  },
  {
    q: 'Is Belle Mare a good base for exploring Mauritius?',
    a: 'Yes — the airport is roughly 45–60 minutes away, Île aux Cerfs is on your doorstep, and the wild south-east coast is an easy day trip. The north and west are further, but with a private driver-guide or a rental car every corner of the island is reachable in a day.',
  },
];

// French copy of FAQS_EN, same order/length — feeds both the visible accordion and faqPageJsonLd() so the two can never drift apart (see the file header comment in LandingSections.tsx).
const FAQS_FR = [
  {
    q: 'Quelles sont les meilleures choses à faire à Belle Mare ?',
    a: 'Commencez par la plage elle-même — Belle Mare Public Beach est l’une des plus longues étendues de sable blanc de l’île, avec un lagon calme et peu profond, idéal pour la baignade et le snorkeling. À partir de là, les grands classiques sont une sortie en bateau ou en catamaran vers l’Île aux Cerfs, une excursion en bateau à fond de verre ou du snorkeling sur le récif, du kitesurf ou de la planche à voile porté par les alizés, une partie de golf sur les parcours Legend ou Links du Constance Belle Mare Plage, et des excursions à la journée vers le sud ou le nord de l’île avec un chauffeur-guide local.',
  },
  {
    q: 'Comment se rendre à l’Île aux Cerfs depuis Belle Mare ?',
    a: 'Les bateaux partent de Trou d’Eau Douce, un peu plus loin sur la côte depuis Belle Mare — environ 15 minutes par la route. Vous pouvez y aller en vedette rapide ou passer la journée lors d’une croisière en catamaran, généralement avec snorkeling, la cascade GRSE et un déjeuner barbecue inclus. Nous proposons les deux, avec prise en charge depuis les hôtels de Belle Mare.',
  },
  {
    q: 'Vos excursions assurent-elles la prise en charge dans les hôtels de Belle Mare ?',
    a: 'Oui — chaque excursion, sortie en bateau et transfert que nous organisons inclut la prise en charge porte à porte. Nous sommes basés à Belle Mare même, donc les prises en charge sur la côte est sont les plus rapides de l’île, et nous assurons aussi la prise en charge depuis les hôtels, villas et guesthouses sur toute l’île.',
  },
  {
    q: 'Belle Mare convient-elle aux familles ?',
    a: 'Tout à fait. Le lagon est peu profond, calme et protégé par le récif, la plage publique offre une ombre naturelle grâce aux filaos, et des activités douces comme les excursions en bateau à fond de verre et les bancs de sable de l’Île aux Cerfs conviennent à tous les âges. Les excursions à la journée sont privées, c’est donc le rythme de votre famille qui prime, pas celui d’un autocar.',
  },
  {
    q: 'Que faire à Belle Mare quand il y a du vent ?',
    a: 'Les alizés constants du sud-est font partie du caractère de Belle Mare — les kitesurfeurs et véliplanchistes organisent leurs sorties autour d’eux. Si vous préférez échapper au vent, c’est le moment idéal pour une excursion dans les terres : les cascades et points de vue du sud, le plateau central, ou la côte ouest abritée pour une baignade avec les dauphins.',
  },
  {
    q: 'Belle Mare est-elle une bonne base pour explorer Maurice ?',
    a: 'Oui — l’aéroport se trouve à environ 45–60 minutes, l’Île aux Cerfs est presque à votre porte, et la côte sud-est sauvage est une excursion facile à la journée. Le nord et l’ouest sont plus éloignés, mais avec un chauffeur-guide privé ou une voiture de location, chaque coin de l’île est accessible en une journée.',
  },
];

export default async function ThingsToDoInBelleMarePage() {
  const t = await getT();
  const locale = await getLocale();
  const FAQS = locale === 'fr' ? FAQS_FR : FAQS_EN;
  const groups = await belleMareActivityGroups();
  const allActivities = groups.flatMap((g) => g.activities);
  const homeLabel = t('Home');
  const pageLabel = t('Things to do in Belle Mare');

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: homeLabel, path: '/' },
          { name: pageLabel, path: PATH },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      {allActivities.length > 0 && (
        <JsonLd
          data={itemListJsonLd(
            allActivities.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })),
          )}
        />
      )}

      <InfoPage
        eyebrow={t('Belle Mare · east coast Mauritius')}
        title={pageLabel}
        intro={t(
          "Beach days, Île aux Cerfs boat trips, lagoon activities, golf and island day tours — a local's guide to Belle Mare, from the licensed operator based right here on the east coast.",
        )}
        meta={t('Written by {operator} · based in Belle Mare · rated 4.8/5 from 1,000+ reviews.', {
          operator: SITE.operator,
        })}
      >
        <Breadcrumb trail={[{ label: homeLabel, href: '/' }]} current={pageLabel} />

        <ContentSection id="why" title={t("Why Belle Mare is the east coast's best base")}>
          {locale === 'fr' ? (
            <p>
              Belle Mare est une longue bande côtière peu élevée, réputée pour l’un des sables les
              plus blancs de l’île et un vaste lagon turquoise protégé par le récif. Elle est plus
              calme et plus verdoyante que le nord animé — des resorts cinq étoiles, du golf de
              championnat et une plage publique célèbre bordée de filaos et de casuarinas — tout en
              étant assez proche de Trou d’Eau Douce pour que l’excursion la plus célèbre de l’île,
              l’Île aux Cerfs, soit pratiquement à votre porte. Découvrez le guide complet de la
              région sur la page{' '}
              <InlineLink href="/destinations/belle-mare">Belle Mare, Maurice</InlineLink>, ou
              faites connaissance avec l’équipe locale derrière ce site sur{' '}
              <InlineLink href="/belle-mare-tours">Belle Mare Tours</InlineLink>.
            </p>
          ) : (
            <p>
              Belle Mare is a long, low-rise stretch of coast known for some of the island’s whitest
              sand and a wide turquoise lagoon protected by the reef. It is calmer and greener than
              the busy north — five-star resorts, championship golf and a famous public beach backed
              by casuarina and filao trees — yet close enough to Trou d’Eau Douce that the island’s
              most famous day trip, Île aux Cerfs, is practically on your doorstep. Read the full
              area guide at{' '}
              <InlineLink href="/destinations/belle-mare">Belle Mare, Mauritius</InlineLink>, or
              meet the local team behind this site at{' '}
              <InlineLink href="/belle-mare-tours">Belle Mare Tours</InlineLink>.
            </p>
          )}
        </ContentSection>

        <ContentSection id="best-time" title={t('Best time to visit Belle Mare')}>
          {locale === 'fr' ? (
            <p>
              La côte est est à son meilleur de mai à décembre, quand les alizés sont réguliers, les
              précipitations restent faibles et le lagon reste plat et limpide — la période
              d’octobre à décembre est la plus sèche et la plus chaude de cette fenêtre. Ce sont ces
              mêmes alizés qui attirent les kitesurfeurs et véliplanchistes à Belle Mare : ils
              soufflent le plus régulièrement de mai à septembre, avril à mi-octobre étant la saison
              principale pour la navigation en eau plate. La période de novembre à avril correspond
              à la saison cyclonique, avec le plus fort risque de système direct entre janvier et
              mars ; la plupart des années apportent des tempêtes tropicales et des pluies plus
              fortes plutôt qu’un impact direct, mais il est utile de prévoir un peu de flexibilité
              pour une réservation faite durant cette période. En dehors des tempêtes, la mer
              descend rarement sous les 23 °C même pendant les mois les plus frais — il n’y a donc
              pas de mauvais moment pour se baigner, seulement un meilleur moment pour composer avec
              le vent et la pluie.
            </p>
          ) : (
            <p>
              The east coast is at its best from May to December, when the trade winds are steady,
              rainfall stays low and the lagoon runs flat and clear — October to December is the
              driest, warmest stretch within that window. Those same trade winds are why Belle Mare
              draws kitesurfers and windsurfers: they blow most reliably from May to September, with
              April through mid-October the core season for flat-water sailing. November to April is
              cyclone season, with the highest chance of a direct system in January to March; most
              years bring tropical storms and heavier rain rather than a direct hit, but it is worth
              building some flexibility into a booking made for that stretch. Outside of storms, the
              sea rarely drops below 23°C even in the coolest months, so there is no bad time to
              swim — only a best time to plan around the wind and the rain.
            </p>
          )}
        </ContentSection>

        {groups.map((group) => (
          <FeaturedTours
            key={group.title}
            title={group.title}
            intro={group.intro}
            activities={group.activities}
          />
        ))}

        <ContentSection id="beach" title={t('The beach & the lagoon')}>
          {locale === 'fr' ? (
            <p>
              Belle Mare Public Beach est le premier arrêt évident : un long ruban de sable blanc
              fin, avec une eau calme et peu profonde et une ombre naturelle, faite pour les
              matinées tranquilles et les longues baignades. Palmar Beach, juste à côté, est plus
              tranquille, et le village de pêcheurs de Trou d’Eau Douce se trouve à une courte
              distance au sud. Sur l’eau, le lagon offre tout — snorkeling et excursions en bateau à
              fond de verre sur le récif, ainsi que des alizés du sud-est réguliers qui font de cet
              endroit l’un des plus fiables de l’île pour le kitesurf et la planche à voile sur une
              eau plate et protégée. Juste en retrait du sable, sur Coastal Road, Splash n Fun
              Leisure Park ajoute des toboggans aquatiques sur le thème des pirates et des piscines
              — une bonne option pour les enfants, ou pour toute journée où la mer est trop agitée
              pour en profiter.
            </p>
          ) : (
            <p>
              Belle Mare Public Beach is the obvious first stop: a long ribbon of fine white sand
              with shallow, calm water and natural shade, made for slow mornings and long swims.
              Palmar Beach next door is quieter, and the fishing village of Trou d’Eau Douce is a
              short ride south. On the water, the lagoon does everything — snorkelling and
              glass-bottom boat trips over the reef, and steady south-east trade winds that make
              this one of the island’s most reliable spots for kitesurfing and windsurfing on flat,
              protected water. Just back from the sand on Coastal Road, Splash n Fun Leisure Park
              adds pirate-themed water slides and pools — a good option for kids, or any day the sea
              is too rough to enjoy.
            </p>
          )}
        </ContentSection>

        <ContentSection id="ile-aux-cerfs" title={t('Île aux Cerfs — the classic day out')}>
          {locale === 'fr' ? (
            <p>
              L’excursion emblématique de la côte est part tout près d’ici : plages sur bancs de
              sable, arrêts snorkeling et la cascade Grand River South East, en{' '}
              <InlineLink href="/ile-aux-cerfs-tours">vedette rapide</InlineLink> si vous voulez
              voir toute l’île en une demi-journée, ou en{' '}
              <InlineLink href="/mauritius-catamaran-cruise">croisière en catamaran</InlineLink>{' '}
              avec un déjeuner barbecue à bord si vous préférez profiter pleinement de la
              navigation. Étant basés à Belle Mare, nos prises en charge pour l’embarcadère sont les
              plus courtes de l’île.
            </p>
          ) : (
            <p>
              The east coast’s signature trip leaves from just down the road: sandbank beaches,
              snorkelling stops and the Grand River South East waterfall, by{' '}
              <InlineLink href="/ile-aux-cerfs-tours">speedboat</InlineLink> if you want the whole
              island in half a day, or by{' '}
              <InlineLink href="/mauritius-catamaran-cruise">catamaran cruise</InlineLink> with a
              barbecue lunch on board if you would rather make the sailing the point. Being based in
              Belle Mare, our pickups for the jetty are the shortest on the island.
            </p>
          )}
        </ContentSection>

        <ContentSection id="day-trips" title={t('Day trips from Belle Mare')}>
          {locale === 'fr' ? (
            <p>
              Une fois que vous avez profité du lagon, le reste de l’île n’est qu’à une excursion
              privée à la journée : le sud sauvage avec ses cascades, ses points de vue et son
              cratère volcanique, la capitale et le jardin botanique au nord, ou une{' '}
              <InlineLink href="/dolphin-swim-mauritius">
                baignade matinale avec les dauphins sauvages
              </InlineLink>{' '}
              au large de la côte ouest. Plus près d’ici, il y a les sentiers forestiers tranquilles
              du Bras d’Eau National Park, la ville de marché de Centre de Flacq, et du golf de
              championnat — The Legend et The Links au Constance Belle Mare Plage juste sur la côte,
              ou Anahita et l’Île aux Cerfs Golf Club un peu plus loin. Parcourez la{' '}
              <InlineLink href="/mauritius-tours">
                liste complète des excursions à la journée
              </InlineLink>{' '}
              ou le guide de l’île entière sur les{' '}
              <InlineLink href="/attractions">choses à faire à Maurice</InlineLink>.
            </p>
          ) : (
            <p>
              When you have had your fill of the lagoon, the rest of the island is a private day
              tour away: the wild south with its waterfalls, viewpoints and volcanic crater, the
              north’s capital and botanical garden, or an early-morning{' '}
              <InlineLink href="/dolphin-swim-mauritius">swim with wild dolphins</InlineLink> off
              the west coast. Closer to home there is Bras d’Eau National Park’s quiet forest
              trails, the market town of Centre de Flacq, and championship golf — The Legend and The
              Links at Constance Belle Mare Plage right on the coast, or Anahita and Île aux Cerfs
              Golf Club a little further out. Browse the{' '}
              <InlineLink href="/mauritius-tours">full list of day tours</InlineLink> or the
              island-wide guide to{' '}
              <InlineLink href="/attractions">things to do in Mauritius</InlineLink>.
            </p>
          )}
        </ContentSection>

        <ContentSection id="dining" title={t('Where to eat near Belle Mare')}>
          {locale === 'fr' ? (
            <p>
              Belle Mare Public Beach a son propre stand de plage, Sun And Sand Chez Charlene, qui
              sert paella et mine frite à quelques pas du sable — difficile de trouver plus local
              pour déjeuner. Dans le village, Symon’s Restaurant propose cuisine indienne, chinoise,
              fruits de mer et grillades toute la journée, à des prix bien inférieurs à ceux des
              cartes des resorts. Pour quelque chose de plus chic, Beach Rouge au LUX* Belle Mare
              installe ses tables italiennes et de fruits de mer directement en bord de plage, et
              Dolce Vita à l’Ambre Resort &amp; Spa, tout près à Palmar, propose la même chose dans
              un cadre de trattoria. Plus bas sur la côte, à Trou d’Eau Douce, à environ 15 minutes
              par la route et une étape de toute{' '}
              <InlineLink href="/ile-aux-cerfs-tours">journée à l’Île aux Cerfs</InlineLink>, Chez
              Tino sert cuisine créole, chinoise et fruits de mer depuis 1989, et La Case Poisson
              grille au charbon de bois la pêche du jour — achetée directement auprès des pêcheurs
              locaux. Entre la plage publique, le village et Trou d’Eau Douce, vous n’êtes presque
              jamais à plus de dix minutes d’une table, que vous cherchiez un stand de plage ou une
              salle de restaurant d’hôtel.
            </p>
          ) : (
            <p>
              Belle Mare Public Beach has its own beach shack, Sun And Sand Chez Charlene, serving
              paella and mine frite a few steps from the sand — about as local as lunch gets. In the
              village, Symon’s Restaurant covers Indian, Chinese, seafood and grills all day at
              prices well below resort menus. For something dressier, Beach Rouge at LUX* Belle Mare
              puts Italian and seafood tables right on the beachfront, and Dolce Vita at Ambre
              Resort &amp; Spa in nearby Palmar does the same in a trattoria setting. Down the coast
              in Trou d’Eau Douce, about 15 minutes by road and a stop on any{' '}
              <InlineLink href="/ile-aux-cerfs-tours">Île aux Cerfs day</InlineLink>, Chez Tino has
              served Creole, Chinese and seafood since 1989, and La Case Poisson grills the day’s
              catch — bought straight off local fishermen — over charcoal. Between the public beach,
              the village and Trou d’Eau Douce, you are rarely more than ten minutes from a table,
              whether you want a beach shack or a resort dining room.
            </p>
          )}
        </ContentSection>

        <ContentSection id="getting-around" title={t('Getting around from Belle Mare')}>
          {locale === 'fr' ? (
            <p>
              Il n’existe pas de transport public pratique pour les visiteurs, prévoyez donc un
              moyen de locomotion : louez une{' '}
              <InlineLink href="/rent">voiture ou un scooter à Belle Mare</InlineLink> pour explorer
              en toute liberté, réservez une excursion privée à la journée et laissez le
              chauffeur-guide s’occuper de la route, ou optez pour un{' '}
              <InlineLink href="/airport-transfers">transfert aéroport</InlineLink> à prix fixe pour
              le trajet de 45 à 60 minutes vers ou depuis SSR International. Si vous aimez tout
              organiser, notre{' '}
              <InlineLink href="/ai-road-trip-planner">planificateur de road trip IA</InlineLink>{' '}
              gratuit construit une journée sur mesure autour des étapes que vous choisissez.
            </p>
          ) : (
            <p>
              There is no practical public transport for visitors, so plan on wheels: hire a{' '}
              <InlineLink href="/rent">car or scooter in Belle Mare</InlineLink> for independent
              exploring, book a private day tour and let the driver-guide handle the roads, or use a
              fixed-price <InlineLink href="/airport-transfers">airport transfer</InlineLink> for
              the 45–60 minute run to and from SSR International. If you like planning, our free{' '}
              <InlineLink href="/ai-road-trip-planner">AI road-trip planner</InlineLink> builds a
              custom day around the stops you pick.
            </p>
          )}
          <RelatedLinks
            links={[
              { label: t('Belle Mare area guide'), href: '/destinations/belle-mare' },
              { label: t('Car & scooter rental'), href: '/rent' },
              { label: t('Île aux Cerfs tours'), href: '/ile-aux-cerfs-tours' },
              { label: t('Catamaran cruises'), href: '/mauritius-catamaran-cruise' },
              { label: t('All Mauritius tours'), href: '/mauritius-tours' },
              { label: t('Airport transfers'), href: '/airport-transfers' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title={t('Belle Mare activities — FAQ')}>
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title={t('Book it all in one place')}>
          {locale === 'fr' ? (
            <p>
              Chaque activité de cette page peut être réservée en ligne, avec disponibilité en temps
              réel et prix fixes en euros — sans marge de revendeur, et l’opérateur qui répond à
              votre WhatsApp est celui-là même qui assure la prise en charge au ponton.
              Indiquez-nous vos dates et nous construirons la semaine autour d’elles.
            </p>
          ) : (
            <p>
              Every activity on this page can be booked online with live availability and fixed EUR
              prices — no reseller markup, and the operator answering your WhatsApp is the one
              driving the boatside pickup. Tell us your dates and we will build the week around
              them.
            </p>
          )}
          <BookDirectCta primary={{ href: '/activities', label: t('Browse all activities') }} />
        </ContentSection>

        <EnquireRow message="Hi Belle Mare Tours! I'm staying near Belle Mare — what do you recommend for my dates?" />
      </InfoPage>
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata(PATH, DEFAULT_METADATA);
}
