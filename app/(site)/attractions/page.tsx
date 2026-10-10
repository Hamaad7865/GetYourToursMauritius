import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { AttractionCard } from '@/components/attractions/AttractionCard';
import { loadPlaces } from '@/lib/catalogue/places';
import {
  REGION_ORDER,
  attractionPath,
  localisedPlace,
  localisedRegionIntro,
} from '@/lib/content/attractions';
import { breadcrumbListJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import { getT, getLocale } from '@/lib/i18n/server';
import { localePath } from '@/lib/i18n/routing';
import { ATTRACTION_TYPES, regionAnchor } from '@/lib/nav/mega-menu';

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
    images: [OG_IMAGE],
  },
};

export default async function AttractionsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const rawPlaces = await loadPlaces();
  const t = await getT();
  const locale = await getLocale();
  const places = rawPlaces.map((p) => localisedPlace(p, locale));

  // `?type=beach` narrows the guide to one kind of place (the header's "Attraction types" menu
  // links here). It is a VIEW of this page, not another page: the canonical stays /attractions and
  // the structured data below still lists every place. An unknown type simply shows everything.
  const { type } = await searchParams;
  const activeType = ATTRACTION_TYPES.find((x) => x.slug === type) ?? null;
  const shown = activeType ? places.filter((p) => p.category === activeType.category) : places;
  // Only offer a type that has places, so no chip leads to an empty guide.
  const types = ATTRACTION_TYPES.filter((x) => places.some((p) => p.category === x.category));

  const groups = REGION_ORDER.map((region) => ({
    region,
    intro: localisedRegionIntro(region, locale),
    items: shown.filter((p) => p.region === region),
  })).filter((g) => g.items.length > 0);

  const breadcrumb = breadcrumbListJsonLd([
    { name: t('Home'), path: '/' },
    { name: t('Things to do in Mauritius'), path: '/attractions' },
  ]);
  const itemList = itemListJsonLd(
    places.map((p) => ({ name: p.name, path: attractionPath(p.id) })),
  );

  return (
    <>
      <JsonLd data={breadcrumb} />
      <JsonLd data={itemList} />
      <InfoPage
        eyebrow={t('Mauritius travel guide')}
        title={t('Things to do in Mauritius')}
        intro={t(
          "From turquoise lagoons and waterfalls to volcanic craters and colonial heritage, here are {count} of the island's best attractions — and how to visit each one with a local driver-guide from {operator}.",
          { count: places.length || 'the', operator: SITE.operator },
        )}
      >
        {types.length > 1 && (
          <nav aria-label={t('Attraction types')} className="mb-9 flex flex-wrap gap-2">
            {[null, ...types].map((option) => {
              const current = (option?.slug ?? null) === (activeType?.slug ?? null);
              return (
                <Link
                  key={option?.slug ?? 'all'}
                  href={localePath(
                    locale,
                    option ? `/attractions?type=${option.slug}` : '/attractions',
                  )}
                  aria-current={current ? 'page' : undefined}
                  className={`rounded-full border px-4 py-2 text-[14px] font-semibold transition-colors ${
                    current
                      ? 'border-teal-dark bg-teal-dark text-white'
                      : 'border-ink/15 bg-white text-ink hover:border-teal hover:text-teal'
                  }`}
                >
                  {option ? t(option.label) : t('All')}
                </Link>
              );
            })}
          </nav>
        )}

        {groups.length === 0 ? (
          <p className="text-[15px] text-ink/70">
            {t('Our attractions guide is coming online shortly. In the meantime,')}{' '}
            <Link href="/activities" className="font-bold text-teal hover:text-teal-dark">
              {t('browse our tours and activities')}
            </Link>
            .
          </p>
        ) : (
          groups.map((group) => (
            <section
              key={group.region}
              id={regionAnchor(group.region)}
              className="scroll-mt-28 border-t border-ink/10 py-9 first:border-t-0 first:pt-0"
            >
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
                {t('{region} Mauritius', { region: group.region })}
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
          <h2 className="text-[20px] font-extrabold tracking-tight text-ink">
            {t('See them your way')}
          </h2>
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
              {t('Browse tours & activities')}
            </Link>
            <Link
              href="/ai-road-trip-planner"
              className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:border-teal hover:text-teal"
            >
              {t('Plan a custom day with AI')}
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
