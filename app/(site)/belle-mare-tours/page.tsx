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

const FAQS = [
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

export default async function BelleMareToursPage() {
  const featured = await featuredActivities({ limit: 6 });

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
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
        eyebrow="Licensed Mauritius tour operator"
        title="Belle Mare Tours"
        intro="Your local east-coast operator for catamaran cruises, island day tours, dolphin swims and fixed-price airport transfers — booked direct, with the same driver-guide all day."
        meta={`${SITE.legalName} · Belle Mare, Mauritius · BRN ${SITE.brn} · rated 4.8/5 from 1,000+ reviews.`}
      >
        <Breadcrumb trail={[{ label: 'Home', href: '/' }]} current="Belle Mare Tours" />

        <ContentSection id="who" title="A local operator who knows the island">
          <p>
            {SITE.operator} is a licensed Mauritian tour and airport-transfer operator based in
            Belle Mare, on the island’s calm east coast. Run by veteran driver-guide Noorani and his
            team, we’ve spent years showing visitors the Mauritius beyond the resort gate — the
            hidden bays, the best lunch spots, the back roads to the waterfalls — and we’re rated
            4.8/5 across more than a thousand <InlineLink href="/reviews">guest reviews</InlineLink>
            .
          </p>
          <p>
            This site is our own booking platform. Reserve directly with us and you’re dealing with
            the people who actually run the tour — not a reseller — so prices stay fair and someone
            who knows your booking is always a WhatsApp message away.
          </p>
        </ContentSection>

        <FeaturedTours
          title="Book direct with Belle Mare Tours"
          intro="A selection of our most-booked experiences — tap any one for live dates, prices and instant confirmation."
          activities={featured}
        />

        <ContentSection id="what" title="What we offer">
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
        </ContentSection>

        <ContentSection id="east-coast" title="Belle Mare & the east coast">
          <p>
            Belle Mare is known for one of the island’s longest, calmest white-sand beaches and its
            turquoise lagoon, with Île aux Cerfs and Trou d’Eau Douce just down the coast. Being
            based here means quick, unhurried pickups for eastern resorts and an easy run to the
            boat jetties — but we collect from anywhere on the island. Read more about the area and
            its neighbours in our guide to the{' '}
            <InlineLink href="/destinations">regions of Mauritius</InlineLink>.
          </p>
          <RelatedLinks
            links={[
              { label: 'Our tours', href: '/mauritius-tours' },
              { label: 'Airport transfers', href: '/airport-transfers' },
              { label: 'Things to do', href: '/attractions' },
              { label: 'Travel guide', href: '/mauritius-travel-guide' },
              { label: 'About us', href: '/about' },
              { label: 'Contact', href: '/contact' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title="Belle Mare Tours FAQ">
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title="Plan your trip with us">
          <p>
            Tell us your dates and where you’re staying and we’ll put together the right mix of
            tours and transfers — or book any experience online right now.
          </p>
          <BookDirectCta primary={{ href: '/mauritius-tours', label: 'See our tours' }} />
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
