import Link from 'next/link';
import { CATEGORIES } from '@/lib/seo/site';

export function CategoryChips({ active }: { active?: string }) {
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
      {CATEGORIES.map((category) => {
        const isActive = active === category;
        return (
          <Link
            key={category}
            href={`/activities?category=${encodeURIComponent(category)}`}
            className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${
              isActive
                ? 'border-transparent bg-ink text-cream'
                : 'border-ink/12 bg-white text-ink hover:border-teal'
            }`}
          >
            {category}
          </Link>
        );
      })}
    </div>
  );
}
