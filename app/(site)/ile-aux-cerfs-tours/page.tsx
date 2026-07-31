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

const PATH = '/ile-aux-cerfs-tours';
const TITLE = 'Île aux Cerfs Tours & Day Trips | Belle Mare Tours';
const DESCRIPTION =
  'Île aux Cerfs tours and day trips from Belle Mare: catamaran and speedboat cruises to the island’s lagoon and sandbars, the GRSE waterfall, beach barbecue and water sports. Book direct with a local operator — no reseller markup.';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'Île aux Cerfs tours',
    'Ile aux Cerfs day trip',
    'Ile aux Cerfs catamaran',
    'Ile aux Cerfs speedboat',
    'Ile aux Cerfs Mauritius',
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
    q: 'How do you get to Île aux Cerfs?',
    a: 'By boat from the east coast — most trips leave from Trou d’Eau Douce, a few minutes from Belle Mare. You can go by catamaran for a relaxed full day with lunch on board, or by speedboat for a quicker crossing that often adds the GRSE (Grande Rivière Sud-Est) waterfall.',
  },
  {
    q: 'What is there to do on Île aux Cerfs?',
    a: 'Swim and snorkel in the lagoon, walk the sandbars, relax on the beach, and try water sports like parasailing, tubing or a glass-bottom boat. Most day trips include a beach barbecue lunch. There’s also an 18-hole golf course on the island.',
  },
  {
    q: 'Catamaran or speedboat — which is better?',
    a: 'A catamaran is the classic choice: a leisurely full day on the water with snorkelling stops, music and a grilled lunch on board. A speedboat is faster and more flexible, ideal if you want to add the GRSE waterfall and spend longer on the island itself. We run both.',
  },
  {
    q: 'Is the GRSE waterfall included?',
    a: 'On most speedboat trips, yes — the boat detours to the foot of the Grande Rivière Sud-Est waterfall on the way. Catamaran cruises focus on the lagoon and snorkelling. Each tour page lists exactly what’s included before you book.',
  },
  {
    q: 'When is the best time to visit Île aux Cerfs?',
    a: 'Year-round, but mornings are calmest and least crowded, and the lagoon colours are at their best with the sun overhead around midday. We aim for an earlier start so you’re on the water before the day boats arrive.',
  },
  {
    q: 'Do you pick up from my hotel?',
    a: 'Yes — door-to-door pickup is included island-wide. Eastern resorts near Belle Mare and Trou d’Eau Douce are quickest, but we collect from the north, west and south too, with a fixed price agreed up front.',
  },
];

// French copy of FAQS_EN, same order/length — feeds both the visible accordion and faqPageJsonLd() so
// the two can never drift apart (see the file header comment in LandingSections.tsx).
const FAQS_FR = [
  {
    q: 'Comment se rendre à l’Île aux Cerfs ?',
    a: 'En bateau depuis la côte est — la plupart des excursions partent de Trou d’Eau Douce, à quelques minutes de Belle Mare. Vous pouvez y aller en catamaran pour une journée complète et tranquille avec déjeuner à bord, ou en vedette rapide pour une traversée plus rapide qui ajoute souvent la cascade GRSE (Grande Rivière Sud-Est).',
  },
  {
    q: 'Que faire sur l’Île aux Cerfs ?',
    a: 'Nagez et faites du snorkeling dans le lagon, marchez sur les bancs de sable, détendez-vous sur la plage, et essayez des sports nautiques comme le parachute ascensionnel, la bouée tractée ou le bateau à fond de verre. La plupart des excursions à la journée incluent un déjeuner barbecue sur la plage. L’île compte aussi un parcours de golf 18 trous.',
  },
  {
    q: 'Catamaran ou vedette rapide — lequel choisir ?',
    a: 'Le catamaran est le choix classique : une journée complète et tranquille sur l’eau, avec des arrêts snorkeling, de la musique et un déjeuner grillé à bord. La vedette rapide est plus rapide et plus flexible, idéale si vous voulez ajouter la cascade GRSE et passer plus de temps sur l’île elle-même. Nous proposons les deux.',
  },
  {
    q: 'La cascade GRSE est-elle incluse ?',
    a: 'Sur la plupart des excursions en vedette rapide, oui — le bateau fait un détour au pied de la cascade de la Grande Rivière Sud-Est en chemin. Les croisières en catamaran se concentrent sur le lagon et le snorkeling. Chaque page d’excursion précise exactement ce qui est inclus avant que vous ne réserviez.',
  },
  {
    q: 'Quelle est la meilleure période pour visiter l’Île aux Cerfs ?',
    a: 'Toute l’année, mais les matinées sont les plus calmes et les moins fréquentées, et les couleurs du lagon sont à leur meilleur avec le soleil au zénith vers midi. Nous privilégions un départ plus tôt afin que vous soyez sur l’eau avant l’arrivée des bateaux de la journée.',
  },
  {
    q: 'Assurez-vous la prise en charge à mon hôtel ?',
    a: 'Oui — la prise en charge porte à porte est incluse sur toute l’île. Les complexes de l’est proches de Belle Mare et de Trou d’Eau Douce sont les plus rapides, mais nous assurons aussi la prise en charge dans le nord, l’ouest et le sud, avec un prix fixe convenu à l’avance.',
  },
];

