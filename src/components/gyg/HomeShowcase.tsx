'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { useCategories } from '@/lib/categories/useCategories';
import { useHomeShowcase, type ShowcaseView } from './HomeShowcaseContext';
import { PlaceCard } from './PlaceCard';
import { IconPin } from '@/components/ui/icons';

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
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-7">
            {categories.map((category, i) => {
              const img = category.imageUrl ?? imageFor(category.name);
              return (
                <Link
                  key={category.slug}
                  href={`/activities?category=${encodeURIComponent(category.name)}`}
                  style={{ animationDelay: `${i * 45}ms` }}
                  className="group animate-fade-up w-[150px] sm:w-[178px]"
                >
                  <div className="relative aspect-square overflow-hidden rounded-2xl shadow-[0_2px_10px_-4px_rgba(10,46,54,0.3)] transition-shadow duration-300 group-hover:shadow-[0_16px_34px_-14px_rgba(10,46,54,0.45)]">
                    {img ? (
                      <img
                        src={img}
                        alt={category.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] transition-transform duration-500 ease-out group-hover:scale-110">
                        <IconPin width={30} height={30} className="text-white/45" />
                      </div>
                    )}
                  </div>
                  <p className="mt-2.5 text-center text-[15px] font-bold text-ink transition-colors group-hover:text-teal">
                    {category.name}
                  </p>
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
