'use client';

import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { useCategories } from '@/lib/categories/useCategories';
import { Rail } from './Rail';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/**
 * GetYourGuide-style "Things to do" showcase: a rail of large photo tiles, one per category,
 * with the category name beneath. The tile photo is the category's own image when set,
 * otherwise a representative photo borrowed from an activity in that category, otherwise a
 * branded gradient. Each tile links to that category's listing.
 */
export function CategoryShowcase({ pool }: { pool: TourSummary[] }) {
  const categories = useCategories();

  function imageFor(categoryName: string): string | null {
    const match = pool.find(
      (a) => a.category === categoryName && (a.images[0]?.url || a.heroImage?.url),
    );
    return match?.images[0]?.url ?? match?.heroImage?.url ?? null;
  }

  return (
    <section className="mx-auto max-w-shell px-6 py-8">
      <h2 className="mb-5 text-[22px] font-extrabold tracking-tight text-ink">
        Things to do in Mauritius
      </h2>
      <Rail ariaLabel="Browse by category">
        {categories.map((category) => {
          const img = category.imageUrl ?? imageFor(category.name);
          return (
            <Link
              key={category.slug}
              href={`/activities?category=${encodeURIComponent(category.name)}`}
              className="group w-[220px] shrink-0"
            >
              <div className="relative aspect-square overflow-hidden rounded-2xl">
                {img ? (
                  <img
                    src={img}
                    alt={category.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] transition-transform duration-500 ease-out group-hover:scale-105">
                    <span className="font-display text-4xl font-semibold text-white/90">
                      {category.name.slice(0, 1)}
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-2.5 text-[17px] font-bold text-ink group-hover:text-teal">
                {category.name}
              </p>
            </Link>
          );
        })}
      </Rail>
    </section>
  );
}
