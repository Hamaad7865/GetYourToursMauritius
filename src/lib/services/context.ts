import type { SupabaseClient } from '@supabase/supabase-js';
import type { DbRpc } from '@/lib/db/rpc';
import type { Database } from '@/lib/supabase/types';
import type { PaymentProvider } from '@/lib/payments/types';
import type { AiProvider } from '@/lib/ai/types';

/**
 * The single dependency bundle every service function receives as its first
 * argument. This is the seam that keeps the service layer framework-agnostic and
 * fully mockable: tests pass a PGlite-backed DbRpc and stub providers; route
 * handlers build a Supabase-backed one. Nothing here imports Next.js.
 *
 * `db` is the narrow rpc port (services only call Postgres `api_*` functions). It
 * may wrap a user-scoped client (RLS as the caller) or a service-role client.
 */
export interface ServiceContext {
  db: DbRpc;
  payments: PaymentProvider;
  ai: AiProvider;
  /**
   * Service-role Supabase client for the few trusted server-side flows that must act across users by
   * bypassing RLS — currently the payment reconciliation sweep, which appends verified settlement events
   * to any booking's ledger. Present ONLY on the service-role context (the maintenance cron); undefined
   * on user-scoped/public contexts. Importing the admin client into the service layer is forbidden, so it
   * arrives via this seam. Tests pass a PGlite-backed Supabase shim.
   */
  admin?: SupabaseClient<Database>;
  /** Injectable clock for deterministic tests. */
  now: () => Date;
}
