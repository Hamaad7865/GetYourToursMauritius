import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { TransferBookingWidget } from '@/components/transfers/TransferBookingWidget';
import { TransferRouteMap } from '@/components/transfers/TransferRouteMap';
import { TransferReviews } from '@/components/transfers/TransferReviews';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  getTransfer,
  transferMetaTitle,
  transferMetaDescription,
  localisedTransfer,
} from '@/lib/content/transfers';
import { parseGuestHotel } from '@/lib/content/guest-hotel';
import { transferServiceJsonLd, breadcrumbListJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { overrideMetadata } from '@/lib/seo/override';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import { getT, getLocale } from '@/lib/i18n/server';

export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = getTransfer(slug);
  if (!t) return { title: 'Transfer not found' };
  // Unlike the area/attraction meta helpers, `transferMetaTitle`/`transferMetaDescription` don't
  // read any of `TransferContent`'s translatable fields (`intro`/`included`/`faq`) at all — they're
  // hardcoded English sentences built from the hotel name and fare facts. Localising `t` first
  // would change nothing, so it's skipped; these stay English until someone writes French sentence
  // templates for them (a content task, not a wiring one).
  const title = transferMetaTitle(t);
  const description = transferMetaDescription(t);
  const canonical = t.path;
  return overrideMetadata(canonical, {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `${SITE.url}${canonical}`,
      images: [OG_IMAGE],
    },
  });
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-cream/50 p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-[15px] font-bold text-ink">{value}</div>
    </div>
  );
}

export default async function TransferDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ hotel?: string | string[]; hlat?: string; hlng?: string }>;
}) {
  const { slug } = await params;
  const rawHotel = getTransfer(slug);
  if (!rawHotel) notFound();
  const t = await getT();
  const locale = await getLocale();
  const hotel = localisedTransfer(rawHotel, locale);

  /**
   * The hotel the guest actually searched for, when it is not the listed one this page belongs to.
   * The search snaps an unlisted pick to the nearest listed hotel — that hotel's zone sets the fare
   * — but the guest must keep seeing the hotel THEY chose: it owns the H1, the route map and the
   * booking's driver-facing dropoff, while everything the server prices from (the slug) stays this
   * page's. Metadata and JSON-LD deliberately stay canonical: the ?hotel= variant canonicalises to
   * this page and is never indexed as its own document.
   */
  const guest = parseGuestHotel(await searchParams);
  const displayName = guest?.name ?? hotel.hotelName;

  const path = hotel.path;
  const homeLabel = t('Home');
  const airportTransfersLabel = t('Airport transfers');

  return (
    <>
      <JsonLd
        data={transferServiceJsonLd({
          name: `Airport transfer to ${hotel.hotelName}`,
          description: transferMetaDescription(hotel),
          path,
          area: hotel.area,
          fromPriceEur: hotel.fromPriceEur,
        })}
      />
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: homeLabel, path: '/' },
          { name: airportTransfersLabel, path: '/airport-transfers' },
          { name: hotel.hotelName, path },
        ])}
      />
      <JsonLd data={faqPageJsonLd(hotel.faq)} />

      <InfoPage
        eyebrow={`${t('Airport transfer')} · ${hotel.area}`}
        title={t('Airport transfer to {hotel}', { hotel: displayName })}
        intro={t(
          'Private, fixed-price transfer from SSR International Airport to {hotel} — from €{price} per car, about {min} minutes.',
          {
            hotel: displayName,
            price: hotel.fromPriceEur,
            min: hotel.durationMinFromAirport,
          },
        )}
      >
        {/* Breadcrumb */}
        <nav
          aria-label={t('Breadcrumb')}
          className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted"
        >
          <Link href="/" className="hover:text-teal">
            {homeLabel}
          </Link>
          <span className="text-ink/25">/</span>
          <Link href="/airport-transfers" className="hover:text-teal">
            {airportTransfersLabel}
          </Link>
          <span className="text-ink/25">/</span>
          <span className="font-semibold text-ink">{displayName}</span>
        </nav>

        {/* No zone-fare note here by owner directive (2026-08-05): the guest's hotel simply appears
            everywhere, and the neighbouring listed hotel that anchors the zone is never surfaced. */}

        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-10">
          <div className="min-w-0">
            {/* Quick facts */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label={t('From')} value={`€${hotel.fromPriceEur} / car`} />
              <Fact label={t('Drive time')} value={`~${hotel.durationMinFromAirport} min`} />
              <Fact label={t('Distance')} value={`~${hotel.distanceKmFromAirport} km`} />
              <Fact label={t('Coast')} value={`${hotel.region} (${hotel.area})`} />
            </div>

            {/* Route map: SSR airport → the guest's hotel when we have it, else this hotel. */}
            <div className="mt-6">
              <TransferRouteMap
                hotelName={displayName}
                lat={guest?.lat ?? hotel.lat}
                lng={guest?.lng ?? hotel.lng}
              />
            </div>

            {/* Intro */}
            <section className="mt-9 border-t border-ink/10 pt-8">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
                {t('Your transfer to {hotel}', { hotel: displayName })}
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-ink/80">{hotel.intro}</p>
            </section>

            {/* Included */}
            <section className="mt-9 border-t border-ink/10 pt-8">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
                {t("What's included")}
              </h2>
              <ul className="m-0 mt-4 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2">
                {hotel.included.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-[14.5px] leading-snug text-ink/85"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            {/* Nearby */}
            {hotel.nearbyAttractions.length > 0 && (
              <section className="mt-9 border-t border-ink/10 pt-8">
                <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
                  {t('Things to do near {area}', { area: hotel.area })}
                </h2>
                <ul className="m-0 mt-4 flex flex-wrap gap-2.5 p-0">
                  {hotel.nearbyAttractions.map((a) => (
                    <li
                      key={a}
                      className="rounded-full border border-ink/12 bg-white px-3.5 py-1.5 text-[13.5px] text-ink/80"
                    >
                      {a}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/attractions"
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-teal hover:text-teal-dark"
                >
                  {t('Explore things to do in Mauritius →')}
                </Link>
              </section>
            )}

            {/* FAQ */}
            <section className="mt-9 border-t border-ink/10 pt-8">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
                {t('Frequently asked questions')}
              </h2>
              <div className="mt-4 flex flex-col gap-2.5">
                {hotel.faq.map((f) => (
                  <details
                    key={f.q}
                    className="group rounded-xl border border-ink/10 bg-white px-4 py-3 open:bg-cream/40"
                  >
                    <summary className="cursor-pointer list-none text-[15px] font-bold text-ink marker:hidden">
                      {f.q}
                    </summary>
                    <p className="mt-2 text-[14.5px] leading-relaxed text-ink/75">{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>

          {/* Booking widget (sticky on desktop) */}
          <div className="mt-8 lg:mt-0">
            <div className="lg:sticky lg:top-24">
              <TransferBookingWidget
                slug={hotel.slug}
                hotelName={hotel.hotelName}
                guestHotel={guest?.name}
                region={hotel.region}
                durationMin={hotel.durationMinFromAirport}
              />
            </div>
          </div>
        </div>

        <TransferReviews count={3} />

        <div className="mt-10 border-t border-ink/10 pt-8">
          <p className="text-[13px] text-ink-muted">
            {t('Prefer to arrange by message? We’re happy to help.')}
          </p>
          <EnquireRow
            message={`Hi Belle Mare Tours! I'd like an airport transfer to ${hotel.hotelName}. Here are my flight details and party size:`}
          />
        </div>
      </InfoPage>
    </>
  );
}
