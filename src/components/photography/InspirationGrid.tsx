'use client';

import { responsiveImage } from '@/lib/images/resize';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { useDialog } from '@/lib/a11y/useDialog';
import { Lightbox } from '@/components/ui/Lightbox';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

export interface InspirationItem {
  key: string;
  src: string;
  thumb: string | null;
  alt: string;
  aspect: string;
}

/**
 * The package page's "Get inspired" strip: uniform tiles that open the shared lightbox
 * (thumbnails below, zoom on photos).
 */
export function InspirationGrid({ items }: { items: InspirationItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const dialogRef = useDialog(open, () => setOpen(false));

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + items.length) % Math.max(1, items.length)),
    [items.length],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);

  function openAt(i: number) {
    setIndex(i);
    setOpen(true);
  }

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
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
        <Lightbox
          items={items.map((item) => ({
            src: item.src,
            thumb: item.thumb,
            alt: item.alt,
            video: false,
          }))}
          index={index}
          onIndex={setIndex}
          onClose={() => setOpen(false)}
          dialogRef={dialogRef}
          closeLabel={t('Close gallery')}
          prevLabel={t('Previous photo')}
          nextLabel={t('Next photo')}
          zoomInLabel={t('Zoom in')}
          zoomOutLabel={t('Zoom out')}
        />
      )}
    </>
  );
}
