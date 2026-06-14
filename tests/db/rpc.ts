import type { PGlite } from '@electric-sql/pglite';
import type { DbRpc, RpcParams } from '@/lib/db/rpc';

const ALLOWED = new Set([
  'api_search_activities',
  'api_get_activity',
  'api_list_availability',
  'api_book',
  'api_create_payment',
  'api_get_booking',
  'api_capture_lead',
]);

/**
 * Test DbRpc adapter over PGlite — runs the exact same `api_*` SQL the production
 * Supabase client will, so the service layer is verified with zero mock divergence.
 */
export function pgliteRpc(pg: PGlite): DbRpc {
  return {
    async rpc<T>(fn: string, params: RpcParams): Promise<T> {
      if (!ALLOWED.has(fn)) {
        throw new Error(`unknown rpc ${fn}`);
      }
      const { rows } = await pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
        JSON.stringify(params),
      ]);
      return rows[0]!.data;
    },
  };
}
