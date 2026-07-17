'use client';

import { useState } from 'react';
import { IconHeart } from '@/components/ui/icons';
import { useWishlist } from '@/lib/wishlist/useWishlist';

/** Wishlist heart toggle (localStorage, shared via useWishlist so every heart + the wishlist
 *  page stay in sync). Sits above a stretched card link, so it stops propagation to avoid
 *  triggering navigation. Saving (adding — not removing) plays a springy coral pop + a soft
 *  ripple; remounting on each add (popKey) replays the pop, and the ripple removes itself once
 *  its animation ends so no stale node lingers. Matches the header add-to-cart pop pattern. */
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
  const [popKey, setPopKey] = useState(0);
  const [rippling, setRippling] = useState(false);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const adding = !wished;
    toggle(slug);
    if (adding) {
      setPopKey((k) => k + 1);
      setRippling(true);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-pressed={wished}
      // No `position` in the base: the ripple's `absolute inset-0` needs a positioned button, but
      // callers already supply one (the card overlays pass `absolute`; the detail page passes
      // `relative`). Hard-coding `relative` here would override a caller's `absolute` (Tailwind emits
      // `.relative` after `.absolute`, so source order wins) and drop the heart out of its overlay.
      className={`grid place-items-center rounded-full bg-white/90 backdrop-blur transition hover:bg-white ${className}`}
    >
      {/* Coral ripple emanates from behind the heart on add, then unmounts when it finishes; hidden
          under reduced motion (its resting state would be a solid disk). */}
      {rippling && (
        <span
          key={`ring-${popKey}`}
          aria-hidden
          onAnimationEnd={() => setRippling(false)}
          className="gyt-heart-ring pointer-events-none absolute inset-0 rounded-full"
        />
      )}
      <span
        key={`pop-${popKey}`}
        className={`relative inline-flex ${popKey > 0 && wished ? 'gyt-heart-pop' : ''}`}
      >
        <IconHeart
          width={size}
          height={size}
          className={wished ? 'text-coral' : 'text-ink'}
          style={wished ? { fill: 'currentColor' } : undefined}
        />
      </span>
    </button>
  );
}
