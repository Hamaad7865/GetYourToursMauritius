import { categorySchema, tourTypeSchema } from '@/lib/validation/common';
import type { Category, TourType } from '@/lib/validation/common';

export const BROWSE_PAGE_SIZE = 24;

export interface BrowseParams {
  q?: string;
  category?: Category;
  type?: TourType;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Validates and normalises the browse-page query string. Unknown categories/types are
 * dropped (not errors), the search term is trimmed/capped, and page is clamped to ≥ 1.
 */
export function parseBrowseParams(searchParams: RawParams): BrowseParams {
  const category = categorySchema.safeParse(first(searchParams.category));
  const type = tourTypeSchema.safeParse(first(searchParams.type));
  const qRaw = first(searchParams.q)?.trim();
  const pageNum = Number.parseInt(first(searchParams.page) ?? '1', 10);

  return {
    q: qRaw ? qRaw.slice(0, 120) : undefined,
    category: category.success ? category.data : undefined,
    type: type.success ? type.data : undefined,
    // Clamp to the same upper bound as the API pagination schema (100_000) — an unbounded ?page=huge
    // drives a giant SQL OFFSET that errors, and the catalogue page then renders empty.
    page: Number.isFinite(pageNum) && pageNum >= 1 && pageNum <= 100_000 ? pageNum : 1,
  };
}

/** Serialises browse filters back into a `?…` query string (omits defaults/page 1). */
export function browseQueryString(params: {
  category?: string;
  q?: string;
  type?: string;
  page?: number;
}): string {
  const sp = new URLSearchParams();
  if (params.category) sp.set('category', params.category);
  if (params.q) sp.set('q', params.q);
  if (params.type) sp.set('type', params.type);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  const query = sp.toString();
  return query ? `?${query}` : '';
}
