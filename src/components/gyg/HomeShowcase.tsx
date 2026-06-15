'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { useCategories } from '@/lib/categories/useCategories';
import { useHomeShowcase, type ShowcaseView } from './HomeShowcaseContext';
import { PlaceCard } from './PlaceCard';

/* Tonal brand gradients for image-less category cards — cycled so the grid reads as an
 * intentional palette, not a row of identical placeholders. */
const TILE_GRADIENTS = [
  'linear-gradient(155deg,#16b6bc 0%,#0E8C92 52%,#0a4f55 100%)',
  'linear-gradient(155deg,#1aa6cf 0%,#0e7c92 52%,#0a4a63 100%)',
  'linear-gradient(155deg,#13a0a6 0%,#0b6c80 52%,#0a3f55 100%)',
  'linear-gradient(155deg,#2bbfa6 0%,#0E8C92 52%,#0a5560 100%)',
];

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/**
 * GetYourGuide-style home showcase. Shows category tiles by default; switching to "Activities"
 * (via the centred tabs or the navbar "Activities" item) crossfades the same slot to the
 * activity cards — both centred. Entrance is a soft staggered fade-up that respects
 * prefers-reduced-motion.
 */
export function HomeShowcase({ activities }: { activities: TourSummary[] }) {
  const ctx = useHomeShowcase();
  const [localView, setLocalView] = useState<ShowcaseView>('categories');
  const view = ctx?.view ?? localView;
  const setView = ctx?.setView ?? setLocalView;

  const categories = useCategories();
  const tablistId = useId();

  function imageFor(categoryName: string): string | null {
    const match = activities.find(
      (a) => a.category === categoryName && (a.heroImage?.url || a.images[0]?.url),
    );
    return match?.heroImage?.url ?? match?.images[0]?.url ?? null;
  }

  const heading = view === 'categories' ? 'Things to do in Mauritius' : 'Popular activities';
  const sub =
    view === 'categories'
      ? 'Pick a category and start planning your island days.'
      : 'Hand-picked experiences, booked direct with Belle Mare Tours.';

  return (
    <section id="home-showcase" className="mx-auto max-w-shell scroll-mt-24 px-6 py-12 sm:py-14">
      <div className="text-center">
        <h2 className="text-[clamp(22px,2.6vw,30px)] font-extrabold tracking-tight text-ink">
          {heading}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[14.5px] text-ink-muted">{sub}</p>

        {/* Segmented tab control */}
        <div
          role="tablist"
          aria-label="Browse categories or activities"
          className="mx-auto mt-6 inline-flex items-center gap-1 rounded-full border border-ink/10 bg-white p-1 shadow-[0_2px_10px_-4px_rgba(10,46,54,0.25)]"
        >
          {(['categories', 'activities'] as const).map((tab) => {
            const active = view === tab;
            return (
              <button
                key={tab}
                role="tab"
                id={`${tablistId}-${tab}`}
                aria-selected={active}
                aria-controls={`${tablistId}-panel`}
                onClick={() => setView(tab)}
                className={`rounded-full px-5 py-2 text-[13.5px] font-bold capitalize transition-colors duration-200 ${
                  active ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      <div
        key={view}
        id={`${tablistId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tablistId}-${view}`}
        className="mt-9"
      >
        {view === 'categories' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((category, i) => {
              const img = category.imageUrl ?? imageFor(category.name);
              return (
                <Link
                  key={category.slug}
                  href={`/activities?category=${encodeURIComponent(category.name)}`}
                  style={{ animationDelay: `${i * 45}ms` }}
                  className="group animate-fade-up relative block aspect-[4/5] overflow-hidden rounded-2xl shadow-[0_10px_26px_-12px_rgba(10,46,54,0.5)] transition-shadow duration-300 hover:shadow-[0_22px_44px_-16px_rgba(10,46,54,0.6)]"
                >
                  {img ? (
                    <img
                      src={img}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-[650ms] ease-out group-hover:scale-[1.08]"
                    />
                  ) : (
                    <span
                      aria-hidden
                      style={{ backgroundImage: TILE_GRADIENTS[i % TILE_GRADIENTS.length] }}
                      className="block h-full w-full transition-transform duration-[650ms] ease-out group-hover:scale-[1.08]"
                    />
                  )}
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/15 to-transparent"
                  />
                  <span className="absolute inset-x-3.5 bottom-3 text-[15px] font-extrabold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
                    {category.name}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : activities.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-6">
            {activities.map((activity, i) => (
              <div key={activity.id} style={{ animationDelay: `${i * 55}ms` }} className="animate-fade-up">
                <PlaceCard activity={activity} rail />
              </div>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-ink-muted">
            Activities appear here once the catalogue is connected.
          </p>
        )}
      </div>
    </section>
  );
}
