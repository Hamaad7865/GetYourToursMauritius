'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'gytm:wishlist';
/** Same-tab change signal (storage events only fire in *other* tabs). */
const EVENT = 'gytm:wishlist';

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function write(slugs: string[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(slugs));
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Wishlist of activity slugs, persisted in localStorage. Every consumer stays in sync: a toggle
 * writes + broadcasts a same-tab event, and the hook also listens for cross-tab `storage`
 * events. `slugs` is empty during SSR / first paint and fills in after mount.
 */
export function useWishlist() {
  const [slugs, setSlugs] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setSlugs(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const toggle = useCallback((slug: string) => {
    const current = read();
    write(current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug]);
  }, []);

  const has = useCallback((slug: string) => slugs.includes(slug), [slugs]);

  return { slugs, toggle, has };
}