export default async function IleAuxCerfsToursPage() {
  const t = await getT();
  const locale = await getLocale();
  const FAQS = locale === 'fr' ? FAQS_FR : FAQS_EN;
  const featured = await featuredActivities({ category: 'Île aux Cerfs', q: 'cerfs', limit: 6 });
  const homeLabel = t('Home');
  const activitiesLabel = t('Activities');
  const pageLabel = t('Île aux Cerfs tours');

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
        eyebrow="Île aux Cerfs"
        title={t('Île aux Cerfs tours & day trips')}
        intro={t(
          'Cruise to Mauritius’s most famous island — turquoise lagoon, powder-white sandbars, the GRSE waterfall and a beach barbecue. By catamaran or speedboat, booked direct from just down the coast.',
        )}
        meta={t(
          'Operated by {operator} from Belle Mare, minutes from the Trou d’Eau Douce jetty.',
          {
            operator: SITE.operator,
          },
        )}
      >
        <Breadcrumb
          trail={[
            { label: homeLabel, href: '/' },
            { label: activitiesLabel, href: '/activities' },
          ]}
          current={pageLabel}
        />

        <ContentSection id="intro" title={t('The island day trip every Mauritius visitor wants')}>
          {locale === 'fr' ? (
            <>
              <p>
                L’Île aux Cerfs est une petite île au large de la côte est, réputée pour un lagon si
                clair et peu profond que l’on peut marcher jusqu’à ses bancs de sable. C’est l’image
                que la plupart des gens ont en tête quand ils imaginent Maurice — et comme nous
                sommes basés à Belle Mare, à quelques minutes seulement de l’embarcadère de Trou
                d’Eau Douce, une journée à l’Île aux Cerfs est notre terrain de prédilection.
              </p>
              <p>
                Vous pouvez y accéder de deux façons : une{' '}
                <InlineLink href="/mauritius-catamaran-cruise">croisière en catamaran</InlineLink>{' '}
                tranquille, avec déjeuner et snorkeling à bord, ou une vedette rapide qui ajoute
                généralement le passage spectaculaire par la cascade GRSE. Les deux se réservent
                ci-dessous, avec confirmation instantanée et prise en charge porte à porte gratuite.
              </p>
            </>
          ) : (
            <>
              <p>
                Île aux Cerfs is a small island off the east coast, famous for a lagoon so clear and
                shallow you can wade out to its sandbars. It’s the picture most people have in mind
                when they imagine Mauritius — and because we’re based in Belle Mare, just minutes
                from the Trou d’Eau Douce departure jetty, an Île aux Cerfs day is our home turf.
              </p>
              <p>
                You can reach it two ways: a relaxed{' '}
                <InlineLink href="/mauritius-catamaran-cruise">catamaran cruise</InlineLink> with
                lunch and snorkelling on board, or a faster speedboat that usually adds the dramatic
                GRSE waterfall. Both are bookable below with instant confirmation and free
                door-to-door pickup.
              </p>
            </>
          )}
        </ContentSection>

        <FeaturedTours
          title={t('Île aux Cerfs trips you can book')}
          intro={t(
            'Live availability and prices — tap a trip to choose your date and book online in minutes.',
          )}
          activities={featured}
        />

        <ContentSection id="do" title={t('What to do on the island')}>
          {locale === 'fr' ? (
            <p>
              Le lagon est la star : chaud, calme et idéal pour la baignade et le snorkeling. Vous
              pouvez aussi marcher sur les bancs de sable, vous installer sur la plage, ou vous
              dépenser avec du parachute ascensionnel, de la bouée tractée, un bateau à fond de
              verre ou un bateau banane. La plupart de nos excursions à la journée incluent un
              déjeuner barbecue — poisson et poulet grillés, salades — sur la plage ou à bord du
              catamaran. Les golfeurs peuvent jouer sur le parcours de championnat 18 trous de
              l’île.
            </p>
          ) : (
            <p>
              The lagoon is the star: warm, calm and ideal for swimming and snorkelling. Beyond
              that, you can walk the sandbars, settle on the beach, or get active with parasailing,
              tubing, a glass-bottom boat or a banana boat. Most of our day trips include a barbecue
              lunch — grilled fish, chicken and salads — either on the beach or aboard the
              catamaran. Golfers can play the island’s 18-hole championship course.
            </p>
          )}
        </ContentSection>

        <ContentSection id="waterfall" title={t('The GRSE waterfall & speedboat option')}>
          {locale === 'fr' ? (
            <p>
              À l’aller ou au retour, les excursions en vedette rapide font un détour au pied de la
              cascade de la Grande Rivière Sud-Est, où l’eau douce se jette dans la mer au milieu
              des mangroves — un arrêt photo idéal que l’on ne trouve pas sur les catamarans, plus
              grands. Si la cascade fait partie de vos priorités, optez pour une excursion en
              vedette rapide ; si vous préférez une journée tranquille et conviviale sur l’eau,
              optez pour un catamaran.
            </p>
          ) : (
            <p>
              On the way to or from the island, speedboat trips detour to the foot of the Grande
              Rivière Sud-Est waterfall, where freshwater tumbles into the sea among the mangroves —
              a great photo stop you don’t get on the bigger catamarans. If the waterfall is on your
              list, choose a speedboat tour; if it’s all about a slow, sociable day on the water,
              choose a catamaran.
            </p>
          )}
        </ContentSection>

        <ContentSection id="book-direct" title={t('Book your Île aux Cerfs day direct')}>
          {locale === 'fr' ? (
            <p>
              Réserver en direct avec {SITE.operator} (BRN {SITE.brn}) signifie aucune commission de
              revendeur ni de réception d’hôtel, un prix fixe en euros convenu avant le départ, et
              la même équipe locale qui s’occupe de vous de la prise en charge jusqu’au retour. Nous
              n’ajoutons jamais d’arrêts commissionnés, et l’annulation est gratuite jusqu’à 24
              heures avant.
            </p>
          ) : (
            <p>
              Booking direct with {SITE.operator} (BRN {SITE.brn}) means no hotel-desk or reseller
              markup, a fixed EUR price agreed before you go, and the same local team looking after
              you from pickup to drop-off. We never add commission stops, and cancellation is free
              up to 24 hours before.
            </p>
          )}
          <RelatedLinks
            links={[
              { label: t('Catamaran cruises'), href: '/mauritius-catamaran-cruise' },
              { label: t('Dolphin swim'), href: '/dolphin-swim-mauritius' },
              { label: t('All Mauritius tours'), href: '/mauritius-tours' },
              { label: t('Belle Mare area'), href: '/destinations' },
              { label: t('Airport transfers'), href: '/airport-transfers' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title={t('Île aux Cerfs FAQ')}>
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title={t('Ready for your island day?')}>
          {locale === 'fr' ? (
            <p>
              Choisissez une excursion en catamaran ou en vedette rapide et réservez en ligne, ou
              écrivez-nous pour un affrètement privé.
            </p>
          ) : (
            <p>
              Pick a catamaran or speedboat trip and book online, or message us for a private
              charter.
            </p>
          )}
          <BookDirectCta
            primary={{ href: '/mauritius-catamaran-cruise', label: t('See catamaran cruises') }}
          />
        </ContentSection>

        <EnquireRow message="Hi Belle Mare Tours! I'd like an Île aux Cerfs day trip. Here are my dates, party size and hotel:" />
      </InfoPage>
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/ile-aux-cerfs-tours', DEFAULT_METADATA);
}
