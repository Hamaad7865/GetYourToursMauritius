import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { TransferBookingWidget } from '@/components/transfers/TransferBookingWidget';
import { TransferRouteMap } from '@/components/transfers/TransferRouteMap';
import { TransferReviews } from '@/components/transfers/TransferReviews';
import { JsonLd } from '@/components/seo/JsonLd';
import { getTransfer, transferMetaTitle, transferMetaDescription } from '@/lib/content/transfers';
import {
  transferServiceJsonLd,
  breadcrumbListJsonLd,
  faqPageJsonLd,
} from '@/lib/seo/jsonld';
import { SITE, OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = getTransfer(slug);
  if (!t) return { title: 'Transfer not found' };
  const title = transferMetaTitle(t);
  const description = transferMetaDescription(t);
  const canonical = t.path;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', title, description, url: `${SITE.url}${canonical}`, locale: 'en_GB', images: [OG_IMAGE] },
  };
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
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = getTransfer(slug);
  if (!t) notFound();

  const path = t.path;

  return (
    <>
      <JsonLd
        data={transferServiceJsonLd({
          name: `Airport transfer to ${t.hotelName}`,
          description: transferMetaDescription(t),
          path,
          area: t.area,
          fromPriceEur: t.fromPriceEur,
        })}
      />
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Airport transfers', path: '/airport-transfers' },
          { name: t.hotelName, path },
        ])}
      />
      <JsonLd data={faqPageJsonLd(t.faq)} />

      <InfoPage
        eyebrow={`Airport transfer · ${t.area}`}
        title={`Airport transfer to ${t.hotelName}`}
        intro={`Private, fixed-price transfer from SSR International Airport to ${t.hotelName} — from €${t.fromPriceEur} per car, about ${t.durationMinFromAirport} minutes.`}
      >
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
          <Link href="/" className="hover:text-teal">Home</Link>
          <span className="text-ink/25">/</span>
          <Link href="/airport-transfers" className="hover:text-teal">Airport transfers</Link>
          <span className="text-ink/25">/</span>
          <span className="font-semibold text-ink">{t.hotelName}</span>
        </nav>

        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-10">
          <div className="min-w-0">
            {/* Quick facts */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="From" value={`€${t.fromPriceEur} / car`} />
              <Fact label="Drive time" value={`~${t.durationMinFromAirport} min`} />
              <Fact label="Distance" value={`~${t.distanceKmFromAirport} km`} />
              <Fact label="Coast" value={`${t.region} (${t.area})`} />
            </div>

            {/* Route map: SSR airport → this hotel */}
            <div className="mt-6">
              <TransferRouteMap hotelName={t.hotelName} lat={t.lat} lng={t.lng} />
            </div>

            {/* Intro */}
            <section className="mt-9 border-t border-ink/10 pt-8">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
                Your transfer to {t.hotelName}
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-ink/80">{t.intro}</p>
            </section>

            {/* Included */}
            <section className="mt-9 border-t border-ink/10 pt-8">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">What&apos;s included</h2>
              <ul className="m-0 mt-4 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2">
                {t.included.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-ink/85">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            {/* Nearby */}
            {t.nearbyAttractions.length > 0 && (
              <section className="mt-9 border-t border-ink/10 pt-8">
                <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Things to do near {t.area}</h2>
                <ul className="m-0 mt-4 flex flex-wrap gap-2.5 p-0">
                  {t.nearbyAttractions.map((a) => (
                    <li key={a} className="rounded-full border border-ink/12 bg-white px-3.5 py-1.5 text-[13.5px] text-ink/80">
                      {a}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/attractions"
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-teal hover:text-teal-dark"
                >
                  Explore things to do in Mauritius →
                </Link>
              </section>
            )}

            {/* FAQ */}
            <section className="mt-9 border-t border-ink/10 pt-8">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Frequently asked questions</h2>
              <div className="mt-4 flex flex-col gap-2.5">
                {t.faq.map((f) => (
                  <details key={f.q} className="group rounded-xl border border-ink/10 bg-white px-4 py-3 open:bg-cream/40">
                    <summary className="cursor-pointer list-none text-[15px] font-bold text-ink marker:hidden">{f.q}</summary>
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
                slug={t.slug}
                hotelName={t.hotelName}
                region={t.region}
                durationMin={t.durationMinFromAirport}
              />
            </div>
          </div>
        </div>

        <TransferReviews count={3} />

        <div className="mt-10 border-t border-ink/10 pt-8">
          <p className="text-[13px] text-ink-muted">Prefer to arrange by message? We’re happy to help.</p>
          <EnquireRow
            message={`Hi Belle Mare Tours! I'd like an airport transfer to ${t.hotelName}. Here are my flight details and party size:`}
          />
        </div>
      </InfoPage>
    </>
  );
}
