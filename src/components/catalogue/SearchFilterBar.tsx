import type { BrowseParams } from '@/lib/catalogue/browse';
import { IconSearch } from '@/components/ui/icons';
import { getT } from '@/lib/i18n/server';

/**
 * No-JS filter bar: a plain GET form to /activities. Submitting keeps the active
 * category (hidden field) and applies the search term + type. Category switching is
 * handled by the chips above; this is the search + type facet.
 */
export async function SearchFilterBar({ params }: { params: BrowseParams }) {
  const t = await getT();
  return (
    <form method="get" action="/activities" className="flex items-center gap-2 sm:gap-2.5">
      {params.category && <input type="hidden" name="category" value={params.category} />}
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-3">
        <IconSearch width={18} height={18} className="shrink-0 text-teal" />
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder={t('Search activities…')}
          aria-label={t('Search activities')}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
      <label className="flex shrink-0 items-center gap-1.5 rounded-xl border border-ink/12 bg-white px-2.5 py-3 text-sm">
        <span className="hidden font-semibold text-ink-muted sm:inline">{t('Type')}</span>
        <select
          name="type"
          defaultValue={params.type ?? ''}
          aria-label={t('Activity type')}
          className="cursor-pointer bg-transparent font-semibold text-ink outline-none"
        >
          <option value="">{t('All')}</option>
          <option value="activity">{t('Activities')}</option>
          <option value="transport">{t('Transfers')}</option>
        </select>
      </label>
      <button
        type="submit"
        className="shrink-0 rounded-xl bg-coral px-4 py-3 text-sm font-bold text-white hover:opacity-90 sm:px-5"
      >
        {t('Search')}
      </button>
    </form>
  );
}
