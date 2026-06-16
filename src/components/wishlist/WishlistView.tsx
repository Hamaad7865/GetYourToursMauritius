'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { useWishlist } from '@/lib/wishlist/useWishlist';
import { PlaceCard } from '@/components/gyg/PlaceCard';
import { IconHeart } from '@/components/ui/icons';

/** Branded empty-wishlist illustration: a coral heart held in a soft lagoon ring. */
function EmptyArt() {
  return (
    <div aria-hidden className="relative mx-auto grid h-40 w-40 place-items-center">
      <span className="absolute inset-0 rounded-full bg-teal/[0.07]" />
      <span className="absolute inset-5 rounded-full border-2 border-dashed border-teal/25" />
      <svg viewBox="0 0 120 40" className="absolute -bottom-1 left-1/2 h-6 w-28 -translate-x-1/2">
        <path
          d="M2 20 Q17 6 32 20 T62 20 T92 20 T118 20"
          fill="none"
          className="stroke-teal/35"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <IconHeart width={58} height={58} className="relative text-coral" style={{ fill: 'currentColor' }} />
    </div>
  );
}

export function WishlistView({ activities }: { activities: TourSummary[] }) {
  const { slugs } = useWishlist();
  // The wishlist lives in localStorage, so it's unknown during SSR. Hold a neutral placeholder
  // until mount to avoid flashing the empty state (and a hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="min-h-[55vh]" />;

  const wished = activities.filter((a) => slugs.includes(a.slug));

  if (wished.length === 0) {
    return (
      <div className="grid min-h-[55vh] place-items-center py-12 text-center">
        <div>
          <EmptyArt />
          <h1 className="mt-8 font-display text-[26px] font-semibold text-ink">Your wishlist is empty</h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] text-ink-muted">
            Save activities to your wishlist by tapping the heart icon on any tour.
          </p>
          <Link
            href="/activities"
            className="mt-6 inline-block rounded-full bg-teal px-6 py-3 text-sm font-bold text-white transition hover:bg-teal-dark"
          >
            Find things to do
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10">
      <h1 className="font-display text-[26px] font-semibold text-ink">Your wishlist</h1>
      <p className="mt-1 text-[14.5px] text-ink-muted">
        {wished.length} saved {wished.length === 1 ? 'activity' : 'activities'} — tap the heart to remove.
      </p>
      <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {wished.map((activity) => (
          <PlaceCard key={activity.id} activity={activity} titleAs="h2" />
        ))}
      </div>
    </div>
  );
}
