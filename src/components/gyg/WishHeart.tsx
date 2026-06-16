'use client';

import { IconHeart } from '@/components/ui/icons';
import { useWishlist } from '@/lib/wishlist/useWishlist';

/** Wishlist heart toggle (localStorage, shared via useWishlist so every heart + the wishlist
 *  page stay in sync). Sits above a stretched card link, so it stops propagation to avoid
 *  triggering navigation. */
export function WishHeart({
  slug,
  size = 18,
  className = '',
}: {
  slug: string;
  size?: number;
  className?: string;
}) {
  const { has, toggle } = useWishlist();
  const wished = has(slug);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    toggle(slug);
  }

  return (
    <button
      type="button"
      onClick={onClick}
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
