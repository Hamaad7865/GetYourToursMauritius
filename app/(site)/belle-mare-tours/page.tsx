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

const PATH = '/belle-mare-tours';
const TITLE = 'Belle Mare Tours — Licensed Mauritius Tour Operator';
const DESCRIPTION =
  'Belle Mare Tours is a licensed Mauritius tour operator on the east coast, run by veteran driver-guide Noorani. Book catamaran cruises, island day tours, dolphin swims and airport transfers direct — fixed prices, no reseller markup.';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'Belle Mare Tours',
    'Belle Mare Tours Mauritius',
    'Belle Mare tour operator',
    'Belle Mare excursions',
    'east coast Mauritius tours',
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
    q: 'Who are Belle Mare Tours?',
    a: 'Belle Mare Tours Ltd is a licensed Mauritian tour and airport-transfer operator based in Belle Mare on the east coast, run by veteran driver-guide Noorani and his team. We’ve guided visitors around the island for years and are rated 4.8/5 across more than a thousand reviews.',
  },
  {
    q: 'Where are you based and which areas do you cover?',
    a: 'Our home is Belle Mare on the east coast, so eastern pickups are quickest, but we run tours and transfers island-wide — north, west, south and the central plateau — with door-to-door pickup from any hotel, villa or cruise port.',
  },
  {
    q: 'Are you licensed and insured?',
    a:
      'Yes. Belle Mare Tours Ltd is a registered Mauritian company (BRN ' +
      SITE.brn +
      ', VAT ' +
      SITE.vat +
      ') operating licensed, insured vehicles with professional driver-guides.',
  },
  {
    q: 'What does “book direct” actually save me?',
    a: 'Hotel desks and online travel agents add a commission to the operator’s price. When you book direct with us there’s no middleman, so you pay the operator’s own fixed price — usually less for exactly the same tour, boat or transfer.',
  },
  {
    q: 'How do I reach you?',
    a:
      'Book online any time, or message us on WhatsApp at ' +
      SITE.phone +
      ' for a quick quote or a tailor-made day. We reply in English and French.',
  },
];

// French copy of FAQS_EN, same order/length — feeds both the visible accordion and faqPageJsonLd()
// so the two can never drift apart (see the file header comment in LandingSections.tsx).
const FAQS_FR = [
  {
    q: 'Qui est Belle Mare Tours ?',
    a: 'Belle Mare Tours Ltd est un opérateur mauricien agréé de tours et de transferts aéroport, basé à Belle Mare sur la côte est, dirigé par le chauffeur-guide chevronné Noorani et son équipe. Nous guidons les visiteurs à travers l’île depuis des années et sommes notés 4,8/5 sur plus d’un millier d’avis.',
  },
  {
    q: 'Où êtes-vous basés et quelles zones couvrez-vous ?',
    a: 'Notre base est Belle Mare, sur la côte est, donc les prises en charge à l’est sont les plus rapides, mais nous assurons des excursions et des transferts sur toute l’île — nord, ouest, sud et plateau central — avec prise en charge porte à porte depuis n’importe quel hôtel, villa ou quai de croisière.',
  },
  {
    q: 'Êtes-vous agréés et assurés ?',
    a:
      'Oui. Belle Mare Tours Ltd est une société mauricienne enregistrée (BRN ' +
      SITE.brn +
      ', TVA ' +
      SITE.vat +
      ') exploitant des véhicules agréés et assurés avec des chauffeurs-guides professionnels.',
  },
  {
    q: 'Que fait vraiment économiser la « réservation en direct » ?',
    a: 'Les réceptions d’hôtel et les agences de voyage en ligne ajoutent une commission au prix de l’opérateur. En réservant en direct avec nous, il n’y a pas d’intermédiaire, vous payez donc le prix fixe de l’opérateur lui-même — généralement moins cher pour exactement la même excursion, le même bateau ou le même transfert.',
  },
  {
    q: 'Comment puis-je vous contacter ?',
    a:
      'Réservez en ligne à tout moment, ou écrivez-nous sur WhatsApp au ' +
      SITE.phone +
      ' pour un devis rapide ou une journée sur mesure. Nous répondons en anglais et en français.',
  },
];

