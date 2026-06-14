'use client';

import { useEffect, useState } from 'react';
import { IconHeart } from '@/components/ui/icons';

const KEY = 'gytm:wishlist';

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Wishlist heart toggle (localStorage). Sits above a stretched card link, so it
 *  stops propagation to avoid triggering navigation. */
export function WishHeart({ slug, size = 18, className = '' }: { slug: string; size?: number; className?: string }) {
  const [wished, setWished] = useState(false);

  useEffect(() => {
    setWished(read().includes(slug));
  }, [slug]);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const current = read();
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [...current, slug];
    window.localStorage.setItem(KEY, JSON.stringify(next));
    setWished(next.includes(slug));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-pressed={wished}
      className={`grid place-items-center rounded-full bg-white/90 backdrop-blur transition hover:bg-white ${className}`}
    >
      <IconHeart
        width={size}
        height={size}
        className={wished ? 'text-coral' : 'text-ink'}
        style={wished ? { fill: 'currentColor' } : undefined}
      />
    </button>
  );
}
