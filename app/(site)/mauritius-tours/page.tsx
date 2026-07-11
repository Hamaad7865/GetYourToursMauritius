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

const PATH = '/mauritius-tours';
const TITLE = 'Mauritius Tours & Day Trips — Book Direct | Belle Mare Tours';
const DESCRIPTION =
  'Book Mauritius tours and day trips direct with Belle Mare Tours: catamaran cruises, dolphin swims, Île aux Cerfs days and private island sightseeing — fixed prices, instant confirmation, no reseller markup.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'Mauritius tours',
    'tours in Mauritius',
    'Mauritius day trips',
    'Mauritius excursions',
    'Mauritius private tours',
    'Belle Mare Tours',
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
    q: 'What tours are most popular in Mauritius?',
    a: 'The classics are a catamaran cruise to Île aux Cerfs, an early-morning dolphin swim off Tamarin, a full-day 4x4 tour of the wild south (Chamarel, Grand Bassin, Black River Gorges) and an underwater sea walk. Families also love Casela and La Vanille nature parks.',
  },
  {
    q: 'Are your tours private or shared?',
    a: 'We run both. Day tours by car or minibus are private to your party with your own driver-guide; boat trips such as catamaran cruises can be shared (more sociable, lower price) or fully private on request. Each tour page says which it is before you book.',
  },
  {
    q: 'Do you pick up from my hotel?',
    a: 'Yes — door-to-door pickup is included island-wide, from every hotel, villa, Airbnb and cruise port. We are based in Belle Mare on the east coast, so eastern pickups are quickest, but we cover the north, west, south and central plateau every day.',
  },
  {
    q: 'How far in advance should I book a tour?',
    a: 'A day or two ahead is usually enough, but popular trips like Île aux Cerfs and dolphin swims sell out in peak season, so book earlier if your dates are fixed. You can check live availability and reserve online in a couple of minutes.',
  },
  {
    q: 'Is it cheaper to book direct rather than at my hotel desk?',
    a: 'Almost always. Hotel desks and online resellers add a commission on top of the operator’s price. Booking direct with Belle Mare Tours removes that markup, so you get the same tour — often the very same boat or vehicle — for less.',
  },
  {
    q: 'Can you build a custom multi-stop day?',
    a: 'Yes. Tell us the places you want to see and we’ll route a private day around them, or use our free AI road-trip planner to design one yourself and get an instant quote you can book online.',
  },
];

