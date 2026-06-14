import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import type { DbRpc, RpcParams } from '@/lib/db/rpc';

/**
 * Production DbRpc adapter over a Supabase client. Every `api_*` function takes a
 * single jsonb param named `p`. On a Postgres RAISE the PostgREST error carries the
 * exception message, which the service layer maps to a typed ServiceError.
 */
export function supabaseRpc(client: SupabaseClient<Database>): DbRpc {
  return {
    async rpc<T>(fn: string, params: RpcParams): Promise<T> {
      // Bind to `client` — supabase-js's rpc() reads `this.rest`, so calling a
      // detached reference throws "Cannot read properties of undefined (reading 'rest')".
      const call = client.rpc.bind(client) as unknown as (
        name: string,
        args: { p: RpcParams },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { data, error } = await call(fn, { p: params });
      if (error) {
        throw new Error(error.message);
      }
      return data as T;
    },
  };
}
