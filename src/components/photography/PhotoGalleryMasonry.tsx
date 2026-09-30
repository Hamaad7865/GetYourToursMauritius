'use client';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { IconChevron } from '@/components/ui/icons';
import type { GalleryTag } from '@/lib/catalogue/photography';

/** One slide of the v3 "Recent shoots" carousel — already translated on the server. */
export interface V3GalleryItem {
  key: string;
  src: string;
  alt: string;
  /** Filter value; null items only show under "All". */
  tag: GalleryTag | null;
  /** Kept for compatibility with the old masonry model; unused by the slider. */
  tall: boolean;
  wide: boolean;
}

/**
 * The v3 "Recent shoots" section as a sliding carousel: big scroll-snapped slides (filterable
 * by category), prev/next arrows and progress dots. Slides link to the full gallery, filtered.
 */
export function PhotoGalleryMasonry({
  items,
  filters,
  seeAllHref,
  seeAllLabel,
}: {
  items: V3GalleryItem[];
  filters: { id: GalleryTag | 'all'; label: string }[];
  seeAllHref: string;
  seeAllLabel: string;
}) {
  const [filter, setFilter] = useState<GalleryTag | 'all'>('all');
  const t = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const visible = items.filter((g) => filter === 'all' || g.tag === filter);

  // Back to the first slide whenever the filter changes the set.
  useEffect(() => {
    setPage(0);
    trackRef.current?.scrollTo({ left: 0 });
  }, [filter]);

  function slideStep(): number {
    const track = trackRef.current;
    const slide = track?.querySelector<HTMLElement>('[data-slide]');
    return slide ? slide.offsetWidth + 12 : (track?.clientWidth ?? 320);
  }

  function scrollBy(dir: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * slideStep(), behavior: 'smooth' });
  }

  // Autoplay: advance every 5s, loop to the start at the end. Pauses on hover/focus and
  // entirely off for prefers-reduced-motion.
  useEffect(() => {
    if (paused || visible.length <= 1) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      const track = trackRef.current;
      if (!track) return;
      const last = (visible.length - 1) * slideStep();
      if (track.scrollLeft >= last - 8) track.scrollTo({ left: 0, behavior: 'smooth' });
      else track.scrollBy({ left: slideStep(), behavior: 'smooth' });
    }, 5000);
    return () => clearInterval(id);
  }, [paused, visible.length]);

  function onScroll() {
    const track = trackRef.current;
    if (!track) return;
    setPage(Math.round(track.scrollLeft / slideStep()));
  }

  const atStart = page <= 0;
  const atEnd = page >= visible.length - 1;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h2 className="text-[clamp(32px,4vw,50px)] font-bold leading-[1.05] tracking-[-0.03em] text-ink">
          {t('Recent')} <em className="not-italic text-teal">{t('shoots')}</em>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f.id)}
                className={`rounded-full border-[1.5px] px-3.5 py-2 text-sm font-semibold transition ${
                  on
                    ? 'border-ink bg-ink text-white'
                    : 'border-ink/10 bg-white text-ink hover:border-ink/30'
                }`}
              >
                {f.label}
              </button>
            );
          })}
          <div className="ml-2 flex gap-2">
            <button
              type="button"
              aria-label={t('Previous photos')}
              disabled={atStart}
              onClick={() => scrollBy(-1)}
              className="grid h-10 w-10 place-items-center rounded-full border-[1.5px] border-ink/10 bg-white text-ink transition hover:border-ink/40 disabled:opacity-35"
            >
              <IconChevron width={16} height={16} className="rotate-90" />
            </button>
            <button
              type="button"
              aria-label={t('Next photos')}
              disabled={atEnd}
              onClick={() => scrollBy(1)}
              className="grid h-10 w-10 place-items-center rounded-full border-[1.5px] border-ink/10 bg-white text-ink transition hover:border-ink/40 disabled:opacity-35"
            >
              <IconChevron width={16} height={16} className="-rotate-90" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={trackRef}
        onScroll={onScroll}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className="-mx-6 flex snap-x snap-mandatory scroll-px-6 gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] sm:-mx-8 sm:scroll-px-8 sm:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {visible.map((g) => (
          <a
            key={g.key}
            data-slide
            href={`${seeAllHref}${g.tag ? `?c=${g.tag}` : ''}`}
            aria-label={g.alt}
            className="group relative aspect-[3/3.8] w-[78%] flex-none snap-start overflow-hidden rounded-[18px] bg-teal-tint sm:w-[46%] lg:w-[31.5%]"
          >
            <img
              src={g.src}
              alt={g.alt}
              loading="lazy"
              draggable={false}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/55 via-ink/10 to-transparent p-4 pt-10 text-left text-sm font-bold text-white opacity-0 transition duration-300 group-hover:opacity-100">
              {g.alt}
            </span>
          </a>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1.5" aria-hidden>
          {visible.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === page ? 'w-6 bg-teal' : 'w-1.5 bg-ink/15'
              }`}
            />
          ))}
        </div>
        <a
          href={seeAllHref}
          className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink/10 px-6 py-3 text-sm font-bold text-ink transition hover:border-teal hover:bg-teal-tint hover:text-teal-dark"
        >
          {seeAllLabel} →
        </a>
      </div>
    </>
  );
}
