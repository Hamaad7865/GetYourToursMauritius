'use client';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

import { useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import type { GalleryTag } from '@/lib/catalogue/photography';

/** One tile of the v3 "Recent shoots" masonry — already translated on the server. */
export interface V3GalleryItem {
  key: string;
  src: string;
  alt: string;
  /** Filter value; null items only show under "All". */
  tag: GalleryTag | null;
  /** Dense-grid spans, derived from the item's aspect. */
  tall: boolean;
  wide: boolean;
}

/**
 * The v3 "Recent shoots" section: the design's dense masonry (grid-auto-flow: dense, tall/wide
 * spans by aspect) with category filter chips. Items link to the full gallery, filtered.
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
  const visible = items.filter((g) => filter === 'all' || g.tag === filter);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h2 className="text-[clamp(32px,4vw,50px)] font-bold leading-[1.05] tracking-[-0.03em] text-ink">
          {t('Recent')} <em className="not-italic text-teal">{t('shoots')}</em>
        </h2>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      <div className="grid auto-flow-dense grid-cols-[repeat(auto-fill,minmax(220px,1fr))] grid-auto-rows-[190px] gap-3">
        {visible.map((g) => (
          <a
            key={g.key}
            href={`${seeAllHref}${g.tag ? `?c=${g.tag}` : ''}`}
            aria-label={g.alt}
            className={`group relative overflow-hidden rounded-[18px] bg-teal-tint ${g.tall ? 'row-span-2' : ''} ${g.wide ? 'col-span-2' : ''}`}
          >
            <img
              src={g.src}
              alt={g.alt}
              loading="lazy"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          </a>
        ))}
      </div>

      <div className="flex justify-center">
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
