'use client';

import { useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';

export type PortfolioCategory = 'weddings' | 'films' | 'couples' | 'family';

export interface PortfolioShot {
  /** Stable React key (the photo id); defaults to `src`. */
  key?: string;
  src: string;
  alt: string;
  categories: PortfolioCategory[];
  /** Tailwind aspect class — the mixed ratios are what make the masonry read as a contact sheet. */
  aspect: string;
  badge?: string;
}

/** Filterable masonry of shots. Pure CSS columns, so there is no layout JS to fail. */
export function PortfolioGrid({ shots }: { shots: PortfolioShot[] }) {
  const t = useT();
  const [filter, setFilter] = useState<PortfolioCategory | 'all'>('all');
  const tabs: { id: PortfolioCategory | 'all'; label: string }[] = [
    { id: 'all', label: t('All') },
    { id: 'weddings', label: t('Weddings') },
    { id: 'films', label: t('Films') },
    { id: 'couples', label: t('Couples') },
    { id: 'family', label: t('Family') },
  ];
  const visible = filter === 'all' ? shots : shots.filter((s) => s.categories.includes(filter));

  return (
    <>
      <div
        role="tablist"
        aria-label={t('Filter shots')}
        className="mx-auto mt-10 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-white/[0.06] p-1.5"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filter === tab.id}
            onClick={() => setFilter(tab.id)}
            className={`whitespace-nowrap rounded-full px-5 py-2 text-sm font-bold transition ${
              filter === tab.id ? 'bg-white text-ink' : 'text-white/70 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-12 columns-1 gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5">
        {visible.map((s) => (
          <figure
            key={s.key ?? s.src}
            className="relative break-inside-avoid overflow-hidden rounded-2xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.src}
              alt={s.alt}
              loading="lazy"
              className={`${s.aspect} w-full object-cover`}
            />
            {s.badge && (
              <span className="absolute left-4 top-4 rounded-full bg-ink/60 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">
                {s.badge}
              </span>
            )}
          </figure>
        ))}
      </div>
    </>
  );
}
