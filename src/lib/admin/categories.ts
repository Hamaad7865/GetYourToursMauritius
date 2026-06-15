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
  const { error } = await getBrowserSupabase()
    .from('categories')
    .update({
      name: input.name.trim(),
      slug: slugify(input.name),
      image_url: input.imageUrl?.trim() || null,
      status: input.status,
    })
    .eq('id', id);
  if (error) throw error;
}

/** Move a category up/down by swapping its position with its neighbour. */
export async function moveCategory(rows: CategoryRow[], id: string, dir: -1 | 1): Promise<void> {
  const idx = rows.findIndex((r) => r.id === id);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= rows.length) return;
  const a = rows[idx]!;
  const b = rows[swapIdx]!;
  const sb = getBrowserSupabase();
  const { error: e1 } = await sb.from('categories').update({ position: b.position }).eq('id', a.id);
  if (e1) throw e1;
  const { error: e2 } = await sb.from('categories').update({ position: a.position }).eq('id', b.id);
  if (e2) throw e2;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('categories').delete().eq('id', id);
  if (error) throw error;
}
