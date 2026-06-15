'use client';

import { useEffect, useState } from 'react';
import type { TourSummary } from '@/lib/validation/tours';
import { Rail } from './Rail';
import { PlaceCard } from './PlaceCard';

const KEY = 'gytm:recent';

/**
 * "Continue planning your trip" rail. Orders the supplied pool by recently-viewed
 * (from localStorage); with no history it falls back to a "Popular right now" rail so
 * the section is never empty.
 */
export function ContinuePlanning({ pool }: { pool: TourSummary[] }) {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      setRecent(JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as string[]);
    } catch {
      setRecent([]);
    }
  }, []);

  if (pool.length === 0) return null;

  const bySlug = new Map(pool.map((a) => [a.slug, a]));
  const recentItems = recent.map((s) => bySlug.get(s)).filter((a): a is TourSummary => Boolean(a));
  const hasHistory = recentItems.length > 0;
  const rest = pool.filter((a) => !recent.includes(a.slug));
  const items = (hasHistory ? [...recentItems, ...rest] : pool).slice(0, 8);

  return (
    <section className="mx-auto max-w-shell px-6 py-8">
      <h2 className="mb-4 text-[22px] font-extrabold tracking-tight text-ink">
        {hasHistory ? 'Continue planning your trip' : 'Popular right now'}
      </h2>
      <Rail ariaLabel={hasHistory ? 'Recently viewed' : 'Popular activities'}>
        {items.map((activity) => (
          <PlaceCard key={activity.id} activity={activity} rail />
        ))}
      </Rail>
    </section>
  );
}