export default async function MauritiusToursPage() {
  const featured = await featuredActivities({ limit: 8 });

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Mauritius tours', path: PATH },
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
        eyebrow="Mauritius tours"
        title="Mauritius tours & day trips"
        intro="Catamaran cruises, dolphin swims, island day trips and private sightseeing — booked direct with a licensed local operator, with door-to-door pickup and fixed, transparent prices."
        meta={`Operated by ${SITE.operator}, a licensed Mauritius tour operator (BRN ${SITE.brn}), rated 4.8/5 across 1,000+ reviews.`}
      >
        <Breadcrumb trail={[{ label: 'Home', href: '/' }]} current="Mauritius tours" />

        <ContentSection id="intro" title="Every kind of Mauritius tour, from one local operator">
          <p>
            Mauritius is small but wonderfully varied: a turquoise lagoon ringed by white-sand
            beaches, a wild volcanic south, waterfalls and rainforest inland, and busy markets in
            Port Louis. The best way to see it is a mix of boat trips and private day tours, and{' '}
            {SITE.operator} runs the lot — so you can plan your whole trip with one trusted operator
            instead of juggling several middlemen.
          </p>
          <p>
            Everything below is bookable online with instant confirmation, transparent EUR pricing
            and free door-to-door pickup. Browse the full live catalogue on our{' '}
            <InlineLink href="/activities">tours &amp; activities</InlineLink> page, or read the
            bigger picture in our{' '}
            <InlineLink href="/mauritius-travel-guide">Mauritius travel guide</InlineLink>.
          </p>
        </ContentSection>

        <FeaturedTours
          title="Popular tours you can book now"
          intro="A live selection from our catalogue — tap any tour for dates, prices and instant online booking."
          activities={featured}
        />

        <ContentSection id="types" title="The tours we run">
          <p>
            <strong>Catamaran cruises.</strong> A full day on the water with snorkelling stops and a
            grilled lunch on board — the signature Mauritius day out. See{' '}
            <InlineLink href="/mauritius-catamaran-cruise">Mauritius catamaran cruises</InlineLink>.
          </p>
          <p>
            <strong>Île aux Cerfs day trips.</strong> The famous offshore islet with its lagoon,
            sandbars and beach barbecue, reached by catamaran or speedboat. See{' '}
            <InlineLink href="/ile-aux-cerfs-tours">Île aux Cerfs tours</InlineLink>.
          </p>
          <p>
            <strong>Dolphin swims.</strong> An early start to meet wild spinner dolphins in the calm
            west-coast bays. See{' '}
            <InlineLink href="/dolphin-swim-mauritius">dolphin swim in Mauritius</InlineLink>.
          </p>
          <p>
            <strong>Private sightseeing day tours.</strong> Your own driver-guide and vehicle for a
            tailor-made day — the south coast, the north, tea country or the highlands. Browse them
            under{' '}
            <InlineLink href="/activities?category=Sightseeing tours">sightseeing tours</InlineLink>
            .
          </p>
          <p>
            <strong>Sea walks, diving &amp; water sports.</strong> Underwater helmet walks,
            parasailing and snorkelling for all ages, mostly off the calm east and north coasts.
            Browse{' '}
            <InlineLink href="/activities?category=Sea walks & diving">
              sea walks &amp; diving
            </InlineLink>
            .
          </p>
        </ContentSection>

        <ContentSection id="private" title="Private, tailor-made & group tours">
          <p>
            Most of our land tours are fully private: just your party, your own English- and
            French-speaking driver-guide, and a route you can shape on the day. That suits couples,
            families and small groups who want to stop where they like rather than follow a fixed
            coach itinerary.
          </p>
          <p>
            Travelling as a bigger group, a wedding party or a company outing? We run minibuses and
            a 25-seat coaster, so we can keep everyone together in one vehicle. Message us with your
            numbers and dates and we’ll put together a plan and a fixed price. You can also design
            your own multi-stop day with our free{' '}
            <InlineLink href="/ai-road-trip-planner">AI road-trip planner</InlineLink>.
          </p>
        </ContentSection>

        <ContentSection id="pickup" title="Where we pick up">
          <p>
            We’re based in Belle Mare on the east coast and cover the whole island, door to door:
            the north (Grand Baie, Pereybère, Trou aux Biches), the west (Flic-en-Flac, Tamarin, Le
            Morne), the wild south, the central plateau and, of course, the east. Arriving or
            leaving by air or sea? Add a fixed-price{' '}
            <InlineLink href="/airport-transfers">airport transfer</InlineLink> to complete the
            trip. New to the island? Start with our guide to{' '}
            <InlineLink href="/attractions">things to do in Mauritius</InlineLink> and the{' '}
            <InlineLink href="/destinations">regions of Mauritius</InlineLink>.
          </p>
        </ContentSection>

        <ContentSection id="book-direct" title="Why book direct with Belle Mare Tours">
          <p>
            {SITE.operator} is a licensed Mauritian tour operator (BRN {SITE.brn}) that has run
            tours and transfers on the island for years, rated 4.8/5 across more than a thousand
            reviews. Book direct and you deal with the operator — not a reseller adding a markup —
            so the price stays lower and the same driver-guide looks after you all day. We never
            make commission stops at souvenir shops, and every price is fixed and shown up front in
            EUR with free cancellation up to 24 hours before.
          </p>
          <RelatedLinks
            links={[
              { label: 'Catamaran cruises', href: '/mauritius-catamaran-cruise' },
              { label: 'Île aux Cerfs tours', href: '/ile-aux-cerfs-tours' },
              { label: 'Dolphin swim', href: '/dolphin-swim-mauritius' },
              { label: 'Airport transfers', href: '/airport-transfers' },
              { label: 'Things to do', href: '/attractions' },
              { label: 'Guest reviews', href: '/reviews' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title="Mauritius tours FAQ">
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title="Ready to plan your Mauritius tours?">
          <p>
            Book online in minutes, or message us and we’ll tailor a day around you. Either way
            you’re dealing direct with {SITE.operator} in Belle Mare.
          </p>
          <BookDirectCta />
        </ContentSection>

        <EnquireRow message="Hi Belle Mare Tours! I'd like help planning tours in Mauritius. Here are my dates and where I'm staying:" />
      </InfoPage>
    </>
  );
}
