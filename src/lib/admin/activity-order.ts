import { getBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Persist a new card order for a category: `orderedIds` is that category's activity ids in the desired
 * order; the server sets each activity's `sort` to its array index (atomic, staff-only). Because an
 * activity has exactly one category, this reorders only the given category's cards.
 */
export async function reorderActivities(orderedIds: string[]): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_reorder_activities', { p: { ids: orderedIds } });
  if (error) throw error;
}
