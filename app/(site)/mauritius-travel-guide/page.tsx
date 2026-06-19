import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { articleJsonLd, breadcrumbListJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

const PATH = '/mauritius-travel-guide';
const PUBLISHED = '2026-06-19';
const TITLE = 'Mauritius Travel Guide 2026 — Plan the Perfect Trip';
const DESCRIPTION =
  'An up-to-date Mauritius travel guide from a local operator: when to visit, getting around, airport transfers, the five regions, the best things to do, sample itineraries and money-saving tips.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'Mauritius travel guide',
    'Mauritius travel guide 2026',
    'visit Mauritius',
    'Mauritius holiday',
    'things to do in Mauritius',
    'Belle Mare Tours',
  ],
  alternates: { canonical: PATH },
  openGraph: { type: 'article', title: TITLE, description: DESCRIPTION, url: `${SITE.url}${PATH}`, locale: 'en_GB', publishedTime: PUBLISHED },
};

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="font-semibold text-teal underline underline-offset-2 hover:text-teal-dark">
    {children}
  </Link>
);

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-9 scroll-mt-28 border-t border-ink/10 pt-8 first:mt-0 first:border-t-0 first:pt-0">
      <h2 className="text-[24px] font-extrabold tracking-tight text-ink">{title}</h2>
      <div className="mt-4 flex flex-col gap-3.5 text-[15.5px] leading-relaxed text-ink/80">{children}</div>
    </section>
  );
}

const FAQS = [
  {
    q: 'Is Mauritius worth visiting?',
    a: 'Yes — Mauritius packs white-sand beaches, a turquoise lagoon, volcanic mountains, waterfalls, wildlife parks and a rich Creole, Indian, Chinese and French culture into one small, safe and English- and French-speaking island. It suits honeymooners, families and adventurers alike.',
  },
  {
    q: 'How many days do you need in Mauritius?',
    a: 'Seven to ten days lets you enjoy your hotel and still see the north, south and west on day tours. With five days, focus on two regions. Our AI road-trip planner can build a day-by-day plan around your dates.',
  },
  {
    q: 'Do you need a car in Mauritius?',
    a: 'Not necessarily. There is no Uber, and island taxis can overcharge tourists, so most visitors use a private driver-guide for day tours and pre-booked airport transfers. Self-drive is an option but involves left-hand driving and busy roads.',
  },
  {
    q: 'What is the best area to stay in Mauritius?',
    a: 'The north (Grand Baie) is liveliest, the east (Belle Mare) is calm and beautiful, the west (Flic-en-Flac, Le Morne) is sunny and great for water sports, and the south is wild and scenic. Wherever you stay, we can collect you for any tour.',
  },
];

