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

const PATH = '/dolphin-swim-mauritius';
const TITLE = 'Swim with Dolphins in Mauritius | Belle Mare Tours';
const DESCRIPTION =
  'Swim with wild dolphins in Mauritius: an early-morning boat trip to the calm west-coast bays off Tamarin and Black River to meet spinner and bottlenose dolphins. Responsible, small-boat tours booked direct — no reseller markup.';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'dolphin swim Mauritius',
    'swim with dolphins Mauritius',
    'dolphin watching Mauritius',
    'Tamarin dolphins',
    'dolphin tour Mauritius',
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
    q: 'Where do you swim with dolphins in Mauritius?',
    a: 'In the calm bays off the west coast, around Tamarin and Black River (Rivière Noire). Pods of wild spinner dolphins — and sometimes bottlenose — rest and feed close to shore there in the early morning, which is why west-coast departures are the classic spot.',
  },
  {
    q: 'Are the dolphins wild, and is sighting guaranteed?',
    a: 'They’re wild, free-swimming dolphins, not captive animals. Sightings are very common in the morning but, as with any wildlife, never 100% guaranteed. Trips go early to give the best chance and follow local rules on how boats approach the pods.',
  },
  {
    q: 'What time does the trip start?',
    a: 'Early — the dolphins are most active and the sea calmest soon after sunrise, so you’ll usually be picked up before dawn depending on your hotel. It’s an early alarm, but the flat morning water and quiet bays are worth it.',
  },
  {
    q: 'Is it responsible to swim with wild dolphins?',
    a: 'It can be, when done carefully. Reputable operators keep a respectful distance, limit time in the water, never chase or surround the pods, and follow Mauritian marine regulations. We brief every guest on how to enter the water calmly so the animals stay relaxed.',
  },
  {
    q: 'What’s included and what should I bring?',
    a: 'Trips typically include hotel pickup, snorkelling gear, a guide and refreshments, and many add a snorkelling stop at the Crystal Rock or Benitiers Island with a barbecue. Bring a towel, sunscreen, a light layer for the early start and a waterproof camera. Exact inclusions are on each tour page.',
  },
  {
    q: 'Can non-swimmers join?',
    a: 'Yes. You can watch the dolphins from the boat without getting in, and buoyancy aids are provided for those who do snorkel. The west-coast bays are calm, which makes it comfortable for nervous swimmers and families.',
  },
];

// French copy of FAQS_EN, same order/length — feeds both the visible accordion and faqPageJsonLd() so
// the two can never drift apart (see the file header comment in LandingSections.tsx).
const FAQS_FR = [
  {
    q: 'Où nage-t-on avec les dauphins à Maurice ?',
    a: 'Dans les baies calmes de la côte ouest, autour de Tamarin et de Black River (Rivière Noire). Des groupes de dauphins à long bec sauvages — et parfois des grands dauphins — s’y reposent et s’y nourrissent près du rivage tôt le matin, ce qui explique pourquoi les départs depuis la côte ouest sont le lieu classique.',
  },
  {
    q: 'Les dauphins sont-ils sauvages, et l’observation est-elle garantie ?',
    a: 'Ce sont des dauphins sauvages, en liberté, et non des animaux captifs. Les observations sont très fréquentes le matin mais, comme pour toute faune sauvage, jamais garanties à 100 %. Les sorties partent tôt pour maximiser les chances, et respectent les règles locales sur la façon dont les bateaux approchent les groupes.',
  },
  {
    q: 'À quelle heure commence la sortie ?',
    a: 'Tôt — les dauphins sont les plus actifs et la mer la plus calme peu après le lever du soleil, vous serez donc généralement pris en charge avant l’aube selon votre hôtel. Le réveil est matinal, mais une mer plate et des baies tranquilles en valent la peine.',
  },
  {
    q: 'Est-il responsable de nager avec des dauphins sauvages ?',
    a: 'Cela peut l’être, si c’est fait avec soin. Les opérateurs sérieux gardent une distance respectueuse, limitent le temps passé dans l’eau, ne poursuivent ni n’encerclent jamais les groupes, et respectent la réglementation maritime mauricienne. Nous briefons chaque client sur la façon d’entrer dans l’eau calmement afin que les animaux restent détendus.',
  },
  {
    q: 'Qu’est-ce qui est inclus et que dois-je apporter ?',
    a: 'Les sorties incluent généralement la prise en charge à l’hôtel, l’équipement de snorkeling, un guide et des rafraîchissements, et beaucoup ajoutent un arrêt snorkeling au Crystal Rock ou à Benitiers Island avec un barbecue. Apportez une serviette, de la crème solaire, une couche légère pour le départ matinal et un appareil photo étanche. Le contenu exact figure sur chaque page d’excursion.',
  },
  {
    q: 'Les non-nageurs peuvent-ils participer ?',
    a: 'Oui. Vous pouvez observer les dauphins depuis le bateau sans entrer dans l’eau, et des gilets de flottaison sont fournis pour ceux qui font du snorkeling. Les baies de la côte ouest sont calmes, ce qui les rend confortables pour les nageurs peu assurés et les familles.',
  },
];

