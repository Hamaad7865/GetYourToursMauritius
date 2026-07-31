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
import { featuredActivities } from '@/lib/seo/landing';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import { getT, getLocale } from '@/lib/i18n/server';

export const runtime = 'edge';

const PATH = '/mauritius-catamaran-cruise';
const TITLE = 'Mauritius Catamaran Cruise | Belle Mare Tours';
const DESCRIPTION =
  'Mauritius catamaran cruises booked direct: a full day on the lagoon with snorkelling, a barbecue lunch on board and stops at Île aux Cerfs or the northern islets. Shared or private charters, fixed prices, no reseller markup.';

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
    locale: 'en_GB',
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
    q: 'Can I book a private catamaran charter?',
    a: 'Yes. As well as shared cruises (more sociable and better value), we arrange fully private charters for families, groups, weddings and special occasions. Message us with your date and numbers for a fixed quote.',
  },
  {
    q: 'Is a catamaran cruise good for families and non-swimmers?',
    a: 'Very. Catamarans are stable and spacious, the lagoon is calm, and buoyancy aids are provided for snorkelling. Non-swimmers can relax on deck or wade from the sandbars. Tell us if you’re bringing young children and we’ll advise the best trip.',
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
    q: 'Puis-je réserver un charter privé en catamaran ?',
    a: 'Oui. En plus des croisières partagées (plus conviviales et plus avantageuses), nous organisons des charters entièrement privés pour les familles, les groupes, les mariages et les occasions spéciales. Écrivez-nous votre date et le nombre de participants pour un devis à prix fixe.',
  },
  {
    q: 'Une croisière en catamaran convient-elle aux familles et aux non-nageurs ?',
    a: 'Tout à fait. Les catamarans sont stables et spacieux, le lagon est calme, et des aides à la flottaison sont fournies pour le snorkeling. Les non-nageurs peuvent se détendre sur le pont ou patauger depuis les bancs de sable. Précisez-nous si vous voyagez avec de jeunes enfants et nous vous conseillerons la meilleure excursion.',
  },
  {
    q: 'Quel est le meilleur moment pour une journée en catamaran ?',
    a: 'Toute l’année. Le lagon est le plus calme le matin, et le vent se lève l’après-midi, donc un départ plus tôt signifie généralement une mer plus calme et moins de bateaux. Nous vous suggérerons un départ adapté à votre itinéraire et à la saison.',
  },
];

export default async function MauritiusCatamaranCruisePage() {
  const t = await getT();
  const locale = await getLocale();
  const FAQS = locale === 'fr' ? FAQS_FR : FAQS_EN;
  const featured = await featuredActivities({
    category: 'Catamaran cruises',
    q: 'catamaran',
    limit: 6,
  });
  const homeLabel = t('Home');
  const activitiesLabel = t('Activities');
  const pageLabel = t('Catamaran cruises');

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: homeLabel, path: '/' },
          { name: activitiesLabel, path: '/activities' },
          { name: pageLabel, path: PATH },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      {featured.length > 0 && (
        <JsonLd
          data={itemListJsonLd(
            featured.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })),
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
            { label: homeLabel, href: '/' },
            { label: activitiesLabel, href: '/activities' },
          ]}
          current={pageLabel}
        />

        <ContentSection id="intro" title={t('A full day on the Mauritius lagoon')}>
          {locale === 'fr' ? (
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
                <InlineLink href="/ile-aux-cerfs-tours">Île aux Cerfs</InlineLink> depuis l’est, les
                îlots du nord, ou la côte ouest, où vous pourrez parfois naviguer aux côtés de{' '}
                <InlineLink href="/dolphin-swim-mauritius">dauphins</InlineLink>.
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
                day at <InlineLink href="/ile-aux-cerfs-tours">Île aux Cerfs</InlineLink> from the
                east, the northern islets, or the west coast where you might sail alongside{' '}
                <InlineLink href="/dolphin-swim-mauritius">dolphins</InlineLink>.
              </p>
            </>
          )}
        </ContentSection>

        <FeaturedTours
          title={t('Catamaran cruises you can book')}
          intro={t(
            'Live dates and prices from our catalogue — tap a cruise to reserve online with instant confirmation.',
          )}
          activities={featured}
        />

        <ContentSection id="routes" title={t('Choose your route')}>
          {locale === 'fr' ? (
            <>
              <p>
                <strong>Est — Île aux Cerfs.</strong> Le grand classique : direction la célèbre île
                et ses bancs de sable, avec snorkeling et barbecue sur la plage. Idéal depuis Belle
                Mare et les hôtels de l’est.
              </p>
              <p>
                <strong>Nord — les îlots.</strong> Croisière depuis Grand Baie vers Gabriel Island,
                Flat Island et Gunner’s Quoin, avec certains des meilleurs spots de snorkeling de
                l’île. Idéal depuis les hôtels du nord.
              </p>
              <p>
                <strong>Ouest — Tamarin et Le Morne.</strong> Naviguez le long de la côte du coucher
                du soleil, au pied de la montagne Le Morne, souvent en compagnie de dauphins
                sauvages dans les baies le matin. Idéal depuis Flic-en-Flac et l’ouest.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>East — Île aux Cerfs.</strong> The classic: sail to the famous island and
                its sandbars, with snorkelling and a beach barbecue. Best from Belle Mare and the
                eastern resorts.
              </p>
              <p>
                <strong>North — the islets.</strong> Cruise from Grand Baie to Gabriel Island, Flat
                Island and Gunner’s Quoin, with some of the island’s best snorkelling. Best from the
                northern resorts.
              </p>
              <p>
                <strong>West — Tamarin &amp; Le Morne.</strong> Sail the sunset coast beneath Le
                Morne mountain, often with wild dolphins in the morning bays. Best from Flic-en-Flac
                and the west.
              </p>
            </>
          )}
        </ContentSection>

        <ContentSection id="private" title={t('Shared cruises or private charters')}>
          {locale === 'fr' ? (
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
              { label: t('Île aux Cerfs tours'), href: '/ile-aux-cerfs-tours' },
              { label: t('Dolphin swim'), href: '/dolphin-swim-mauritius' },
              { label: t('All Mauritius tours'), href: '/mauritius-tours' },
              { label: t('Sea walks & diving'), href: '/activities?category=Sea walks & diving' },
              { label: t('Airport transfers'), href: '/airport-transfers' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title={t('Catamaran cruise FAQ')}>
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title={t('Set sail with Belle Mare Tours')}>
          {locale === 'fr' ? (
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
            primary={{
              href: '/activities?category=Catamaran cruises',
              label: t('See all catamaran cruises'),
            }}
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
