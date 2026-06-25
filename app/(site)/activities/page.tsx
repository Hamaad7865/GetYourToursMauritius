import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { CategoryChips } from '@/components/catalogue/CategoryChips';
import { ActivityGrid } from '@/components/catalogue/ActivityGrid';
import { PlannerPromoCard } from '@/components/catalogue/PlannerPromoCard';
import { SearchFilterBar } from '@/components/catalogue/SearchFilterBar';
import { isSightseeingCategory } from '@/lib/categories/categories';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import {
  BROWSE_PAGE_SIZE,
  browseQueryString,
  parseBrowseParams,
  type BrowseParams,
} from '@/lib/catalogue/browse';
import { SITE } from '@/lib/seo/site';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbListJsonLd, faqPageJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { FaqAccordion } from '@/components/seo/LandingSections';
import { getT } from '@/lib/i18n/server';
import type { TourSummary } from '@/lib/validation/tours';

// Raw English so the visible accordion answers match the FAQPage JSON-LD exactly (rich-result eligible).
const ACTIVITIES_FAQS: { q: string; a: string }[] = [
  {
    q: 'What activities can I book in Mauritius?',
    a: 'Catamaran cruises, dolphin swims, Île aux Cerfs day trips, sea (undersea) walks, private sightseeing and island day tours, plus airport transfers — all bookable online with instant confirmation.',
  },
  {
    q: 'How do I book a Mauritius activity online?',
    a: 'Pick an activity, choose your date and party size, and pay securely by card. You get an instant e-voucher by email — no reseller in the middle and no markup.',
  },
  {
    q: 'Are the activities run by a local operator?',
    a: 'Yes. Every activity is operated direct by Belle Mare Tours, a licensed Mauritian operator on the east coast — so you book with the people running the trip, not an overseas reseller.',
  },
  {
    q: 'Can I be picked up from my hotel?',
    a: 'Most activities include or offer door-to-door hotel pickup. The pickup option and any transport fee are shown on each activity before you book.',
  },
];

export const runtime = 'edge';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function heading(params: BrowseParams, t: Translate): string {
  if (params.q) return t('Results for “{q}”', { q: params.q });
  if (params.category) return params.category;
  if (params.type === 'transport') return t('Airport transfers & transport');
  if (params.type === 'activity') return t('Things to do');
  // Base (unfiltered) view: keyword-forward H1 — this is the page that should rank for "Mauritius activities".
  return t('Mauritius Activities & Tours');
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const params = parseBrowseParams(await searchParams);
  const t = await getT();
  // The unfiltered catalogue is the page that should rank for "Mauritius activities" — give it a
  // purpose-built title/description. Filtered views keep their dynamic heading. `absolute` in both
  // cases so the root "%s | GetYourToursMauritius" template doesn't double-brand an already-branded title.
  const isBase = !params.q && !params.category && params.type === undefined;
  const title = isBase
    ? 'Mauritius Activities & Tours — Book Online | Belle Mare Tours'
    : `${heading(params, t)} | ${SITE.operator}`;
  const description = isBase
    ? 'Browse and book Mauritius activities and tours direct with Belle Mare Tours — catamaran cruises, dolphin swims, Île aux Cerfs trips, sea walks and private island day tours. Instant confirmation, no reseller markup.'
    : SITE.description;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: '/activities' },
    openGraph: { type: 'website', title, description, locale: 'en_GB' },
  };
}

async function loadResults(
  params: BrowseParams,
): Promise<{ items: TourSummary[]; total: number }> {
  try {
    const result = await searchActivities(publicServiceContext(), {
      page: params.page,
      pageSize: BROWSE_PAGE_SIZE,
      q: params.q,
      category: params.category,
      type: params.type,
    });
    return result;
  } catch (error) {
    console.error('[browse] catalogue fetch failed', error);
    return { items: [], total: 0 };
  }
}

export default async function ActivitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseBrowseParams(await searchParams);
  const t = await getT();
  const { items, total } = await loadResults(params);
  const totalPages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
  // A tampered/stale ?page beyond the last page would render an empty grid under a
  // "Page N of N" footer — send the visitor to the last real page instead.
  if (total > 0 && params.page > totalPages) {
    redirect(`/activities${browseQueryString({ ...params, page: totalPages })}`);
  }
  const page = Math.min(params.page, totalPages);
  const isBase = !params.q && !params.category && params.type === undefined;

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Mauritius Activities', path: '/activities' },
        ])}
      />
      {isBase && <JsonLd data={faqPageJsonLd(ACTIVITIES_FAQS)} />}
      {isBase && page === 1 && items.length > 0 && (
        <JsonLd data={itemListJsonLd(items.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })))} />
      )}
      <GygHeader showSearch={false} />
      <main className="bg-cream">
        <div className="mx-auto max-w-shell px-6 pb-16 pt-6">
          <div className="mb-2">
            <h1 className="m-0 font-display text-3xl font-medium tracking-tight text-ink">
              {heading(params, t)}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {total > 0
                ? total === 1
                  ? t('{n} experience', { n: total })
                  : t('{n} experiences', { n: total })
                : t('Experiences')}{' '}
              {t('operated by {operator} · East-coast Mauritius', { operator: SITE.operator })}
            </p>
            {isBase && (
              <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink/70">
                Browse and book the full range of Mauritius activities and tours direct with Belle Mare Tours —
                catamaran cruises, dolphin swims, Île aux Cerfs trips, sea walks and private island day tours,
                all with instant confirmation and no reseller markup.
              </p>
            )}
          </div>

          <CategoryChips active={params.category} />

          {/* Mobile: pin the search/type filter below the header so it stays reachable while scrolling
              results. Desktop: a normal inline row. */}
          <div className="sticky top-[58px] z-30 -mx-6 mb-7 border-b border-ink/10 bg-cream px-6 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
            <SearchFilterBar params={params} />
          </div>

          <ActivityGrid
            activities={items}
            leadingCard={
              isSightseeingCategory(params.category) && page === 1 ? <PlannerPromoCard /> : undefined
            }
          />

          {totalPages > 1 && (
            <nav
              aria-label={t('Pagination')}
              className="mt-10 flex items-center justify-center gap-3 text-sm"
            >
              {page > 1 ? (
                <Link
                  href={`/activities${browseQueryString({ ...params, page: page - 1 })}`}
                  className="rounded-xl border border-ink/12 bg-white px-4 py-2.5 font-semibold text-ink hover:border-teal"
                  rel="prev"
                >
                  ← {t('Previous')}
                </Link>
              ) : (
                <span className="rounded-xl border border-ink/[0.06] px-4 py-2.5 font-semibold text-ink-muted/50">
                  ← {t('Previous')}
                </span>
              )}
              <span className="text-ink-muted">
                {t('Page {page} of {total}', { page, total: totalPages })}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/activities${browseQueryString({ ...params, page: page + 1 })}`}
                  className="rounded-xl border border-ink/12 bg-white px-4 py-2.5 font-semibold text-ink hover:border-teal"
                  rel="next"
                >
                  {t('Next')} →
                </Link>
              ) : (
                <span className="rounded-xl border border-ink/[0.06] px-4 py-2.5 font-semibold text-ink-muted/50">
                  {t('Next')} →
                </span>
              )}
            </nav>
          )}

          {isBase && (
            <section className="mt-14 border-t border-ink/10 pt-10">
              <h2 className="text-2xl font-extrabold tracking-tight text-ink">
                Mauritius activities — frequently asked questions
              </h2>
              <div className="mt-5 max-w-3xl">
                <FaqAccordion items={ACTIVITIES_FAQS} />
              </div>
            </section>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
