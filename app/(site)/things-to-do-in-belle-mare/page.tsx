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
import { belleMareActivityGroups } from '@/lib/seo/landing';
import { SITE, OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

/* The local "belle mare things to do / belle mare activities" landing page. ONE page deliberately
   covers that whole query cluster — the two searches share an intent (and a SERP), and splitting them
   across near-duplicate pages would cannibalise this domain's thin early authority. The island-wide
   sibling is /attractions; the area overview (where to stay, who it suits) is /destinations/belle-mare —
   this page is the activity-first middle: what to actually DO from a Belle Mare base. */

const PATH = '/things-to-do-in-belle-mare';
const TITLE = 'Things to Do in Belle Mare — Best Activities, Beaches & Day Trips';
const DESCRIPTION =
  'The best things to do in Belle Mare, Mauritius — beach and lagoon activities, Île aux Cerfs boat trips, catamaran cruises, kitesurfing, golf and day tours, from the licensed local operator based right here on the east coast.';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'Belle Mare things to do',
    'things to do in Belle Mare',
    'Belle Mare activities',
    'Belle Mare Mauritius',
    'Belle Mare excursions',
    'what to do in Belle Mare',
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
    q: 'What are the best things to do in Belle Mare?',
    a: 'Start with the beach itself — Belle Mare Public Beach is one of the longest white-sand stretches on the island, with a calm, shallow lagoon that is ideal for swimming and snorkelling. From there the classics are a boat or catamaran trip to Île aux Cerfs, a glass-bottom boat or snorkel over the reef, kitesurfing or windsurfing on the trade winds, a round of golf at Constance Belle Mare Plage’s Legend or Links courses, and day tours to the island’s south or north with a local driver-guide.',
  },
  {
    q: 'How do I get to Île aux Cerfs from Belle Mare?',
    a: 'Boats leave from Trou d’Eau Douce, just down the coast from Belle Mare — about 15 minutes by road. You can go by speedboat or spend the day on a catamaran cruise, usually with snorkelling, the GRSE waterfall and a barbecue lunch included. We run both, with pickup from Belle Mare hotels.',
  },
  {
    q: 'Do your tours pick up from Belle Mare hotels?',
    a: 'Yes — every tour, boat trip and transfer we run includes door-to-door pickup. We are based in Belle Mare itself, so east-coast pickups are the quickest on the island, and we collect from hotels, villas and guesthouses island-wide too.',
  },
  {
    q: 'Is Belle Mare good for families?',
    a: 'Very. The lagoon is shallow, calm and protected by the reef, the public beach has natural shade from filao trees, and gentle activities like glass-bottom boat trips and Île aux Cerfs sandbanks suit all ages. Day tours are private, so the pace is set by your family, not a coach schedule.',
  },
  {
    q: 'What can you do in Belle Mare when it’s windy?',
    a: 'The steady south-east trade winds are part of Belle Mare’s character — kitesurfers and windsurfers plan trips around them. If you would rather escape the breeze, that is the day for an inland tour: the south’s waterfalls and viewpoints, the central plateau, or the sheltered west coast for a dolphin swim.',
  },
  {
    q: 'Is Belle Mare a good base for exploring Mauritius?',
    a: 'Yes — the airport is roughly 45–60 minutes away, Île aux Cerfs is on your doorstep, and the wild south-east coast is an easy day trip. The north and west are further, but with a private driver-guide or a rental car every corner of the island is reachable in a day.',
  },
];

