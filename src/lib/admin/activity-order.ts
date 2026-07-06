import { getBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Persist a new card order for a category: `orderedIds` is that `category`'s activity ids in the desired
 * order; the server sets each activity's `sort` to its array index (atomic, staff-only). The `category`
 * is passed so the RPC constrains the update to it — a stray id from another category can't be renumbered.
 */
export async function reorderActivities(orderedIds: string[], category: string): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_reorder_activities', {
    p: { ids: orderedIds, category },
  });
  if (error) throw error;
}
