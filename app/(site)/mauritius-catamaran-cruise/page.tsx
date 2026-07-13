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

const FAQS = [
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

export default async function MauritiusCatamaranCruisePage() {
  const featured = await featuredActivities({
    category: 'Catamaran cruises',
    q: 'catamaran',
    limit: 6,
  });

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Activities', path: '/activities' },
          { name: 'Catamaran cruises', path: PATH },
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
        eyebrow="Catamaran cruises"
        title="Mauritius catamaran cruise"
        intro="The signature Mauritius day out: a relaxed sail across the lagoon, snorkelling in clear water, a barbecue lunch on board and time on a beach or island — shared or fully private, booked direct."
        meta={`Operated by ${SITE.operator} · rated 4.8/5 from 1,000+ reviews · door-to-door pickup island-wide.`}
      >
        <Breadcrumb
          trail={[
            { label: 'Home', href: '/' },
            { label: 'Activities', href: '/activities' },
          ]}
          current="Catamaran cruises"
        />

        <ContentSection id="intro" title="A full day on the Mauritius lagoon">
          <p>
            A catamaran cruise is, for many visitors, the highlight of the trip. You set sail across
            the turquoise lagoon, drop anchor over coral to snorkel, then settle in for a barbecue
            lunch grilled on board as the boat drifts. It’s unhurried, sociable and suits every age
            — the reason it’s the most-booked experience on the island.
          </p>
          <p>
            We run cruises on every coast and match the route to your hotel, whether that’s a day at{' '}
            <InlineLink href="/ile-aux-cerfs-tours">Île aux Cerfs</InlineLink> from the east, the
            northern islets, or the west coast where you might sail alongside{' '}
            <InlineLink href="/dolphin-swim-mauritius">dolphins</InlineLink>.
          </p>
        </ContentSection>

        <FeaturedTours
          title="Catamaran cruises you can book"
          intro="Live dates and prices from our catalogue — tap a cruise to reserve online with instant confirmation."
          activities={featured}
        />

        <ContentSection id="routes" title="Choose your route">
          <p>
            <strong>East — Île aux Cerfs.</strong> The classic: sail to the famous island and its
            sandbars, with snorkelling and a beach barbecue. Best from Belle Mare and the eastern
            resorts.
          </p>
          <p>
            <strong>North — the islets.</strong> Cruise from Grand Baie to Gabriel Island, Flat
            Island and Gunner’s Quoin, with some of the island’s best snorkelling. Best from the
            northern resorts.
          </p>
          <p>
            <strong>West — Tamarin &amp; Le Morne.</strong> Sail the sunset coast beneath Le Morne
            mountain, often with wild dolphins in the morning bays. Best from Flic-en-Flac and the
            west.
          </p>
        </ContentSection>

        <ContentSection id="private" title="Shared cruises or private charters">
          <p>
            Shared cruises are sociable and the best value — you join other guests on a larger
            catamaran. For a special occasion, a family group or a wedding, a private charter gives
            you the whole boat, your own route and your own pace. Both come with crew, lunch and
            snorkelling gear; tell us your date and numbers and we’ll quote a fixed price.
          </p>
          <RelatedLinks
            links={[
              { label: 'Île aux Cerfs tours', href: '/ile-aux-cerfs-tours' },
              { label: 'Dolphin swim', href: '/dolphin-swim-mauritius' },
              { label: 'All Mauritius tours', href: '/mauritius-tours' },
              { label: 'Sea walks & diving', href: '/activities?category=Sea walks & diving' },
              { label: 'Airport transfers', href: '/airport-transfers' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title="Catamaran cruise FAQ">
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title="Set sail with Belle Mare Tours">
          <p>
            Pick a shared cruise and book online in minutes, or message us for a private charter
            quote — direct with the operator, no reseller markup.
          </p>
          <BookDirectCta
            primary={{
              href: '/activities?category=Catamaran cruises',
              label: 'See all catamaran cruises',
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
