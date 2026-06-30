'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TourImage } from '@/lib/validation/tours';
import { IconChevronLeft, IconChevronRight, IconX } from '@/components/ui/icons';
import { useT } from '@/components/site/PreferencesProvider';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

function Tile({
  image,
  title,
  position,
  priority = false,
  onOpen,
  rounded,
}: {
  image: TourImage;
  title: string;
  /** 1-based photo number — gives each tile a distinct, descriptive alt (not the same tour title). */
  position: number;
  /** The large lead tile is the page's LCP — load it eagerly + high priority; the rest lazy. */
  priority?: boolean;
  onOpen: () => void;
  rounded: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative h-full w-full overflow-hidden ${rounded}`}
    >
      <img
        src={image.url}
        alt={image.alt ?? `${title} — photo ${position}`}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
      />
    </button>
  );
}

/** GetYourGuide-style gallery: one large image + a 2×2 grid (equal height), with a
 *  "View all photos" button opening a keyboard-navigable lightbox. */
export function Gallery({ images, title }: { images: TourImage[]; title: string }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const t = useT();

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + images.length) % Math.max(1, images.length)),
    [images.length],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, go]);

  function openAt(i: number) {
    setIndex(i);
    setOpen(true);
  }

  if (images.length === 0) {
    return (
      <div className="mb-6 flex h-[260px] items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] sm:h-[400px]">
        <span className="font-display text-5xl font-semibold text-cream/90">
          {title.slice(0, 1)}
        </span>
      </div>
    );
  }

  const grid = images.slice(0, 5);

  return (
    <div className="mb-6">
      <div className="relative grid h-[240px] gap-2 sm:h-[360px] sm:grid-cols-[1.6fr_1fr]">
        <Tile image={grid[0]!} title={title} position={1} priority onOpen={() => openAt(0)} rounded="rounded-2xl" />
        {grid.length > 1 && (
          <div className="hidden grid-cols-2 grid-rows-2 gap-2 sm:grid">
            {grid.slice(1, 5).map((img, i) => (
              <Tile
                key={img.id}
                image={img}
                title={title}
                position={i + 2}
                onOpen={() => openAt(i + 1)}
                rounded="rounded-xl"
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => openAt(0)}
          className="absolute bottom-3.5 right-3.5 rounded-xl border border-ink/10 bg-white/95 px-4 py-2 text-[13px] font-bold text-ink shadow-[0_6px_18px_-6px_rgba(10,46,54,0.4)] hover:bg-white"
        >
          {t('View all {n} photos', { n: images.length })}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[300] flex flex-col bg-[rgba(7,30,36,0.94)] p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={t('Photo gallery')}
        >
          <div className="flex items-center justify-between text-white">
            <span className="text-sm font-semibold">
              {index + 1} / {images.length}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('Close gallery')}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/15 hover:bg-white/25"
            >
              <IconX width={20} height={20} />
            </button>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden">
            {images.length > 1 && (
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t('Previous photo')}
                className="absolute left-2 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-ink/65 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-ink/85 sm:left-4"
              >
                <IconChevronLeft width={26} height={26} />
              </button>
            )}
            <img
              src={images[index]!.url}
              alt={images[index]!.alt ?? title}
              className="max-h-full max-w-full select-none rounded-xl object-contain"
            />
            {images.length > 1 && (
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t('Next photo')}
                className="absolute right-2 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-ink/65 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-ink/85 sm:right-4"
              >
                <IconChevronRight width={26} height={26} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
