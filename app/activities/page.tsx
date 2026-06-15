import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { CategoryChips } from '@/components/catalogue/CategoryChips';
import { ActivityGrid } from '@/components/catalogue/ActivityGrid';
import { SearchFilterBar } from '@/components/catalogue/SearchFilterBar';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { withLocalPhotos } from '@/lib/catalogue/local-photos';
import {
  BROWSE_PAGE_SIZE,
  browseQueryString,
  parseBrowseParams,
  type BrowseParams,
} from '@/lib/catalogue/browse';
import { SITE } from '@/lib/seo/site';
import type { TourSummary } from '@/lib/validation/tours';

export const runtime = 'edge';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function heading(params: BrowseParams): string {
  if (params.q) return `Results for “${params.q}”`;
  if (params.category) return params.category;
  if (params.type === 'transport') return 'Airport transfers & transport';
  if (params.type === 'activity') return 'Things to do';
  return 'All activities & transfers';
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const params = parseBrowseParams(await searchParams);
  const title = `${heading(params)} | ${SITE.operator}`;
  return {
    title,
    description: SITE.description,
    alternates: { canonical: '/activities' },
    openGraph: { type: 'website', title, description: SITE.description, locale: 'en_GB' },
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
    return { ...result, items: result.items.map(withLocalPhotos) };
  } catch (error) {
    console.error('[browse] catalogue fetch failed', error);
    return { items: [], total: 0 };
  }
}

export default async function ActivitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseBrowseParams(await searchParams);
  const { items, total } = await loadResults(params);
  const totalPages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
  // A tampered/stale ?page beyond the last page would render an empty grid under a
  // "Page N of N" footer — send the visitor to the last real page instead.
  if (total > 0 && params.page > totalPages) {
    redirect(`/activities${browseQueryString({ ...params, page: totalPages })}`);
  }
  const page = Math.min(params.page, totalPages);

  return (
    <>
      <SiteHeader />
      <main className="bg-cream">
        <div className="mx-auto max-w-shell px-6 pb-16 pt-6">
          <div className="mb-2">
            <h1 className="m-0 font-display text-3xl font-medium tracking-tight text-ink">
              {heading(params)}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {total > 0 ? `${total} ${total === 1 ? 'experience' : 'experiences'}` : 'Experiences'}{' '}
              operated by {SITE.operator} · East-coast Mauritius
            </p>
          </div>

          <CategoryChips active={params.category} />

          <div className="mb-7">
            <SearchFilterBar params={params} />
          </div>

          <ActivityGrid activities={items} />

          {totalPages > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-10 flex items-center justify-center gap-3 text-sm"
            >
              {page > 1 ? (
                <Link
                  href={`/activities${browseQueryString({ ...params, page: page - 1 })}`}
                  className="rounded-xl border border-ink/12 bg-white px-4 py-2.5 font-semibold text-ink hover:border-teal"
                  rel="prev"
                >
                  ← Previous
                </Link>
              ) : (
                <span className="rounded-xl border border-ink/[0.06] px-4 py-2.5 font-semibold text-ink-muted/50">
                  ← Previous
                </span>
              )}
              <span className="text-ink-muted">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/activities${browseQueryString({ ...params, page: page + 1 })}`}
                  className="rounded-xl border border-ink/12 bg-white px-4 py-2.5 font-semibold text-ink hover:border-teal"
                  rel="next"
                >
                  Next →
                </Link>
              ) : (
                <span className="rounded-xl border border-ink/[0.06] px-4 py-2.5 font-semibold text-ink-muted/50">
                  Next →
                </span>
              )}
            </nav>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
