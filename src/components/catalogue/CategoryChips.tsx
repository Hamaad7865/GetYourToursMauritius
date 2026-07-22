'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { useCategories } from '@/lib/categories/useCategories';
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';

/**
 * The category filter strip. A single horizontally-scrolling row (swipe on touch)
 * with GetYourGuide-style circular ‹ › arrows + edge fades on desktop that appear
 * only when there's more to scroll — so the last chip fades out gracefully instead
 * of hard-clipping mid-word. Mirrors the interaction in `gyg/Rail.tsx`.
 */
export function CategoryChips({ active }: { active?: string }) {
  const t = useT();
  const categories = useCategories();
  const trackRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    update();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update]);

  // Landing on a filtered view whose chip sits off-screen (e.g. the last category):
  // bring it into view so the active filter is always visible without a hunt. Set
  // scrollLeft directly rather than scrollIntoView() so the page can't scroll vertically.
  // Re-runs when `categories` resolves from its async fetch.
  useEffect(() => {
    const el = trackRef.current;
    const chip = activeRef.current;
    if (!el || !chip) return;
    el.scrollLeft = Math.max(0, chip.offsetLeft - 24);
    update();
  }, [categories, update]);

  function scrollBy(dir: 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.7), behavior: 'smooth' });
  }

  return (
    <div className="relative py-5">
      <div ref={trackRef} className="no-bar flex gap-2.5 overflow-x-auto">
        <Link
          href="/activities"
          ref={active ? undefined : activeRef}
          className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${
            active
              ? 'border-ink/12 bg-white text-ink hover:border-teal'
              : 'border-transparent bg-ink text-cream'
          }`}
        >
          {t('All')}
        </Link>
        {categories.map((category) => {
          const isActive = active === category.name;
          return (
            <Link
              key={category.slug}
              ref={isActive ? activeRef : undefined}
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

      {!atStart && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-cream to-transparent" />
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll categories left"
            className="absolute left-0 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-white text-ink shadow-[0_6px_18px_-6px_rgba(10,46,54,0.5)] hover:border-teal hover:text-teal md:grid"
          >
            <IconChevronLeft width={18} height={18} />
          </button>
        </>
      )}
      {!atEnd && (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-cream to-transparent" />
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Scroll categories right"
            className="absolute right-0 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-white text-ink shadow-[0_6px_18px_-6px_rgba(10,46,54,0.5)] hover:border-teal hover:text-teal md:grid"
          >
            <IconChevronRight width={18} height={18} />
          </button>
        </>
      )}
    </div>
  );
}
