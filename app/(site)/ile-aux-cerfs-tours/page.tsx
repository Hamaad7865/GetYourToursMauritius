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
import { SITE, OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

const PATH = '/ile-aux-cerfs-tours';
const TITLE = 'Île aux Cerfs Tours & Day Trips | Belle Mare Tours';
const DESCRIPTION =
  'Île aux Cerfs tours and day trips from Belle Mare: catamaran and speedboat cruises to the island’s lagoon and sandbars, the GRSE waterfall, beach barbecue and water sports. Book direct with a local operator — no reseller markup.';

export const metadata: Metadata = {
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
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: `${SITE.url}${PATH}`, locale: 'en_GB', images: [OG_IMAGE] },
};

const FAQS = [
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

export default async function IleAuxCerfsToursPage() {
  const featured = await featuredActivities({ category: 'Île aux Cerfs', q: 'cerfs', limit: 6 });

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Activities', path: '/activities' },
          { name: 'Île aux Cerfs tours', path: PATH },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      {featured.length > 0 && (
        <JsonLd data={itemListJsonLd(featured.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })))} />
      )}

      <InfoPage
        eyebrow="Île aux Cerfs"
        title="Île aux Cerfs tours & day trips"
        intro="Cruise to Mauritius’s most famous island — turquoise lagoon, powder-white sandbars, the GRSE waterfall and a beach barbecue. By catamaran or speedboat, booked direct from just down the coast."
        meta={`Operated by ${SITE.operator} from Belle Mare, minutes from the Trou d’Eau Douce jetty.`}
      >
        <Breadcrumb
          trail={[
            { label: 'Home', href: '/' },
            { label: 'Activities', href: '/activities' },
          ]}
          current="Île aux Cerfs tours"
        />

        <ContentSection id="intro" title="The island day trip every Mauritius visitor wants">
          <p>
            Île aux Cerfs is a small island off the east coast, famous for a lagoon so clear and shallow you can wade
            out to its sandbars. It’s the picture most people have in mind when they imagine Mauritius — and because
            we’re based in Belle Mare, just minutes from the Trou d’Eau Douce departure jetty, an Île aux Cerfs day is
            our home turf.
          </p>
          <p>
            You can reach it two ways: a relaxed <InlineLink href="/mauritius-catamaran-cruise">catamaran cruise</InlineLink>{' '}
            with lunch and snorkelling on board, or a faster speedboat that usually adds the dramatic GRSE waterfall.
            Both are bookable below with instant confirmation and free door-to-door pickup.
          </p>
        </ContentSection>

        <FeaturedTours
          title="Île aux Cerfs trips you can book"
          intro="Live availability and prices — tap a trip to choose your date and book online in minutes."
          activities={featured}
        />

        <ContentSection id="do" title="What to do on the island">
          <p>
            The lagoon is the star: warm, calm and ideal for swimming and snorkelling. Beyond that, you can walk the
            sandbars, settle on the beach, or get active with parasailing, tubing, a glass-bottom boat or a banana
            boat. Most of our day trips include a barbecue lunch — grilled fish, chicken and salads — either on the
            beach or aboard the catamaran. Golfers can play the island’s 18-hole championship course.
          </p>
        </ContentSection>

        <ContentSection id="waterfall" title="The GRSE waterfall & speedboat option">
          <p>
            On the way to or from the island, speedboat trips detour to the foot of the Grande Rivière Sud-Est
            waterfall, where freshwater tumbles into the sea among the mangroves — a great photo stop you don’t get on
            the bigger catamarans. If the waterfall is on your list, choose a speedboat tour; if it’s all about a slow,
            sociable day on the water, choose a catamaran.
          </p>
        </ContentSection>

        <ContentSection id="book-direct" title="Book your Île aux Cerfs day direct">
          <p>
            Booking direct with {SITE.operator} (BRN {SITE.brn}) means no hotel-desk or reseller markup, a fixed EUR
            price agreed before you go, and the same local team looking after you from pickup to drop-off. We never add
            commission stops, and cancellation is free up to 24 hours before.
          </p>
          <RelatedLinks
            links={[
              { label: 'Catamaran cruises', href: '/mauritius-catamaran-cruise' },
              { label: 'Dolphin swim', href: '/dolphin-swim-mauritius' },
              { label: 'All Mauritius tours', href: '/mauritius-tours' },
              { label: 'Belle Mare area', href: '/destinations' },
              { label: 'Airport transfers', href: '/airport-transfers' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title="Île aux Cerfs FAQ">
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title="Ready for your island day?">
          <p>Pick a catamaran or speedboat trip and book online, or message us for a private charter.</p>
          <BookDirectCta primary={{ href: '/mauritius-catamaran-cruise', label: 'See catamaran cruises' }} />
        </ContentSection>

        <EnquireRow message="Hi Belle Mare Tours! I'd like an Île aux Cerfs day trip. Here are my dates, party size and hotel:" />
      </InfoPage>
    </>
  );
}
