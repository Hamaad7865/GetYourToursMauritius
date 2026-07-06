import { getBrowserSupabase } from '@/lib/supabase/browser';
import { slugify } from './activity-write';

/* Admin category management. Staff RLS (`categories_staff_all`) grants full read+write, so the
 * authenticated admin does these directly through the browser client. */

export type CategoryStatus = 'active' | 'hidden';

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  position: number;
  imageUrl: string | null;
  status: CategoryStatus;
}

export interface CategoryInput {
  name: string;
  imageUrl: string | null;
  status: CategoryStatus;
}

export async function loadCategories(): Promise<CategoryRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from('categories')
    .select('id, name, slug, position, image_url, status')
    .order('position');
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    position: c.position,
    imageUrl: c.image_url,
    status: c.status as CategoryStatus,
  }));
}

export async function createCategory(input: CategoryInput): Promise<void> {
  const sb = getBrowserSupabase();
  const { data: top } = await sb
    .from('categories')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (top?.position ?? -1) + 1;
  const { error } = await sb.from('categories').insert({
    name: input.name.trim(),
    slug: slugify(input.name),
    position,
    image_url: input.imageUrl?.trim() || null,
    status: input.status,
  });
  if (error) throw error;
}

export async function updateCategory(id: string, input: CategoryInput): Promise<void> {
  const sb = getBrowserSupabase();
  const newName = input.name.trim();
  // Activities store their category as the free-text NAME (there is no FK from activities.category to
  // categories), so a rename MUST re-point them or every tour in the old-named category silently drops
  // out of its menu, filter and home rail. Re-point FIRST, then rename the category row — that ordering
  // self-heals on retry if the second write fails (a rename-first partial failure would not, because a
  // retry would read the already-renamed name and skip the re-point).
  const { data: existing } = await sb.from('categories').select('name').eq('id', id).maybeSingle();
  const oldName = existing?.name ?? null;
  if (oldName && oldName !== newName) {
    const { error: repointErr } = await sb.from('activities').update({ category: newName }).eq('category', oldName);
    if (repointErr) throw repointErr;
  }
  const { error } = await sb
    .from('categories')
    .update({
      name: newName,
      slug: slugify(input.name),
      image_url: input.imageUrl?.trim() || null,
      status: input.status,
    })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Move a category up/down by swapping its position with its neighbour. The swap runs as a single
 * atomic RPC so an interrupted move can't leave two categories sharing one position (or one with a
 * gap) — both UPDATEs commit together or not at all.
 */
export async function moveCategory(rows: CategoryRow[], id: string, dir: -1 | 1): Promise<void> {
  const idx = rows.findIndex((r) => r.id === id);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= rows.length) return;
  const a = rows[idx]!;
  const b = rows[swapIdx]!;
  const { error } = await getBrowserSupabase().rpc('api_swap_category_positions', {
    p_id_a: a.id,
    p_id_b: b.id,
  });
  if (error) throw error;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('categories').delete().eq('id', id);
  if (error) throw error;
}
