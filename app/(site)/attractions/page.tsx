import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { AttractionCard } from '@/components/attractions/AttractionCard';
import { loadPlaces } from '@/lib/catalogue/places';
import { REGION_ORDER, REGION_INTRO, attractionPath } from '@/lib/content/attractions';
import { breadcrumbListJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { SITE, OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

const TITLE = 'Things to Do in Mauritius: Top Attractions & Places to Visit';
const DESCRIPTION =
  'A local guide to the best places to visit in Mauritius — beaches, waterfalls, viewpoints, nature parks and cultural sites, organised by region. Visit any of them with Belle Mare Tours: private day tours, sightseeing and airport taxi transfers, booked online with transparent pricing.';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'things to do in Mauritius',
    'places to visit in Mauritius',
    'Mauritius attractions',
    'Mauritius tours',
    'Belle Mare Tours',
    'Mauritius sightseeing',
  ],
  alternates: { canonical: '/attractions' },
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE.url}/attractions`,
    locale: 'en_GB',
    images: [OG_IMAGE],
  },
};

export default async function AttractionsIndexPage() {
  const places = await loadPlaces();
  const groups = REGION_ORDER.map((region) => ({
    region,
    intro: REGION_INTRO[region],
    items: places.filter((p) => p.region === region),
  })).filter((g) => g.items.length > 0);

  const breadcrumb = breadcrumbListJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Things to do in Mauritius', path: '/attractions' },
  ]);
  const itemList = itemListJsonLd(
    places.map((p) => ({ name: p.name, path: attractionPath(p.id) })),
  );

  return (
    <>
      <JsonLd data={breadcrumb} />
      <JsonLd data={itemList} />
      <InfoPage
        eyebrow="Mauritius travel guide"
        title="Things to do in Mauritius"
        intro={`From turquoise lagoons and waterfalls to volcanic craters and colonial heritage, here are ${places.length || 'the'} of the island's best attractions — and how to visit each one with a local driver-guide from ${SITE.operator}.`}
      >
        {groups.length === 0 ? (
          <p className="text-[15px] text-ink/70">
            Our attractions guide is coming online shortly. In the meantime,{' '}
            <Link href="/activities" className="font-bold text-teal hover:text-teal-dark">
              browse our tours and activities
            </Link>
            .
          </p>
        ) : (
          groups.map((group) => (
            <section
              key={group.region}
              className="scroll-mt-28 border-t border-ink/10 py-9 first:border-t-0 first:pt-0"
            >
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
                {group.region} Mauritius
              </h2>
              <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink/70">
                {group.intro}
              </p>
              <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((place) => (
                  <AttractionCard key={place.id} place={place} />
                ))}
              </div>
            </section>
          ))
        )}

        <section className="mt-10 rounded-2xl border border-teal/20 bg-teal-tint/50 p-6 sm:p-8">
          <h2 className="text-[20px] font-extrabold tracking-tight text-ink">See them your way</h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/75">
            Pick a ready-made sightseeing tour, or design a custom day around the places you choose
            with our free AI road-trip planner — then book online in minutes with door-to-door
            pickup.
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

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/attractions', DEFAULT_METADATA);
}
