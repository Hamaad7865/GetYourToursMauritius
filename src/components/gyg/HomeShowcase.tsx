'use client';

import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { useCategories } from '@/lib/categories/useCategories';
import { PlaceCard } from './PlaceCard';

/**
 * Home catalogue: one section per category, each showing up to four activities with a
 * "See all" link to the full filtered listing. Categories with no activities are skipped, so
 * the page never shows an empty rail. Ordered by the managed category list (DB order, with the
 * static fallback before the migration is applied); any category present in the data but not
 * in that list is appended.
 */
export function HomeShowcase({ activities }: { activities: TourSummary[] }) {
  const categories = useCategories();

  const byCategory = new Map<string, TourSummary[]>();
  for (const a of activities) {
    const list = byCategory.get(a.category) ?? [];
    list.push(a);
    byCategory.set(a.category, list);
  }

  const ordered: { name: string; items: TourSummary[] }[] = [];
  const seen = new Set<string>();
  for (const c of categories) {
    const items = byCategory.get(c.name);
    if (items && items.length) {
      ordered.push({ name: c.name, items });
      seen.add(c.name);
    }
  }
  for (const [name, items] of byCategory) {
    if (!seen.has(name) && items.length) ordered.push({ name, items });
  }

  if (ordered.length === 0) {
    return (
      <section id="home-showcase" className="mx-auto max-w-shell scroll-mt-24 px-6 py-16">
        <p className="text-center text-[15px] text-ink-muted">
          Activities appear here once the catalogue is connected.
        </p>
      </section>
    );
  }

  return (
    <div id="home-showcase" className="scroll-mt-24">
      <div className="mx-auto max-w-shell px-6 pt-12 pb-1">
        <p className="text-[12.5px] font-bold uppercase tracking-[0.18em] text-teal">
          Belle Mare Tours
        </p>
        <h2 className="mt-1.5 font-display text-[clamp(24px,3vw,34px)] font-semibold tracking-tight text-ink">
          Things to do across Mauritius
        </h2>
        <p className="mt-1.5 max-w-xl text-[14.5px] text-ink-muted">
          Browse by experience — every tour booked direct with the local operator.
        </p>
      </div>

      {ordered.map((cat) => (
        <section key={cat.name} className="mx-auto max-w-shell px-6 py-7">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-display text-[clamp(19px,2.1vw,25px)] font-semibold tracking-tight text-ink">
                {cat.name}
              </h3>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {cat.items.length} {cat.items.length === 1 ? 'experience' : 'experiences'}
              </p>
            </div>
            <Link
              href={`/activities?category=${encodeURIComponent(cat.name)}`}
              className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/15 px-4 py-2 text-[13.5px] font-bold text-ink transition-colors hover:border-teal hover:text-teal"
            >
              See all
              <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {cat.items.slice(0, 4).map((activity) => (
              <PlaceCard key={activity.id} activity={activity} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
