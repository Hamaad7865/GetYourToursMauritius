/**
 * DEV / PREVIEW ONLY DbRpc adapter. Answers the read-only catalogue functions from
 * the in-memory seed fixture so the public pages render without a Supabase project.
 * Writes and availability are intentionally not supported — those need a real DB.
 */
import type { DbRpc, RpcParams } from '@/lib/db/rpc';
import { SEED_DETAILS, SEED_SUMMARIES } from './seed-data';
import type { TourSummary } from '@/lib/validation/tours';

function search(params: RpcParams) {
  const category = params.category ? String(params.category) : null;
  const type = params.type ? String(params.type) : null;
  const q = params.q ? String(params.q).toLowerCase() : null;
  const page = Number(params.page ?? 1);
  const pageSize = Number(params.pageSize ?? 20);

  const filtered = SEED_SUMMARIES.filter((item: TourSummary) => {
    if (category && item.category !== category) return false;
    if (type && item.type !== type) return false;
    if (q && !`${item.title} ${item.summary ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}

export function seedRpc(): DbRpc {
  return {
    async rpc<T>(fn: string, params: RpcParams): Promise<T> {
      switch (fn) {
        case 'api_search_activities':
          return search(params) as T;
        case 'api_get_activity':
          return (SEED_DETAILS[String(params.slug)] ?? null) as T;
        case 'api_list_availability':
          return [] as T;
        default:
          throw new Error(
            `Preview mode has no Supabase project: "${fn}" is unavailable. ` +
              'Configure NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY to use live data.',
          );
      }
    },
  };
}
