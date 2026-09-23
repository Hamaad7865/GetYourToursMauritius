'use client';

import { useEffect, useState } from 'react';
import { PHOTOGRAPHY_CATEGORY } from '@/lib/catalogue/photography';

/** The slice of a package the navbar dropdown needs. */
export interface PhotographyMenuItem {
  slug: string;
  title: string;
  fromPriceEur: number | null;
}

/* Fetched once per page load through the public catalogue API (edge-cached for anonymous visitors)
 * and shared by every consumer. Any failure resolves to [] — the menu then shows its static links,
 * never an error. */
let cache: PhotographyMenuItem[] | null = null;
let inflight: Promise<PhotographyMenuItem[]> | null = null;

function fetchPackages(): Promise<PhotographyMenuItem[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(
        `/api/v1/activities?category=${encodeURIComponent(PHOTOGRAPHY_CATEGORY)}&pageSize=24`,
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { data?: unknown };
      const rows = Array.isArray(body.data) ? body.data : [];
      cache = rows
        .map((r) => r as { slug?: unknown; title?: unknown; fromPriceEur?: unknown })
        .filter((r) => typeof r.slug === 'string' && typeof r.title === 'string')
        .map((r) => ({
          slug: r.slug as string,
          title: r.title as string,
          fromPriceEur: typeof r.fromPriceEur === 'number' ? r.fromPriceEur : null,
        }));
      return cache;
    } catch {
      return [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function usePhotographyPackages(): PhotographyMenuItem[] {
  const [items, setItems] = useState<PhotographyMenuItem[]>(cache ?? []);
  useEffect(() => {
    let active = true;
    void fetchPackages().then((p) => {
      if (active) setItems(p);
    });
    return () => {
      active = false;
    };
  }, []);
  return items;
}
