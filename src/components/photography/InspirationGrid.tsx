'use client';

import { responsiveImage } from '@/lib/images/resize';
import { useMemo, useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { Lightbox, preloadLightbox, type LightboxItem } from '@/components/ui/Lightbox';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

export interface InspirationItem {
  key: string;
  src: string;
  thumb: string | null;
  alt: string;
  aspect: string;
}

/**
 * The package page's "Get inspired" strip: uniform tiles that open the shared full-screen viewer (swipe,
 * zoom, thumbnails, keyboard). The viewer brings its own focus handling, Escape and arrow keys.
 */
export function InspirationGrid({ items }: { items: InspirationItem[] }) {
  const t = useT();
  // `index` is only where the viewer opens; once open it pages through the photos itself.
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const viewerItems = useMemo(
    () =>
      items.map(
        (item): LightboxItem => ({
          src: item.src,
          thumb: item.thumb,
          alt: item.alt,
          video: false,
        }),
      ),
    [items],
  );

  function openAt(i: number) {
    setIndex(i);
    setOpen(true);
  }

  return (
    <>
      <div
        onPointerEnter={preloadLightbox}
        onFocus={preloadLightbox}
        onTouchStart={preloadLightbox}
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            onClick={() => openAt(i)}
            aria-label={t('View photo {n}', { n: i + 1 })}
            className="group block w-full overflow-hidden rounded-xl"
          >
            <img
              {...responsiveImage(item.thumb ?? item.src, {
                sizes: '(min-width: 640px) 240px, 46vw',
                widths: [400, 800],
              })}
              alt={item.alt}
              loading="lazy"
              className={`w-full object-cover transition duration-300 group-hover:scale-[1.03] ${item.aspect}`}
            />
          </button>
        ))}
      </div>

      {open && items[index] && (
        <Lightbox items={viewerItems} index={index} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
