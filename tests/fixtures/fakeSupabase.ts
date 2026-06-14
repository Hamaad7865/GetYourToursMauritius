import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

/**
 * Minimal fake satisfying the SupabaseClient type for ServiceContext. Phase 0
 * stub services do not touch the database, so an empty object is enough. From
 * Phase 2, tests provide a typed fake implementing the `.from().select()...`
 * chain each service actually uses.
 */
export function createFakeDb(): SupabaseClient<Database> {
  return {} as unknown as SupabaseClient<Database>;
}
