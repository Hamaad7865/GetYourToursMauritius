import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { transfers, TRANSFER_REGION_ORDER, type Transfer } from '@/lib/content/transfers';
import { reviewStats } from '@/lib/content/reviews';
import { HotelMap } from '@/components/transfers/HotelMap';
import { TransferSearch } from '@/components/transfers/TransferSearch';
import { TransferSteps } from '@/components/transfers/TransferSteps';
import { TransferReviews } from '@/components/transfers/TransferReviews';
import { TransferGuides } from '@/components/transfers/TransferGuides';
import { TransferService } from '@/components/transfers/TransferService';
import { IconCheck, IconClock, IconPin, IconStar } from '@/components/ui/icons';
import { breadcrumbListJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

const TITLE = 'Mauritius Airport Transfers — Private Taxi to Your Hotel';
const DESCRIPTION =
  'Pre-booked private airport transfers from SSR Airport to every major Mauritius resort. Fixed prices from €25 per car, meet & greet, flight tracking and a free child seat — no meter, no surprises. Find your hotel and get a fast quote with Belle Mare Tours.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'Mauritius airport transfer',
    'SSR airport taxi',
    'airport transfer Mauritius',
    'private taxi Mauritius',
    'Belle Mare Tours',
  ],
  alternates: { canonical: '/airport-transfers' },
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: `${SITE.url}/airport-transfers`, locale: 'en_GB' },
};

function TransferCard({ t }: { t: Transfer }) {
  return (
    <Link
      href={t.path}
      className="group flex flex-col rounded-2xl border border-ink/10 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-teal">{t.area}</div>
      <h3 className="mt-1 text-[16px] font-extrabold leading-snug text-ink group-hover:text-teal">{t.hotelName}</h3>
      <div className="mt-4 flex items-center justify-between border-t border-ink/8 pt-3 text-[13px]">
        <span className="text-ink/65">~{t.durationMinFromAirport} min from airport</span>
        <span className="font-extrabold text-ink">from €{t.fromPriceEur}</span>
      </div>
    </Link>
  );
}

export default function AirportTransfersIndexPage() {
  const groups = TRANSFER_REGION_ORDER.map((region) => ({
    region,
    items: transfers.filter((t) => t.region === region),
  })).filter((g) => g.items.length > 0);

  const breadcrumb = breadcrumbListJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Airport transfers', path: '/airport-transfers' },
  ]);
  const itemList = itemListJsonLd(transfers.map((t) => ({ name: `Airport transfer to ${t.hotelName}`, path: t.path })));

  return (
    <>
      <JsonLd data={breadcrumb} />
      <JsonLd data={itemList} />
      <InfoPage
        eyebrow="Airport transfers"
        title="Mauritius airport transfers, hotel by hotel"
        intro={DESCRIPTION}
      >
        {/* Search: airport is the fixed origin; find your hotel to start booking */}
        <TransferSearch />

        <p className="mt-6 text-[15px] leading-relaxed text-ink/75">
          Every transfer is private, door-to-door and fixed-price — your own English- and French-speaking
          driver meets you in arrivals, tracks your flight, and takes you straight to your hotel. Pick your
          resort below for drive times and a price, or see how it all works on our{' '}
          <Link href="/airport-transfer" className="font-bold text-teal hover:text-teal-dark">
            airport transfer overview
          </Link>
          .
        </p>

        {/* Trust strip */}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-ink/10 bg-cream/40 px-5 py-4 text-[13.5px] font-semibold text-ink">
          <span className="flex items-center gap-1.5">
            <IconStar width={16} height={16} className="text-gold-light" /> {reviewStats.average.toFixed(1)}/5 ·{' '}
            {reviewStats.total.toLocaleString('en-GB')} reviews
          </span>
          <span className="flex items-center gap-1.5">
            <IconPin width={16} height={16} className="text-teal" /> Meet &amp; greet at arrivals
          </span>
          <span className="flex items-center gap-1.5">
            <IconClock width={16} height={16} className="text-teal" /> Free flight tracking
          </span>
          <span className="flex items-center gap-1.5">
            <IconCheck width={16} height={16} className="text-teal" /> Fixed price · free cancellation
          </span>
        </div>

        <TransferSteps />

        {/* All-hotels map */}
        <section className="mt-12 border-t border-ink/10 pt-9">
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Find your hotel on the map</h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/75">
            Tap your resort to see the driving route from SSR Airport, the distance and time, and a price.
          </p>
          <div className="mt-5">
            <HotelMap />
          </div>
        </section>

        <h2 className="mt-12 border-t border-ink/10 pt-9 text-[22px] font-extrabold tracking-tight text-ink">
          Transfers by region
        </h2>
        {groups.map((g) => (
          <section key={g.region} className="border-t border-ink/10 py-9 first:border-t-0 first:pt-0">
            <h2 className="text-[22px] font-extrabold tracking-tight text-ink">{g.region} coast</h2>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((t) => (
                <TransferCard key={t.slug} t={t} />
              ))}
            </div>
          </section>
        ))}

        <TransferReviews />
        <TransferGuides />
        <TransferService />

        <section className="mt-10 rounded-2xl border border-teal/20 bg-teal-tint/50 p-6 sm:p-8">
          <h2 className="text-[20px] font-extrabold tracking-tight text-ink">Not your hotel?</h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/75">
            We transfer to every corner of Mauritius — just message us your hotel and flight details for a
            fixed quote. Travelling to explore? Add a tour or build a custom day while you&apos;re here.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/activities"
              className="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
            >
              Browse tours &amp; activities
            </Link>
            <Link
              href="/ai-road-trip-planner"
              className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:border-teal hover:text-teal"
            >
              Plan a custom day with AI
            </Link>
          </div>
        </section>
      </InfoPage>
    </>
  );
}