export default async function BelleMareToursPage() {
  const t = await getT();
  const locale = await getLocale();
  const FAQS = locale === 'fr' ? FAQS_FR : FAQS_EN;
  const featured = await featuredActivities({ limit: 6 });
  const homeLabel = t('Home');
  // "Belle Mare Tours" is the brand name — a proper noun, left untranslated everywhere it appears
  // alone (breadcrumb, JSON-LD name, page title).

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: homeLabel, path: '/' },
          { name: 'Belle Mare Tours', path: PATH },
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
        eyebrow={t('Licensed Mauritius tour operator')}
        title="Belle Mare Tours"
        intro={t(
          'Your local east-coast operator for catamaran cruises, island day tours, dolphin swims and fixed-price airport transfers — booked direct, with the same driver-guide all day.',
        )}
        meta={t(
          '{legalName} · Belle Mare, Mauritius · BRN {brn} · rated 4.8/5 from 1,000+ reviews.',
          {
            legalName: SITE.legalName,
            brn: SITE.brn,
          },
        )}
      >
        <Breadcrumb trail={[{ label: homeLabel, href: '/' }]} current="Belle Mare Tours" />

        <ContentSection id="who" title={t('A local operator who knows the island')}>
          {locale === 'fr' ? (
            <>
              <p>
                {SITE.operator} est un opérateur mauricien agréé de tours et de transferts aéroport,
                basé à Belle Mare, sur la côte est paisible de l’île. Dirigés par le chauffeur-guide
                chevronné Noorani et son équipe, nous montrons depuis des années aux visiteurs la
                Maurice au-delà des grilles des hôtels — les baies cachées, les meilleures adresses
                pour déjeuner, les petites routes vers les cascades — et nous sommes notés 4,8/5 sur
                plus d’un millier d’
                <InlineLink href="/reviews">avis clients</InlineLink>.
              </p>
              <p>
                Ce site est notre propre plateforme de réservation. En réservant directement avec
                nous, vous traitez avec les personnes qui organisent réellement l’excursion — pas
                avec un revendeur — les prix restent donc justes, et quelqu’un qui connaît votre
                réservation n’est jamais qu’à un message WhatsApp.
              </p>
            </>
          ) : (
            <>
              <p>
                {SITE.operator} is a licensed Mauritian tour and airport-transfer operator based in
                Belle Mare, on the island’s calm east coast. Run by veteran driver-guide Noorani and
                his team, we’ve spent years showing visitors the Mauritius beyond the resort gate —
                the hidden bays, the best lunch spots, the back roads to the waterfalls — and we’re
                rated 4.8/5 across more than a thousand{' '}
                <InlineLink href="/reviews">guest reviews</InlineLink>.
              </p>
              <p>
                This site is our own booking platform. Reserve directly with us and you’re dealing
                with the people who actually run the tour — not a reseller — so prices stay fair and
                someone who knows your booking is always a WhatsApp message away.
              </p>
            </>
          )}
        </ContentSection>

        <FeaturedTours
          title={t('Book direct with Belle Mare Tours')}
          intro={t(
            'A selection of our most-booked experiences — tap any one for live dates, prices and instant confirmation.',
          )}
          activities={featured}
        />

        <ContentSection id="what" title={t('What we offer')}>
          {locale === 'fr' ? (
            <p>
              Nous couvrons les expériences pour lesquelles la plupart des visiteurs viennent à
              Maurice :{' '}
              <InlineLink href="/mauritius-catamaran-cruise">croisières en catamaran</InlineLink>{' '}
              vers l’<InlineLink href="/ile-aux-cerfs-tours">Île aux Cerfs</InlineLink>,{' '}
              <InlineLink href="/dolphin-swim-mauritius">
                nages matinales avec les dauphins
              </InlineLink>
              ,{' '}
              <InlineLink href="/activities?category=Sightseeing tours">
                excursions touristiques privées à la journée
              </InlineLink>{' '}
              dans le sud et le nord, randonnées sous-marines et snorkeling, ainsi que des{' '}
              <InlineLink href="/airport-transfers">transferts aéroport</InlineLink> à prix fixe
              depuis et vers l’aéroport international SSR. Retrouvez tout sur la page{' '}
              <InlineLink href="/mauritius-tours">tours à Maurice</InlineLink> ou dans notre{' '}
              <InlineLink href="/activities">catalogue en temps réel</InlineLink>.
            </p>
          ) : (
            <p>
              We cover the experiences most visitors come to Mauritius for:{' '}
              <InlineLink href="/mauritius-catamaran-cruise">catamaran cruises</InlineLink> to{' '}
              <InlineLink href="/ile-aux-cerfs-tours">Île aux Cerfs</InlineLink>, early-morning{' '}
              <InlineLink href="/dolphin-swim-mauritius">dolphin swims</InlineLink>, private{' '}
              <InlineLink href="/activities?category=Sightseeing tours">
                sightseeing day tours
              </InlineLink>{' '}
              of the south and north, sea walks and snorkelling, plus fixed-price{' '}
              <InlineLink href="/airport-transfers">airport transfers</InlineLink> to and from SSR
              International Airport. See everything on the{' '}
              <InlineLink href="/mauritius-tours">Mauritius tours</InlineLink> page or the live{' '}
              <InlineLink href="/activities">catalogue</InlineLink>.
            </p>
          )}
        </ContentSection>

        <ContentSection id="east-coast" title={t('Belle Mare & the east coast')}>
          {locale === 'fr' ? (
            <p>
              Belle Mare est réputée pour l’une des plages de sable blanc les plus longues et les
              plus calmes de l’île, et son lagon turquoise, avec l’Île aux Cerfs et Trou d’Eau Douce
              juste à côté sur la côte. Être basés ici signifie des prises en charge rapides et sans
              stress pour les complexes de l’est et un accès facile aux embarcadères — mais nous
              venons vous chercher n’importe où sur l’île. Consultez notre guide local des{' '}
              <InlineLink href="/things-to-do-in-belle-mare">
                choses à faire à Belle Mare
              </InlineLink>
              , ou découvrez la région et ses environs dans notre guide des{' '}
              <InlineLink href="/destinations">régions de Maurice</InlineLink>.
            </p>
          ) : (
            <p>
              Belle Mare is known for one of the island’s longest, calmest white-sand beaches and
              its turquoise lagoon, with Île aux Cerfs and Trou d’Eau Douce just down the coast.
              Being based here means quick, unhurried pickups for eastern resorts and an easy run to
              the boat jetties — but we collect from anywhere on the island. See our local guide to{' '}
              <InlineLink href="/things-to-do-in-belle-mare">things to do in Belle Mare</InlineLink>
              , or read about the area and its neighbours in our guide to the{' '}
              <InlineLink href="/destinations">regions of Mauritius</InlineLink>.
            </p>
          )}
          <RelatedLinks
            links={[
              { label: t('Things to do in Belle Mare'), href: '/things-to-do-in-belle-mare' },
              { label: t('Our tours'), href: '/mauritius-tours' },
              { label: t('Airport transfers'), href: '/airport-transfers' },
              { label: t('Things to do'), href: '/attractions' },
              { label: t('Travel guide'), href: '/mauritius-travel-guide' },
              { label: t('About us'), href: '/about' },
              { label: t('Contact'), href: '/contact' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title={t('Belle Mare Tours FAQ')}>
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title={t('Plan your trip with us')}>
          {locale === 'fr' ? (
            <p>
              Indiquez-nous vos dates et votre lieu de séjour, et nous vous préparerons la bonne
              combinaison d’excursions et de transferts — ou réservez dès maintenant n’importe
              quelle expérience en ligne.
            </p>
          ) : (
            <p>
              Tell us your dates and where you’re staying and we’ll put together the right mix of
              tours and transfers — or book any experience online right now.
            </p>
          )}
          <BookDirectCta primary={{ href: '/mauritius-tours', label: t('See our tours') }} />
        </ContentSection>

        <EnquireRow message="Hi Belle Mare Tours! I'd like to plan some tours and transfers. Here are my dates and hotel:" />
      </InfoPage>
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/belle-mare-tours', DEFAULT_METADATA);
}
