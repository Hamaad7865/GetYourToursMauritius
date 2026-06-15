'use client';

import Link from 'next/link';
import { useCategories } from '@/lib/categories/useCategories';

export function CategoryChips({ active }: { active?: string }) {
  const categories = useCategories();
  return (
    <div className="no-bar flex gap-2.5 overflow-x-auto py-5">
      <Link
        href="/activities"
        className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${
          active
            ? 'border-ink/12 bg-white text-ink hover:border-teal'
            : 'border-transparent bg-ink text-cream'
        }`}
      >
        All
      </Link>
      {categories.map((category) => {
        const isActive = active === category.name;
        return (
          <Link
            key={category.slug}
            href={`/activities?category=${encodeURIComponent(category.name)}`}
            className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${
              isActive
                ? 'border-transparent bg-ink text-cream'
                : 'border-ink/12 bg-white text-ink hover:border-teal'
            }`}
          >
            {category.name}
          </Link>
        );
      })}
    </div>
  );
}
