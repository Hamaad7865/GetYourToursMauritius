import type { BrowseParams } from '@/lib/catalogue/browse';
import { IconSearch } from '@/components/ui/icons';

/**
 * No-JS filter bar: a plain GET form to /activities. Submitting keeps the active
 * category (hidden field) and applies the search term + type. Category switching is
 * handled by the chips above; this is the search + type facet.
 */
export function SearchFilterBar({ params }: { params: BrowseParams }) {
  return (
    <form
      method="get"
      action="/activities"
      className="flex flex-col gap-2.5 sm:flex-row sm:items-center"
    >
      {params.category && <input type="hidden" name="category" value={params.category} />}
      <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-ink/12 bg-white px-3.5 py-2.5">
        <IconSearch width={18} height={18} className="text-teal" />
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search activities, locations…"
          aria-label="Search activities"
          className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
      <label className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3.5 py-2.5 text-sm">
        <span className="font-semibold text-ink-muted">Type</span>
        <select
          name="type"
          defaultValue={params.type ?? ''}
          className="cursor-pointer bg-transparent font-semibold text-ink outline-none"
        >
          <option value="">All</option>
          <option value="activity">Activities</option>
          <option value="transport">Transfers</option>
        </select>
      </label>
      <button
        type="submit"
        className="rounded-xl bg-coral px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
      >
        Search
      </button>
    </form>
  );
}
