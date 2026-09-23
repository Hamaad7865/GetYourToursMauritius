import { cache } from 'react';
import { createUserClient } from '@/lib/supabase/client';
import { toPhotographyPhoto, type PhotographyPhoto } from '@/lib/catalogue/photography';

/**
 * The /photography page photos the owner manages in /admin/photography (photography_photos,
 * 20261009000000). Server-only; reads through the anon client (public-read policy), the same way the
 * WhatsApp number does. ANY failure — no Supabase in dev, a blip, the migration not yet applied —
 * resolves to [] so every slot shows its built-in stand-in instead of breaking the page.
 */
export async function readPhotographyPhotos(): Promise<PhotographyPhoto[]> {
  try {
    const { data, error } = await createUserClient()
      .from('photography_photos')
      .select('id, slot, url, alt, tags, position')
      .order('position')
      .order('created_at');
    if (error || !data) return [];
    return data.map(toPhotographyPhoto).filter((p): p is PhotographyPhoto => p !== null);
  } catch {
    return [];
  }
}

/** Request-cached, so the two photography pages' several slots share one read. */
export const getPhotographyPhotos = cache(readPhotographyPhotos);
