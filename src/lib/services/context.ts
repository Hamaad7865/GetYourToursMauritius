import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import type { PaymentProvider } from '@/lib/payments/types';
import type { AiProvider } from '@/lib/ai/types';

/**
 * The single dependency bundle every service function receives as its first
 * argument. This is the seam that keeps the service layer framework-agnostic and
 * fully mockable: tests pass a fake `db` and stub providers; route handlers build
 * a real context. Nothing here imports Next.js.
 *
 * `db` may be a user-scoped client (RLS as the caller) or a service-role client,
 * chosen by the caller depending on the trust boundary.
 */
export interface ServiceContext {
  db: SupabaseClient<Database>;
  payments: PaymentProvider;
  ai: AiProvider;
  /** Injectable clock for deterministic tests. */
  now: () => Date;
}

export type DbClient = SupabaseClient<Database>;
