import type { Metadata } from 'next';
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
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

const PATH = '/dolphin-swim-mauritius';
const TITLE = 'Swim with Dolphins in Mauritius | Belle Mare Tours';
const DESCRIPTION =
  'Swim with wild dolphins in Mauritius: an early-morning boat trip to the calm west-coast bays off Tamarin and Black River to meet spinner and bottlenose dolphins. Responsible, small-boat tours booked direct — no reseller markup.';

export const metadata: Metadata = {
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
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: `${SITE.url}${PATH}`, locale: 'en_GB' },
};

const FAQS = [
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

export default async function DolphinSwimMauritiusPage() {
  const featured = await featuredActivities({ category: 'Dolphin swims', q: 'dolphin', limit: 6 });

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Activities', path: '/activities' },
          { name: 'Dolphin swims', path: PATH },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      {featured.length > 0 && (
        <JsonLd data={itemListJsonLd(featured.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })))} />
      )}

      <InfoPage
        eyebrow="Dolphin swims"
        title="Swim with dolphins in Mauritius"
        intro="An early-morning boat trip to the calm west-coast bays to meet wild spinner and bottlenose dolphins — responsibly, on small boats, booked direct with a local operator."
        meta={`Operated by ${SITE.operator} · door-to-door pickup island-wide · rated 4.8/5 from 1,000+ reviews.`}
      >
        <Breadcrumb
          trail={[
            { label: 'Home', href: '/' },
            { label: 'Activities', href: '/activities' },
          ]}
          current="Dolphin swims"
        />

        <ContentSection id="intro" title="Meet wild dolphins off the west coast">
          <p>
            One of the most memorable mornings in Mauritius is spent on the water off Tamarin and Black River, where
            pods of wild spinner dolphins gather in the calm bays at first light. On a good day you’ll watch them roll
            and leap around the boat, then slip quietly into the water to snorkel near them — on their terms, never
            chasing or crowding them.
          </p>
          <p>
            Because the dolphins are there at dawn, it’s an early start, especially from the east. We pick you up from
            your hotel anywhere on the island and have you on a small boat in the west-coast bays before the sea wakes
            up. Many trips then add a snorkelling stop and a barbecue, making a full half-day out of it.
          </p>
        </ContentSection>

        <FeaturedTours
          title="Dolphin trips you can book"
          intro="Live dates and prices — tap a trip to reserve your early-morning departure online."
          activities={featured}
        />

        <ContentSection id="responsible" title="Doing it responsibly">
          <p>
            Wild dolphins deserve respect. We work with skippers who keep a sensible distance, never surround or pursue
            the pods, limit how long guests spend in the water, and follow Mauritian marine rules on approaching marine
            mammals. You’ll get a short briefing before you enter the water — move calmly, keep your fins under the
            surface, and let the dolphins come to you. It makes for a better encounter and a healthier sea.
          </p>
        </ContentSection>

        <ContentSection id="combine" title="Make a morning of it">
          <p>
            Most dolphin trips pair naturally with a west-coast snorkel at the Crystal Rock or Île aux Bénitiers and a
            beach barbecue. Prefer a full day afloat? Look at our{' '}
            <InlineLink href="/mauritius-catamaran-cruise">catamaran cruises</InlineLink>, which sail the same coast in
            the afternoon. Planning several outings? Our{' '}
            <InlineLink href="/mauritius-tours">Mauritius tours</InlineLink> hub ties the whole trip together.
          </p>
          <RelatedLinks
            links={[
              { label: 'Catamaran cruises', href: '/mauritius-catamaran-cruise' },
              { label: 'Île aux Cerfs tours', href: '/ile-aux-cerfs-tours' },
              { label: 'All Mauritius tours', href: '/mauritius-tours' },
              { label: 'Things to do', href: '/attractions' },
              { label: 'Airport transfers', href: '/airport-transfers' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title="Dolphin swim FAQ">
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title="Book your dolphin morning direct">
          <p>
            Reserve online and we’ll confirm your early pickup — direct with {SITE.operator}, fixed price, no reseller
            markup, free cancellation up to 24 hours before.
          </p>
          <BookDirectCta primary={{ href: '/activities?category=Dolphin swims', label: 'See all dolphin trips' }} />
        </ContentSection>

        <EnquireRow message="Hi Belle Mare Tours! I'd like a dolphin swim trip. Here are my dates, party size and hotel:" />
      </InfoPage>
    </>
  );
}
