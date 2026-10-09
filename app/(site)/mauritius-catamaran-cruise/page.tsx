import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { Breadcrumb } from '@/components/catalogue/Breadcrumb';
import { ReviewList } from '@/components/catalogue/ReviewList';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  ContentSection,
  InlineLink,
  FaqAccordion,
  FeaturedTours,
  RelatedLinks,
  BookDirectCta,
} from '@/components/seo/LandingSections';
import { CatamaranComparison, catamaranPriceFacts } from '@/components/seo/CatamaranComparison';
import { Price } from '@/components/site/Price';
import { breadcrumbListJsonLd, faqPageJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { featuredActivities } from '@/lib/seo/landing';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import { categoryHref } from '@/lib/catalogue/category-hubs';
import { latestTopicReviews } from '@/lib/content/activity-reviews-pool';
import { TOPIC_STATS } from '@/lib/content/_review-stats.gen';
import { getT, getLocale } from '@/lib/i18n/server';
import { localePath } from '@/lib/i18n/routing';

export const runtime = 'edge';

const PATH = '/mauritius-catamaran-cruise';
const TITLE = 'Catamaran Cruises & Tours in Mauritius | Belle Mare Tours';
const DESCRIPTION =
  'Catamaran cruises in Mauritius, booked direct: snorkelling, a barbecue lunch on board and Île aux Cerfs or the northern islets. Shared or private, fixed prices.';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'Mauritius catamaran cruise',
    'catamaran cruise Mauritius',
    'catamaran Île aux Cerfs',
    'Mauritius boat trip',
    'private catamaran charter Mauritius',
  ],
  alternates: { canonical: PATH },
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE.url}${PATH}`,
    images: [OG_IMAGE],
  },
};

const FAQS_EN = [
  {
    q: 'What’s included on a catamaran cruise?',
    a: 'A typical full-day cruise includes hotel pickup, snorkelling stops with gear, a freshly grilled barbecue lunch on board, soft drinks and usually local beer and rum, plus time at a beach or island such as Île aux Cerfs. Each tour page lists the exact inclusions.',
  },
  {
    q: 'How long does a catamaran cruise last?',
    a: 'Most are full-day trips of around six to eight hours on the water, including the sail, snorkelling, lunch and island time. Shorter half-day and sunset cruises are available on some routes — check the individual tour for timings.',
  },
  {
    q: 'Where do the cruises go?',
    a: 'From the east coast, catamarans head to Île aux Cerfs and its lagoon. From the north, they visit the islets — Gabriel, Flat Island and Gunner’s Quoin. West-coast cruises sail the Tamarin and Le Morne coast, sometimes alongside dolphins. We’ll match the route to where you’re staying.',
  },
  {
    q: 'Which catamaran cruise should I choose?',
    a: 'Start from the coast nearest your hotel. In the east, the Île aux Cerfs cruise leaves from Trou d’Eau Douce; in the north, the northern islands cruise leaves from Grand Baie; in the west, the dolphin and Crystal Rock cruise leaves from Black River. Short on time? The two-hour sunset cruise from Grand Baie fits into an evening.',
  },
  {
    q: 'Can I book a private catamaran charter?',
    a: 'Yes. As well as shared cruises (more sociable and better value), we arrange fully private charters for families, groups, weddings and special occasions. Message us with your date and numbers for a fixed quote.',
  },
  {
    q: 'Is a catamaran cruise good for families and non-swimmers?',
    a: 'Very. Catamarans are stable and spacious, the lagoon is calm, and buoyancy aids are provided for snorkelling. Non-swimmers can relax on deck or wade from the sandbars. Tell us if you’re bringing young children and we’ll advise the best trip.',
  },
  {
    q: 'Will I get seasick on a catamaran?',
    a: 'Catamarans sit on two hulls, so they roll far less than a single-hull boat, and most of the day is spent inside the calm lagoon. The crossing to the northern islets is open sea and can be livelier: if you’re prone to seasickness, take a tablet before you board, stay in the middle of the deck and keep your eyes on the horizon.',
  },
  {
    q: 'What should I bring on a catamaran cruise?',
    a: 'Swimwear, a towel, reef-safe sun cream, a hat, sunglasses and a light layer for the sail home. Snorkelling gear is provided on the full-day cruises. A waterproof pouch for your phone is worth having.',
  },
  {
    q: 'When is the best time for a catamaran day?',
    a: 'Year-round. The lagoon is calmest in the morning, and winds pick up in the afternoon, so an earlier start usually means smoother water and fewer boats. We’ll suggest a departure that suits your route and the season.',
  },
];

// French copy of FAQS_EN, same order/length — feeds both the visible accordion and faqPageJsonLd() so the two can never drift apart (see the file header comment in LandingSections.tsx).
const FAQS_FR = [
  {
    q: 'Que comprend une croisière en catamaran ?',
    a: 'Une croisière type d’une journée complète comprend la prise en charge à l’hôtel, des arrêts snorkeling avec équipement, un déjeuner barbecue fraîchement grillé à bord, des boissons fraîches et généralement de la bière et du rhum locaux, ainsi qu’un moment sur une plage ou une île comme l’Île aux Cerfs. Chaque page d’excursion détaille les prestations exactes incluses.',
  },
  {
    q: 'Combien de temps dure une croisière en catamaran ?',
    a: 'La plupart sont des sorties d’une journée complète, d’environ six à huit heures en mer, incluant la navigation, le snorkeling, le déjeuner et le temps sur l’île. Des croisières plus courtes, d’une demi-journée ou au coucher du soleil, sont proposées sur certains itinéraires — vérifiez les horaires sur la page de chaque excursion.',
  },
  {
    q: 'Où vont les croisières ?',
    a: 'Depuis la côte est, les catamarans se dirigent vers l’Île aux Cerfs et son lagon. Depuis le nord, ils visitent les îlots — Gabriel, Flat Island et Gunner’s Quoin. Les croisières de la côte ouest longent la côte de Tamarin et Le Morne, parfois accompagnées de dauphins. Nous adaptons l’itinéraire à votre lieu de séjour.',
  },
  {
    q: 'Quelle croisière en catamaran choisir ?',
    a: 'Partez de la côte la plus proche de votre hôtel. À l’est, la croisière vers l’Île aux Cerfs part de Trou d’Eau Douce ; au nord, la croisière des îles du nord part de Grand Baie ; à l’ouest, la croisière dauphins et Crystal Rock part de Rivière Noire. Peu de temps ? La croisière de deux heures au coucher du soleil, depuis Grand Baie, tient dans une soirée.',
  },
  {
    q: 'Puis-je réserver un charter privé en catamaran ?',
    a: 'Oui. En plus des croisières partagées (plus conviviales et plus avantageuses), nous organisons des charters entièrement privés pour les familles, les groupes, les mariages et les occasions spéciales. Écrivez-nous votre date et le nombre de participants pour un devis à prix fixe.',
  },
  {
    q: 'Une croisière en catamaran convient-elle aux familles et aux non-nageurs ?',
    a: 'Tout à fait. Les catamarans sont stables et spacieux, le lagon est calme, et des aides à la flottaison sont fournies pour le snorkeling. Les non-nageurs peuvent se détendre sur le pont ou patauger depuis les bancs de sable. Précisez-nous si vous voyagez avec de jeunes enfants et nous vous conseillerons la meilleure excursion.',
  },
  {
    q: 'Vais-je avoir le mal de mer en catamaran ?',
    a: 'Un catamaran repose sur deux coques : il roule bien moins qu’un bateau classique, et l’essentiel de la journée se passe dans le lagon, à l’abri. La traversée vers les îlots du nord se fait en pleine mer et peut être plus agitée : si vous êtes sensible au mal de mer, prenez un comprimé avant d’embarquer, restez au milieu du pont et gardez les yeux sur l’horizon.',
  },
  {
    q: 'Que faut-il apporter pour une croisière en catamaran ?',
    a: 'Maillot de bain, serviette, crème solaire respectueuse des coraux, chapeau, lunettes de soleil et une couche légère pour le retour. Le matériel de snorkeling est fourni sur les croisières d’une journée. Une pochette étanche pour votre téléphone est bien utile.',
  },
  {
    q: 'Quel est le meilleur moment pour une journée en catamaran ?',
    a: 'Toute l’année. Le lagon est le plus calme le matin, et le vent se lève l’après-midi, donc un départ plus tôt signifie généralement une mer plus calme et moins de bateaux. Nous vous suggérerons un départ adapté à votre itinéraire et à la saison.',
  },
];

/**
 * Every catamaran trip we sell. "Catamaran cruises" holds the shared ones; the private catamarans sit
 * in "Private Cruises" alongside speedboats and dolphin trips, so only that category's catamarans
 * (matched on the slug, which doesn't change with the language) belong on this page.
 */
async function loadCatamarans() {
  const [shared, privateCruises] = await Promise.all([
    featuredActivities({ category: 'Catamaran cruises', q: 'catamaran', limit: 12 }),
    featuredActivities({ category: 'Private Cruises', limit: 24 }),
  ]);
  const seen = new Set(shared.map((a) => a.id));
  return [...shared, ...privateCruises.filter((a) => /catamaran/i.test(a.slug) && !seen.has(a.id))];
}

/** A quote under "What guests say about our catamaran cruises" must be about one — not the speedboat. */
function isAboutCatamarans(text: string): boolean {
  return /\bcatamarans?\b|\bcruises?\b/i.test(text) && !/\bspeed ?boats?\b/i.test(text);
}

export default async function MauritiusCatamaranCruisePage() {
  const t = await getT();
  const locale = await getLocale();
  const fr = locale === 'fr';
  const lp = (path: string) => localePath(locale, path);
  const FAQS = fr ? FAQS_FR : FAQS_EN;
  const catamarans = await loadCatamarans();
  const prices = catamaranPriceFacts(catamarans);
  // The newest guest reviews that mention our catamaran trips, under the honest aggregate of every
  // review on that topic (all stars, all languages) — see activity-reviews.ts.
  const reviewStats = TOPIC_STATS.catamaran;
  const reviews = latestTopicReviews({ category: 'Catamaran cruises' }, 3, isAboutCatamarans);
  const homeLabel = t('Home');
  const activitiesLabel = t('Activities');
  const pageLabel = t('Catamaran cruises');

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: homeLabel, path: lp('/') },
          { name: activitiesLabel, path: lp('/activities') },
          { name: pageLabel, path: lp(PATH) },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      {catamarans.length > 0 && (
        <JsonLd
          data={itemListJsonLd(
            catamarans.map((a) => ({ name: a.title, path: lp(`/activities/${a.slug}`) })),
          )}
        />
      )}

      <InfoPage
        eyebrow={pageLabel}
        title={t('Mauritius catamaran cruise')}
        intro={t(
          'The signature Mauritius day out: a relaxed sail across the lagoon, snorkelling in clear water, a barbecue lunch on board and time on a beach or island — shared or fully private, booked direct.',
        )}
        meta={t(
          'Operated by {operator} · rated 4.8/5 from 1,000+ reviews · door-to-door pickup island-wide.',
          { operator: SITE.operator },
        )}
      >
        <Breadcrumb
          trail={[
            { label: homeLabel, href: lp('/') },
            { label: activitiesLabel, href: lp('/activities') },
          ]}
          current={pageLabel}
        />

        <ContentSection id="intro" title={t('A full day on the Mauritius lagoon')}>
          {fr ? (
            <>
              <p>
                Pour beaucoup de visiteurs, une croisière en catamaran est le clou du séjour. Vous
                partez à la voile à travers le lagon turquoise, jetez l’ancre au-dessus des coraux
                pour faire du snorkeling, puis profitez d’un déjeuner barbecue grillé à bord pendant
                que le bateau dérive doucement. C’est une sortie sans précipitation, conviviale et
                adaptée à tous les âges — la raison pour laquelle c’est l’expérience la plus
                réservée de l’île.
              </p>
              <p>
                Nous organisons des croisières sur chaque côte de l’île et adaptons l’itinéraire à
                votre hôtel : une journée à l’
                <InlineLink href={lp('/ile-aux-cerfs-tours')}>Île aux Cerfs</InlineLink> depuis
                l’est, les îlots du nord, ou la côte ouest, où vous pourrez parfois naviguer aux
                côtés de <InlineLink href={lp('/dolphin-swim-mauritius')}>dauphins</InlineLink>.
              </p>
            </>
          ) : (
            <>
              <p>
                A catamaran cruise is, for many visitors, the highlight of the trip. You set sail
                across the turquoise lagoon, drop anchor over coral to snorkel, then settle in for a
                barbecue lunch grilled on board as the boat drifts. It’s unhurried, sociable and
                suits every age — the reason it’s the most-booked experience on the island.
              </p>
              <p>
                We run cruises on every coast and match the route to your hotel, whether that’s a
                day at <InlineLink href={lp('/ile-aux-cerfs-tours')}>Île aux Cerfs</InlineLink> from
                the east, the northern islets, or the west coast where you might sail alongside{' '}
                <InlineLink href={lp('/dolphin-swim-mauritius')}>dolphins</InlineLink>.
              </p>
            </>
          )}
        </ContentSection>

        <FeaturedTours
          title={t('Catamaran cruises you can book')}
          intro={t(
            'Live dates and prices from our catalogue — tap a cruise to reserve online with instant confirmation.',
          )}
          activities={catamarans}
        />

        {catamarans.length > 0 && (
          <ContentSection
            id="compare"
            title={fr ? 'Comparer nos croisières en catamaran' : 'Compare our catamaran cruises'}
          >
            <p>
              {fr
                ? 'Chaque croisière que nous proposons, côte à côte. Les prix sont ceux du catalogue en direct, au départ, en euros ou dans la devise que vous avez choisie.'
                : 'Every cruise we run, side by side. Prices come straight from the live catalogue and show the starting rate, in euros or the currency you’ve chosen.'}
            </p>
            <CatamaranComparison activities={catamarans} locale={locale} />
          </ContentSection>
        )}

        <ContentSection id="routes" title={t('Choose your route')}>
          {fr ? (
            <>
              <p>
                <strong>Est — l’Île aux Cerfs.</strong> Départ de{' '}
                <InlineLink href={lp('/attractions/trou-deau-douce')}>Trou d’Eau Douce</InlineLink>,
                arrêt à la{' '}
                <InlineLink href={lp('/attractions/grand-river-south-east-waterfall')}>
                  cascade de la Grande Rivière Sud-Est
                </InlineLink>
                , snorkeling dans le lagon et déjeuner barbecue à bord, puis l’après-midi sur l’
                <InlineLink href={lp('/attractions/ile-aux-cerfs')}>Île aux Cerfs</InlineLink>. En
                partagé ou en privé. Idéal depuis Belle Mare et les hôtels de l’est.
              </p>
              <p>
                <strong>Nord — les îlots.</strong> La croisière d’une journée part de{' '}
                <InlineLink href={lp('/destinations/grand-baie')}>Grand Baie</InlineLink> vers l’Île
                Plate pour le snorkeling et le déjeuner à bord, puis l’
                <InlineLink href={lp('/attractions/ilot-gabriel-island')}>Îlot Gabriel</InlineLink>,
                face aux falaises du{' '}
                <InlineLink href={lp('/attractions/coin-de-mire-island')}>Coin de Mire</InlineLink>.
                La croisière de deux heures au coucher du soleil part aussi de Grand Baie et file
                vers le Coin de Mire en longeant le Cap Malheureux. Idéal depuis les hôtels du nord.
              </p>
              <p>
                <strong>Ouest — dauphins et Crystal Rock.</strong> Départ le matin de{' '}
                <InlineLink href={lp('/attractions/riviere-noire-black-river')}>
                  Rivière Noire
                </InlineLink>{' '}
                à la recherche des{' '}
                <InlineLink href={lp('/dolphin-swim-mauritius')}>dauphins</InlineLink> dans la baie
                de Tamarin, snorkeling sur le récif et déjeuner au mouillage près du{' '}
                <InlineLink href={lp('/attractions/crystal-rock')}>Crystal Rock</InlineLink>, avec
                l’
                <InlineLink href={lp('/attractions/ile-aux-benitiers')}>
                  Île aux Bénitiers
                </InlineLink>{' '}
                au programme. En partagé ou en privé. Idéal depuis Flic-en-Flac et l’ouest.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>East — Île aux Cerfs.</strong> Cruises leave from{' '}
                <InlineLink href={lp('/attractions/trou-deau-douce')}>Trou d’Eau Douce</InlineLink>,
                stop at the{' '}
                <InlineLink href={lp('/attractions/grand-river-south-east-waterfall')}>
                  Grand River South East waterfall
                </InlineLink>
                , snorkel in the lagoon and grill a barbecue lunch on board, then spend the
                afternoon on{' '}
                <InlineLink href={lp('/attractions/ile-aux-cerfs')}>Île aux Cerfs</InlineLink>.
                Shared or private. Best from Belle Mare and the eastern resorts.
              </p>
              <p>
                <strong>North — the islets.</strong> The full-day cruise sails from{' '}
                <InlineLink href={lp('/destinations/grand-baie')}>Grand Baie</InlineLink> to Flat
                Island (Île Plate) for snorkelling and lunch on board, then on to{' '}
                <InlineLink href={lp('/attractions/ilot-gabriel-island')}>
                  Gabriel Island
                </InlineLink>
                , facing the cliffs of{' '}
                <InlineLink href={lp('/attractions/coin-de-mire-island')}>
                  Coin de Mire (Gunner’s Quoin)
                </InlineLink>
                . The two-hour sunset cruise also leaves Grand Baie, sailing past Cap Malheureux
                towards Coin de Mire. Best from the northern resorts.
              </p>
              <p>
                <strong>West — dolphins and Crystal Rock.</strong> Cruises leave{' '}
                <InlineLink href={lp('/attractions/riviere-noire-black-river')}>
                  Black River
                </InlineLink>{' '}
                in the morning to look for{' '}
                <InlineLink href={lp('/dolphin-swim-mauritius')}>dolphins</InlineLink> in Tamarin
                Bay, snorkel on the reef and anchor for lunch beside{' '}
                <InlineLink href={lp('/attractions/crystal-rock')}>Crystal Rock</InlineLink>, with{' '}
                <InlineLink href={lp('/attractions/ile-aux-benitiers')}>
                  Île aux Bénitiers
                </InlineLink>{' '}
                on the way. Shared or private. Best from Flic-en-Flac and the west.
              </p>
            </>
          )}
        </ContentSection>

        {(prices.sharedFullDay || prices.sharedShort || prices.privateBoat) && (
          <ContentSection
            id="prices"
            title={
              fr
                ? 'Combien coûte une croisière en catamaran à l’île Maurice ?'
                : 'How much is a catamaran cruise in Mauritius?'
            }
          >
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {prices.sharedFullDay && (
                <li>
                  {fr ? 'Croisière partagée d’une journée : dès ' : 'Shared full-day cruise: from '}
                  <Price eur={prices.sharedFullDay.eur} className="font-bold text-ink" />
                  {fr ? ' par personne.' : ' per person.'}
                </li>
              )}
              {prices.sharedShort && (
                <li>
                  {fr ? `${prices.sharedShort.title} : dès ` : `${prices.sharedShort.title}: from `}
                  <Price eur={prices.sharedShort.eur} className="font-bold text-ink" />
                  {fr ? ' par personne.' : ' per person.'}
                </li>
              )}
              {prices.privateBoat && (
                <li>
                  {fr
                    ? 'Catamaran privé pour votre groupe : dès '
                    : 'Private catamaran for your group: from '}
                  <Price eur={prices.privateBoat.eur} className="font-bold text-ink" />
                  {prices.privateBoat.guests
                    ? fr
                      ? ` pour ${prices.privateBoat.guests} personnes maximum.`
                      : ` for up to ${prices.privateBoat.guests} guests.`
                    : '.'}
                </li>
              )}
            </ul>
            <p>
              {fr
                ? 'Les prix sont fixes et payés en ligne, en direct avec l’opérateur, sans marge de revendeur. Chaque croisière propose la prise en charge à votre hôtel, à choisir lors de la réservation.'
                : 'Prices are fixed and paid online, direct with the operator, with no reseller markup. Every cruise offers pickup from your hotel, which you choose when you book.'}
            </p>
          </ContentSection>
        )}

        <ContentSection id="private" title={t('Shared cruises or private charters')}>
          {fr ? (
            <p>
              Les croisières partagées sont conviviales et offrent le meilleur rapport qualité-prix
              — vous rejoignez d’autres voyageurs à bord d’un catamaran plus grand. Pour une
              occasion spéciale, une réunion de famille ou un mariage, un charter privé vous offre
              le bateau entier, votre propre itinéraire et votre propre rythme. Les deux formules
              incluent l’équipage, le déjeuner et le matériel de snorkeling ; indiquez-nous votre
              date et le nombre de participants, et nous vous communiquerons un prix fixe.
            </p>
          ) : (
            <p>
              Shared cruises are sociable and the best value — you join other guests on a larger
              catamaran. For a special occasion, a family group or a wedding, a private charter
              gives you the whole boat, your own route and your own pace. Both come with crew, lunch
              and snorkelling gear; tell us your date and numbers and we’ll quote a fixed price.
            </p>
          )}
          <RelatedLinks
            links={[
              { label: t('Île aux Cerfs tours'), href: lp('/ile-aux-cerfs-tours') },
              {
                label: t('Private vs shared catamaran'),
                href: lp('/blog/private-vs-shared-catamaran-mauritius'),
              },
              { label: t('Dolphin swim'), href: lp('/dolphin-swim-mauritius') },
              { label: t('All Mauritius tours'), href: lp('/mauritius-tours') },
              {
                label: t('Sea walks & diving'),
                href: lp(categoryHref('Sea & water activities')),
              },
              { label: t('Airport transfers'), href: lp('/airport-transfers') },
            ]}
          />
        </ContentSection>

        {reviews.length > 0 && (
          <ContentSection
            id="reviews"
            title={
              fr
                ? 'L’avis de nos voyageurs sur nos croisières en catamaran'
                : 'What guests say about our catamaran cruises'
            }
          >
            <p>
              {fr
                ? `Avis réels TripAdvisor et Google sur ${SITE.operator} qui parlent de nos sorties en catamaran — la note reprend tous ces avis, sans en écarter aucun.`
                : `Real TripAdvisor and Google reviews of ${SITE.operator} that mention our catamaran trips — the rating counts every one of them, not just the best.`}
            </p>
            <ReviewList
              ratingAvg={reviewStats.avg}
              ratingCount={reviewStats.count}
              reviews={reviews}
            />
          </ContentSection>
        )}

        <ContentSection id="faq" title={t('Catamaran cruise FAQ')}>
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title={t('Set sail with Belle Mare Tours')}>
          {fr ? (
            <p>
              Choisissez une croisière partagée et réservez en ligne en quelques minutes, ou
              écrivez-nous pour un devis de charter privé — en direct avec l’opérateur, sans marge
              de revendeur.
            </p>
          ) : (
            <p>
              Pick a shared cruise and book online in minutes, or message us for a private charter
              quote — direct with the operator, no reseller markup.
            </p>
          )}
          <BookDirectCta
            primary={{ href: lp('/mauritius-tours'), label: t('All Mauritius tours') }}
            secondary={{ href: lp('/airport-transfers'), label: t('Book an airport transfer') }}
          />
        </ContentSection>

        <EnquireRow message="Hi Belle Mare Tours! I'd like a catamaran cruise. Here are my dates, party size and hotel:" />
      </InfoPage>
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/mauritius-catamaran-cruise', DEFAULT_METADATA);
}
