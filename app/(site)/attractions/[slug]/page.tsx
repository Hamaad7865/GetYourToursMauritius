import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { AttractionCard } from '@/components/attractions/AttractionCard';
import { LocationMap } from '@/components/maps/LocationMap';
import { getPlace, loadPlaces } from '@/lib/services/places';
import {
  attractionPath,
  attractionImage,
  attractionMetaTitle,
  attractionMetaDescription,
  buildAttractionFaq,
  categoryMeta,
  formatVisitDuration,
  nearbyPlaces,
  ATTRACTION_EXTRA,
} from '@/lib/content/attractions';
import { attractionJsonLd, breadcrumbListJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const place = await getPlace(slug);
  if (!place) return { title: 'Attraction not found' };
  const title = attractionMetaTitle(place);
  const description = attractionMetaDescription(place);
  const canonical = attractionPath(place.id);
  const img = attractionImage(place.id);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `${SITE.url}${canonical}`,
      locale: 'en_GB',
      ...(img ? { images: [{ url: img.url }] } : {}),
    },
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

export default async function AttractionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const place = await getPlace(slug);
  if (!place) notFound();

  const all = await loadPlaces();
  const nearby = nearbyPlaces(all, place, 4);
  const faqs = buildAttractionFaq(place);
  const extra = ATTRACTION_EXTRA[place.id];
  const meta = categoryMeta(place.category);
  const path = attractionPath(place.id);
  const img = attractionImage(place.id);

  const aboutParas =
    extra?.body ?? [
      `${place.name} sits in the ${place.region.toLowerCase()} of Mauritius and is a favourite stop on a day out with ${SITE.operator}. Plan to spend ${formatVisitDuration(
        place.durationMin,
      )} here.`,
      `The easiest way to visit is a private transfer with a local driver-guide — we pick you up at your hotel anywhere on the island, with transparent fixed pricing and no commission stops.`,
    ];

  return (
    <>
      <JsonLd data={attractionJsonLd(place, { path, image: img?.url ?? null })} />
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Things to do in Mauritius', path: '/attractions' },
          { name: place.name, path },
        ])}
      />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <InfoPage
        eyebrow={`${meta.label} · ${place.region} Mauritius`}
        title={place.name}
        intro={place.blurb ?? `Visit ${place.name} in the ${place.region} of Mauritius with ${SITE.operator}.`}
      >
        {/* Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted"
        >
          <Link href="/" className="hover:text-teal">
            Home
          </Link>
          <span className="text-ink/25">/</span>
          <Link href="/attractions" className="hover:text-teal">
            Things to do in Mauritius
          </Link>
          <span className="text-ink/25">/</span>
          <span className="font-semibold text-ink">{place.name}</span>
        </nav>

        {/* Hero photo (real Wikimedia image where we have one) */}
        {img && (
          <figure className="mb-8 overflow-hidden rounded-2xl border border-ink/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={place.name} className="aspect-[16/9] w-full object-cover" />
            <figcaption className="px-4 py-2 text-[11px] text-ink-muted">
              Photo via{' '}
              <a
                href={img.source}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline hover:text-teal"
              >
                Wikimedia Commons
              </a>
            </figcaption>
          </figure>
        )}

        {/* Quick facts */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Region" value={`${place.region} coast`} />
          <Fact label="Type" value={meta.label} />
          <Fact label="Time to spend" value={formatVisitDuration(place.durationMin)} />
          <Fact label="Opening hours" value={place.closesAt ? `Until ~${place.closesAt}` : 'Open access'} />
        </div>

        {/* About */}
        <section className="mt-9 border-t border-ink/10 pt-8">
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">About {place.name}</h2>
          <div className="mt-4 flex flex-col gap-3.5">
            {aboutParas.map((para, i) => (
              <p key={i} className="m-0 text-[15px] leading-relaxed text-ink/80">
                {para}
              </p>
            ))}
          </div>
          {extra?.bestTime && (
            <p className="mt-4 rounded-xl border border-gold/30 bg-gold/[0.07] px-4 py-3 text-[14.5px] text-ink/85">
              <b className="text-ink">Best time to visit:</b> {extra.bestTime}
            </p>
          )}
          {extra?.tips && extra.tips.length > 0 && (
            <ul className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0">
              {extra.tips.map((tip) => (
                <li key={tip} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-ink/80">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-coral" />
                  {tip}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Map */}
        <section className="mt-9 border-t border-ink/10 pt-8">
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Where is {place.name}?</h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/70">
            {place.name} is on the {place.region.toLowerCase()} side of Mauritius. We collect you from your
            hotel anywhere on the island.
          </p>
          <div className="mt-4">
            <LocationMap query={`${place.name}, ${place.region}, Mauritius`} label={place.name} />
          </div>
        </section>

        {/* Plan your visit / CTA */}
        <section className="mt-9 border-t border-ink/10 pt-8">
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
            Visit {place.name} with {SITE.operator}
          </h2>
          <ul className="m-0 mt-4 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2">
            {[
              'Door-to-door hotel pickup anywhere in Mauritius',
              'Licensed, English- & French-speaking driver-guides',
              'Transparent fixed pricing — no meter, no commission stops',
              'Book online in minutes with instant confirmation',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-ink/85">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/activities"
              className="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
            >
              See tours that visit here
            </Link>
            <Link
              href="/ai-road-trip-planner"
              className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:border-teal hover:text-teal"
            >
              Add to a custom day with AI
            </Link>
          </div>
        </section>

        {/* Nearby */}
        {nearby.length > 0 && (
          <section className="mt-9 border-t border-ink/10 pt-8">
            <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Nearby attractions</h2>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {nearby.map((p) => (
                <AttractionCard key={p.id} place={p} />
              ))}
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="mt-9 border-t border-ink/10 pt-8">
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Frequently asked questions</h2>
          <div className="mt-4 flex flex-col gap-2.5">
            {faqs.map((f) => (
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

        <EnquireRow message={`Hi, I'd like to plan a visit to ${place.name}.`} />
      </InfoPage>
    </>
  );
}
