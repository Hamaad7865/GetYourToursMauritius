'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { FALLBACK_CATEGORIES, type CategoryItem } from './categories';

/* Client-side category list. Fetched once per session from the `categories` table (public
 * read) and cached; falls back to the static list on any error/empty result so the navbar and
 * search work before the migration is applied. */

let cache: CategoryItem[] | null = null;
let inflight: Promise<CategoryItem[]> | null = null;

function fetchCategories(): Promise<CategoryItem[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await getBrowserSupabase()
        .from('categories')
        .select('name, slug, image_url')
        .eq('status', 'active')
        .order('position');
      if (error || !data || data.length === 0) return FALLBACK_CATEGORIES;
      cache = data.map((c) => ({ name: c.name, slug: c.slug, imageUrl: c.image_url }));
      return cache;
    } catch {
      return FALLBACK_CATEGORIES;
    }
  })();
  return inflight;
}

export function useCategories(): CategoryItem[] {
  const [categories, setCategories] = useState<CategoryItem[]>(cache ?? FALLBACK_CATEGORIES);
  useEffect(() => {
    let active = true;
    void fetchCategories().then((c) => {
      if (active) setCategories(c);
    });
    return () => {
      active = false;
    };
  }, []);
  return categories;
}