export default function MauritiusTravelGuidePage() {
  return (
    <>
      <JsonLd data={articleJsonLd({ title: TITLE, description: DESCRIPTION, path: PATH, datePublished: PUBLISHED, image: `${SITE.url}/hero-mauritius.jpg` })} />
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Mauritius travel guide', path: PATH },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />

      <InfoPage
        eyebrow="Mauritius travel guide"
        title="The complete Mauritius travel guide"
        intro={DESCRIPTION}
        meta={`Written and kept up to date by ${SITE.operator}, a licensed Mauritius tour operator.`}
      >
        <Section id="intro" title="Why visit Mauritius">
          <p>
            Mauritius is a volcanic island in the Indian Ocean, ringed by one of the world&apos;s largest coral
            lagoons. In a single short trip you can swim with dolphins at dawn, hike a UNESCO mountain, stand on
            seven-coloured volcanic earth and eat Creole street food in a 19th-century market. It is safe,
            welcoming, and almost everyone speaks English and French.
          </p>
          <p>
            This guide pulls together everything you need to plan a great trip — when to come, how to get around,
            the five regions, the best <A href="/attractions">things to do</A>, sample itineraries, and how to
            book without paying hotel or reseller mark-ups. For deeper dives, we link to our detailed{' '}
            <A href="/blog">travel guides</A> throughout.
          </p>
        </Section>

        <Section id="when" title="When to visit">
          <p>
            Mauritius is a year-round destination. The warm, humid summer runs roughly November to April (best for
            diving and the warmest sea); the cooler, drier winter runs May to October (best for hiking and
            whale-watching off the west coast). Cyclone risk peaks January–March, while September–November and
            May–June offer a sweet spot of fine weather and lower prices.
          </p>
          <p>
            For a month-by-month breakdown — including the cheapest times to fly and which activities suit each
            season — see our guide to the <A href="/blog/best-time-to-visit-mauritius">best time to visit Mauritius</A>.
          </p>
        </Section>

        <Section id="getting-around" title="Getting there & getting around">
          <p>
            Flights land at SSR International Airport in the south-east. There is no Uber or ride-hailing app, and
            metered island taxis are known to overcharge visitors, so the easiest, fixed-price option is a
            pre-booked private transfer. We run door-to-door{' '}
            <A href="/airport-transfers">airport transfers</A> to every major resort, with meet-and-greet, flight
            tracking and a free child seat.
          </p>
          <p>
            For getting around once you arrive, most visitors use a private driver-guide for day tours rather than
            self-driving. Read our full guides to{' '}
            <A href="/blog/mauritius-airport-transfer-guide">Mauritius airport transfers</A> and{' '}
            <A href="/blog/getting-around-mauritius">getting around the island</A>.
          </p>
        </Section>

        <Section id="regions" title="The five regions of Mauritius">
          <p>
            Mauritius divides neatly into five areas, each with its own character. The{' '}
            <strong>north</strong> (Grand Baie) is the liveliest, with the best nightlife and boat trips to the
            northern islets. The <strong>east</strong> (Belle Mare) — our home turf — has the calmest, most
            beautiful beaches and Île aux Cerfs. The <strong>south</strong> is wild and scenic: Chamarel, Le Morne
            and dramatic clifftop viewpoints. The <strong>west</strong> (Flic-en-Flac, Le Morne) is the sunniest,
            with Casela park and great water sports. The cooler <strong>central</strong> plateau holds the Trou
            aux Cerfs crater, tea country and the best hikes.
          </p>
          <p>
            Browse the highlights of every region in our directory of{' '}
            <A href="/attractions">things to do in Mauritius</A>.
          </p>
        </Section>

        <Section id="things-to-do" title="The best things to do">
          <p>
            The classics are a catamaran cruise to Île aux Cerfs, swimming with wild dolphins off Tamarin, an
            underwater sea walk, a 4x4 day in the south to Chamarel and Grand Bassin, and a hike up Le Morne or
            through the Black River Gorges. Families love Casela and La Vanille nature parks; thrill-seekers can
            zip-line, parasail or take a scenic seaplane flight.
          </p>
          <p>
            See and book all of these — with transparent pricing and instant confirmation — on our{' '}
            <A href="/activities">tours &amp; activities</A> page, or read the round-up of the{' '}
            <A href="/blog/things-to-do-in-mauritius">best things to do in Mauritius</A>. Two unmissable
            experiences have their own guides:{' '}
            <A href="/blog/swimming-with-dolphins-mauritius">swimming with dolphins</A> and a day on{' '}
            <A href="/blog/ile-aux-cerfs-guide">Île aux Cerfs</A>.
          </p>
        </Section>

        <Section id="itinerary" title="A sample week in Mauritius">
          <p>
            A good rhythm is to alternate beach days at your hotel with two or three full-day tours covering
            different regions — north one day, south the next, a catamaran or island day in between. That way you
            see the whole island without long daily drives.
          </p>
          <p>
            For a ready-made plan, see our day-by-day{' '}
            <A href="/blog/mauritius-7-day-itinerary">7-day Mauritius itinerary</A> — or build your own around the
            places you choose with our free <A href="/ai-road-trip-planner">AI road-trip planner</A>, which routes
            your day and gives an instant quote.
          </p>
        </Section>

        <Section id="beaches-nature" title="Beaches, waterfalls & nature">
          <p>
            Trou aux Biches and Belle Mare are among the longest and calmest beaches; Flic-en-Flac and Le Morne are
            the west-coast favourites. Inland, the Tamarind (Seven Cascades) and Chamarel waterfalls and the Black
            River Gorges reward a little effort with spectacular scenery.
          </p>
          <p>
            Plan your shoreline and waterfall days with our guides to the{' '}
            <A href="/blog/best-beaches-in-mauritius">best beaches</A> and the{' '}
            <A href="/blog/best-waterfalls-in-mauritius">best waterfalls in Mauritius</A>.
          </p>
        </Section>

        <Section id="money" title="Food, money & practical tips">
          <p>
            The currency is the Mauritian rupee; euros, dollars and cards are widely accepted at hotels and with
            us. Don&apos;t miss Creole and street food — dholl puri, gateaux piments, fresh seafood and the markets
            of Port Louis and Flacq. Tap water is generally safe in towns; reef-safe sunscreen and a light rain
            jacket are worth packing.
          </p>
          <p>
            The single biggest way to save is to book tours and transfers <strong>direct</strong> rather than
            through your hotel desk, which adds a mark-up. See how in our guide to doing{' '}
            <A href="/blog/mauritius-on-a-budget">Mauritius on a budget</A>.
          </p>
        </Section>

        <Section id="book" title="Book direct with Belle Mare Tours">
          <p>
            {SITE.operator} is a licensed Mauritian tour operator (BRN {SITE.brn}) that has run tours and transfers
            on the island since the early 2000s, rated 4.8/5 across more than a thousand reviews. We pick you up
            anywhere on the island, never make commission stops at souvenir shops, and quote a fixed, transparent
            price you can book and pay online in minutes — no hotel mark-up, no meter, no surprises.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href="/activities" className="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark">
              Browse tours &amp; activities
            </Link>
            <Link href="/airport-transfers" className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:border-teal hover:text-teal">
              Book an airport transfer
            </Link>
          </div>
        </Section>

        <Section id="faq" title="Mauritius travel FAQ">
          <div className="flex flex-col gap-2.5">
            {FAQS.map((f) => (
              <details key={f.q} className="group rounded-xl border border-ink/10 bg-white px-4 py-3 open:bg-cream/40">
                <summary className="cursor-pointer list-none text-[15px] font-bold text-ink marker:hidden">{f.q}</summary>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink/75">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <EnquireRow message="Hi Belle Mare Tours! I'm planning a trip to Mauritius and have a few questions." />
      </InfoPage>
    </>
  );
}