export default async function ThingsToDoInBelleMarePage() {
  const groups = await belleMareActivityGroups();
  const allActivities = groups.flatMap((g) => g.activities);

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Things to do in Belle Mare', path: PATH },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      {allActivities.length > 0 && (
        <JsonLd
          data={itemListJsonLd(
            allActivities.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })),
          )}
        />
      )}

      <InfoPage
        eyebrow="Belle Mare · east coast Mauritius"
        title="Things to do in Belle Mare"
        intro="Beach days, Île aux Cerfs boat trips, lagoon activities, golf and island day tours — a local's guide to Belle Mare, from the licensed operator based right here on the east coast."
        meta={`Written by ${SITE.operator} · based in Belle Mare · rated 4.8/5 from 1,000+ reviews.`}
      >
        <Breadcrumb trail={[{ label: 'Home', href: '/' }]} current="Things to do in Belle Mare" />

        <ContentSection id="why" title="Why Belle Mare is the east coast's best base">
          <p>
            Belle Mare is a long, low-rise stretch of coast known for some of the island’s whitest
            sand and a wide turquoise lagoon protected by the reef. It is calmer and greener than
            the busy north — five-star resorts, championship golf and a famous public beach backed
            by casuarina and filao trees — yet close enough to Trou d’Eau Douce that the island’s
            most famous day trip, Île aux Cerfs, is practically on your doorstep. Read the full area
            guide at <InlineLink href="/destinations/belle-mare">Belle Mare, Mauritius</InlineLink>,
            or meet the local team behind this site at{' '}
            <InlineLink href="/belle-mare-tours">Belle Mare Tours</InlineLink>.
          </p>
        </ContentSection>

        <ContentSection id="best-time" title="Best time to visit Belle Mare">
          <p>
            The east coast is at its best from May to December, when the trade winds are steady,
            rainfall stays low and the lagoon runs flat and clear — October to December is the
            driest, warmest stretch within that window. Those same trade winds are why Belle Mare
            draws kitesurfers and windsurfers: they blow most reliably from May to September, with
            April through mid-October the core season for flat-water sailing. November to April is
            cyclone season, with the highest chance of a direct system in January to March; most
            years bring tropical storms and heavier rain rather than a direct hit, but it is worth
            building some flexibility into a booking made for that stretch. Outside of storms, the
            sea rarely drops below 23°C even in the coolest months, so there is no bad time to swim
            — only a best time to plan around the wind and the rain.
          </p>
        </ContentSection>

        {groups.map((group) => (
          <FeaturedTours
            key={group.title}
            title={group.title}
            intro={group.intro}
            activities={group.activities}
          />
        ))}

        <ContentSection id="beach" title="The beach & the lagoon">
          <p>
            Belle Mare Public Beach is the obvious first stop: a long ribbon of fine white sand with
            shallow, calm water and natural shade, made for slow mornings and long swims. Palmar
            Beach next door is quieter, and the fishing village of Trou d’Eau Douce is a short ride
            south. On the water, the lagoon does everything — snorkelling and glass-bottom boat
            trips over the reef, and steady south-east trade winds that make this one of the
            island’s most reliable spots for kitesurfing and windsurfing on flat, protected water.
            Just back from the sand on Coastal Road, Splash n Fun Leisure Park adds pirate-themed
            water slides and pools — a good option for kids, or any day the sea is too rough to
            enjoy.
          </p>
        </ContentSection>

        <ContentSection id="ile-aux-cerfs" title="Île aux Cerfs — the classic day out">
          <p>
            The east coast’s signature trip leaves from just down the road: sandbank beaches,
            snorkelling stops and the Grand River South East waterfall, by{' '}
            <InlineLink href="/ile-aux-cerfs-tours">speedboat</InlineLink> if you want the whole
            island in half a day, or by{' '}
            <InlineLink href="/mauritius-catamaran-cruise">catamaran cruise</InlineLink> with a
            barbecue lunch on board if you would rather make the sailing the point. Being based in
            Belle Mare, our pickups for the jetty are the shortest on the island.
          </p>
        </ContentSection>

        <ContentSection id="day-trips" title="Day trips from Belle Mare">
          <p>
            When you have had your fill of the lagoon, the rest of the island is a private day tour
            away: the wild south with its waterfalls, viewpoints and volcanic crater, the north’s
            capital and botanical garden, or an early-morning{' '}
            <InlineLink href="/dolphin-swim-mauritius">swim with wild dolphins</InlineLink> off the
            west coast. Closer to home there is Bras d’Eau National Park’s quiet forest trails, the
            market town of Centre de Flacq, and championship golf — The Legend and The Links at
            Constance Belle Mare Plage right on the coast, or Anahita and Île aux Cerfs Golf Club a
            little further out. Browse the{' '}
            <InlineLink href="/mauritius-tours">full list of day tours</InlineLink> or the
            island-wide guide to{' '}
            <InlineLink href="/attractions">things to do in Mauritius</InlineLink>.
          </p>
        </ContentSection>

        <ContentSection id="dining" title="Where to eat near Belle Mare">
          <p>
            Belle Mare Public Beach has its own beach shack, Sun And Sand Chez Charlene, serving
            paella and mine frite a few steps from the sand — about as local as lunch gets. In the
            village, Symon’s Restaurant covers Indian, Chinese, seafood and grills all day at prices
            well below resort menus. For something dressier, Beach Rouge at LUX* Belle Mare puts
            Italian and seafood tables right on the beachfront, and Dolce Vita at Ambre Resort &amp;
            Spa in nearby Palmar does the same in a trattoria setting. Down the coast in Trou d’Eau
            Douce, about 15 minutes by road and a stop on any{' '}
            <InlineLink href="/ile-aux-cerfs-tours">Île aux Cerfs day</InlineLink>, Chez Tino has
            served Creole, Chinese and seafood since 1989, and La Case Poisson grills the day’s
            catch — bought straight off local fishermen — over charcoal. Between the public beach,
            the village and Trou d’Eau Douce, you are rarely more than ten minutes from a table,
            whether you want a beach shack or a resort dining room.
          </p>
        </ContentSection>

        <ContentSection id="getting-around" title="Getting around from Belle Mare">
          <p>
            There is no practical public transport for visitors, so plan on wheels: hire a{' '}
            <InlineLink href="/rent">car or scooter in Belle Mare</InlineLink> for independent
            exploring, book a private day tour and let the driver-guide handle the roads, or use a
            fixed-price <InlineLink href="/airport-transfers">airport transfer</InlineLink> for the
            45–60 minute run to and from SSR International. If you like planning, our free{' '}
            <InlineLink href="/ai-road-trip-planner">AI road-trip planner</InlineLink> builds a
            custom day around the stops you pick.
          </p>
          <RelatedLinks
            links={[
              { label: 'Belle Mare area guide', href: '/destinations/belle-mare' },
              { label: 'Car & scooter rental', href: '/rent' },
              { label: 'Île aux Cerfs tours', href: '/ile-aux-cerfs-tours' },
              { label: 'Catamaran cruises', href: '/mauritius-catamaran-cruise' },
              { label: 'All Mauritius tours', href: '/mauritius-tours' },
              { label: 'Airport transfers', href: '/airport-transfers' },
            ]}
          />
        </ContentSection>

        <ContentSection id="faq" title="Belle Mare activities — FAQ">
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="book" title="Book it all in one place">
          <p>
            Every activity on this page can be booked online with live availability and fixed EUR
            prices — no reseller markup, and the operator answering your WhatsApp is the one driving
            the boatside pickup. Tell us your dates and we will build the week around them.
          </p>
          <BookDirectCta primary={{ href: '/activities', label: 'Browse all activities' }} />
        </ContentSection>

        <EnquireRow message="Hi Belle Mare Tours! I'm staying near Belle Mare — what do you recommend for my dates?" />
      </InfoPage>
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata(PATH, DEFAULT_METADATA);
}
