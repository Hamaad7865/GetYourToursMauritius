import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { getArea, areaMetaTitle, areaMetaDescription } from '@/lib/content/areas';
import { destinationJsonLd, breadcrumbListJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { SITE, OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const a = getArea(slug);
  if (!a) return { title: 'Destination not found' };
  const title = areaMetaTitle(a);
  const description = areaMetaDescription(a);
  return {
    title,
    description,
    alternates: { canonical: a.path },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `${SITE.url}${a.path}`,
      locale: 'en_GB',
      images: [OG_IMAGE],
    },
  };
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0">
      {items.map((it) => (
        <li key={it} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-ink/85">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
          {it}
        </li>
      ))}
    </ul>
  );
}

export default async function DestinationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const a = getArea(slug);
  if (!a) notFound();

  return (
    <>
      <JsonLd data={destinationJsonLd({ name: a.name, description: a.intro, path: a.path })} />
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Destinations', path: '/destinations' },
          { name: a.name, path: a.path },
        ])}
      />
      <JsonLd data={faqPageJsonLd(a.faq)} />

      <InfoPage
        eyebrow={`Destination guide · ${a.region} coast`}
        title={`${a.name}, Mauritius`}
        intro={a.intro}
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
          <Link href="/destinations" className="hover:text-teal">
            Destinations
          </Link>
          <span className="text-ink/25">/</span>
          <span className="font-semibold text-ink">{a.name}</span>
        </nav>

        {/* Good for */}
        {a.goodFor.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {a.goodFor.map((g) => (
              <span
                key={g}
                className="rounded-full bg-teal-tint px-3 py-1 text-[12.5px] font-semibold text-teal-dark"
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {/* Highlights */}
        <section className="mt-9 border-t border-ink/10 pt-8">
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
            Things to do in {a.name}
          </h2>
          <List items={a.highlights} />
          <Link
            href="/attractions"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-teal hover:text-teal-dark"
          >
            Browse all Mauritius attractions →
          </Link>
        </section>

        {/* Beaches */}
        {a.beaches.length > 0 && (
          <section className="mt-9 border-t border-ink/10 pt-8">
            <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
              Beaches near {a.name}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {a.beaches.map((b) => (
                <span
                  key={b}
                  className="rounded-full border border-ink/12 bg-white px-3.5 py-1.5 text-[13.5px] text-ink/80"
                >
                  {b}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Getting there */}
        <section className="mt-9 border-t border-ink/10 pt-8">
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
            Getting to {a.name}
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink/80">{a.gettingThere}</p>
          <Link
            href="/airport-transfers"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-teal hover:text-teal-dark"
          >
            See airport transfers &amp; prices →
          </Link>
        </section>

        {/* Nearby attractions */}
        {a.nearbyAttractions.length > 0 && (
          <section className="mt-9 border-t border-ink/10 pt-8">
            <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
              What&apos;s nearby
            </h2>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {a.nearbyAttractions.map((n) => (
                <span
                  key={n}
                  className="rounded-full border border-ink/12 bg-white px-3.5 py-1.5 text-[13.5px] text-ink/80"
                >
                  {n}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="mt-9 border-t border-ink/10 pt-8">
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
            Explore from {a.name}
          </h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/75">
            Book a private day tour or excursion, or design your own day around {a.name} with our
            free AI road-trip planner — with door-to-door pickup and instant confirmation.
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

        {/* FAQ */}
        <section className="mt-9 border-t border-ink/10 pt-8">
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
            Frequently asked questions
          </h2>
          <div className="mt-4 flex flex-col gap-2.5">
            {a.faq.map((f) => (
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

        <EnquireRow
          message={`Hi Belle Mare Tours! I'm staying in ${a.name} and would like to plan some tours and a transfer.`}
        />
      </InfoPage>
    </>
  );
}