export default async function DolphinSwimMauritiusPage() {
  const t = await getT();
  const locale = await getLocale();
  const FAQS = locale === 'fr' ? FAQS_FR : FAQS_EN;
  const featured = await featuredActivities({ category: 'Dolphin swims', q: 'dolphin', limit: 6 });
  const homeLabel = t('Home');
  const activitiesLabel = t('Activities');
  const pageLabel = t('Dolphin swims');

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
        title={t('Swim with dolphins in Mauritius')}
        intro={t(
          'An early-morning boat trip to the calm west-coast bays to meet wild spinner and bottlenose dolphins — responsibly, on small boats, booked direct with a local operator.',
        )}
        meta={t(
          'Operated by {operator} · door-to-door pickup island-wide · rated 4.8/5 from 1,000+ reviews.',
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

        <ContentSection id="intro" title={t('Meet wild dolphins off the west coast')}>
          {locale === 'fr' ? (
            <>
              <p>
                L’une des matinées les plus mémorables à Maurice se passe sur l’eau au large de
                Tamarin et de Black River, où des groupes de dauphins à long bec sauvages se
                rassemblent dans les baies calmes dès les premières lueurs du jour. Les bons jours,
                vous les regarderez rouler et bondir autour du bateau, avant de glisser doucement
                dans l’eau pour faire du snorkeling près d’eux — à leur rythme, sans jamais les
                poursuivre ni les encercler.
              </p>
              <p>
                Comme les dauphins sont présents à l’aube, le départ est matinal, surtout depuis
                l’est. Nous venons vous chercher à votre hôtel n’importe où sur l’île pour vous
                installer sur un petit bateau dans les baies de la côte ouest avant que la mer ne
                s’agite. De nombreuses sorties ajoutent ensuite un arrêt snorkeling et un barbecue,
                pour en faire une demi-journée complète.
              </p>
            </>
          ) : (
            <>
              <p>
                One of the most memorable mornings in Mauritius is spent on the water off Tamarin
                and Black River, where pods of wild spinner dolphins gather in the calm bays at
                first light. On a good day you’ll watch them roll and leap around the boat, then
                slip quietly into the water to snorkel near them — on their terms, never chasing or
                crowding them.
              </p>
              <p>
                Because the dolphins are there at dawn, it’s an early start, especially from the
                east. We pick you up from your hotel anywhere on the island and have you on a small
                boat in the west-coast bays before the sea wakes up. Many trips then add a
                snorkelling stop and a barbecue, making a full half-day out of it.
              </p>
            </>
          )}
        </ContentSection>

        <FeaturedTours
          title={t('Dolphin trips you can book')}
          intro={t(
            'Live dates and prices — tap a trip to reserve your early-morning departure online.',
          )}
          activities={featured}
        />

        <ContentSection id="responsible" title={t('Doing it responsibly')}>
          {locale === 'fr' ? (
            <p>
              Les dauphins sauvages méritent le respect. Nous travaillons avec des skippers qui
              gardent une distance raisonnable, n’encerclent ni ne poursuivent jamais les groupes,
              limitent le temps que les clients passent dans l’eau, et respectent la réglementation
              mauricienne sur l’approche des mammifères marins. Vous recevrez un court briefing
              avant d’entrer dans l’eau — bougez calmement, gardez vos palmes sous la surface, et
              laissez les dauphins venir à vous. Cela permet une meilleure rencontre et une mer en
              meilleure santé.
            </p>
          ) : (
            <p>
              Wild dolphins deserve respect. We work with skippers who keep a sensible distance,
              never surround or pursue the pods, limit how long guests spend in the water, and
              follow Mauritian marine rules on approaching marine mammals. You’ll get a short
              briefing before you enter the water — move calmly, keep your fins under the surface,
              and let the dolphins come to you. It makes for a better encounter and a healthier sea.
            </p>
          )}
        </ContentSection>

        <ContentSection id="combine" title={t('Make a morning of it')}>
          {locale === 'fr' ? (
            <p>
              La plupart des sorties dauphins se combinent naturellement avec une séance de
              snorkeling sur la côte ouest, au Crystal Rock ou à l’Île aux Bénitiers, suivie d’un
              barbecue sur la plage. Vous préférez une journée complète en mer ? Découvrez nos{' '}
              <InlineLink href="/mauritius-catamaran-cruise">croisières en catamaran</InlineLink>,
              qui longent la même côte l’après-midi. Vous prévoyez plusieurs sorties ? Notre page{' '}
              <InlineLink href="/mauritius-tours">excursions à Maurice</InlineLink> rassemble tout
              votre séjour.
            </p>
          ) : (
            <p>
              Most dolphin trips pair naturally with a west-coast snorkel at the Crystal Rock or Île
              aux Bénitiers and a beach barbecue. Prefer a full day afloat? Look at our{' '}
              <InlineLink href="/mauritius-catamaran-cruise">catamaran cruises</InlineLink>, which
              sail the same coast in the afternoon. Planning several outings? Our{' '}
              <InlineLink href="/mauritius-tours">Mauritius tours</InlineLink> hub ties the whole
              trip together.
            </p>
          )}
          <RelatedLinks
            links={[
              { label: t('Catamaran cruises'), href: '/mauritius-catamaran-cruise' },
              { label: t('Île aux Cerfs tours'), href: '/ile-aux-cerfs-tours' },
              { label: t('All Mauritius tours'), href: '/mauritius-tours' },
              { label: t('Things to do'), href: '/attractions' },
              { label: t('Airport transfers'), href: '/airport-transfers' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title={t('Dolphin swim FAQ')}>
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title={t('Book your dolphin morning direct')}>
          {locale === 'fr' ? (
            <p>
              Réservez en ligne et nous confirmerons votre prise en charge matinale — en direct avec{' '}
              {SITE.operator}, prix fixe, sans marge de revendeur, annulation gratuite jusqu’à 24
              heures avant.
            </p>
          ) : (
            <p>
              Reserve online and we’ll confirm your early pickup — direct with {SITE.operator},
              fixed price, no reseller markup, free cancellation up to 24 hours before.
            </p>
          )}
          <BookDirectCta
            primary={{
              href: '/activities?category=Dolphin swims',
              label: t('See all dolphin trips'),
            }}
          />
        </ContentSection>

        <EnquireRow message="Hi Belle Mare Tours! I'd like a dolphin swim trip. Here are my dates, party size and hotel:" />
      </InfoPage>
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/dolphin-swim-mauritius', DEFAULT_METADATA);
}
