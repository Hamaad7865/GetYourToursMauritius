'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TourImage } from '@/lib/validation/tours';
import { IconChevronLeft, IconChevronRight, IconX } from '@/components/ui/icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

function Tile({ image, title, onOpen }: { image: TourImage; title: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group relative h-full w-full overflow-hidden">
      <img
        src={image.url}
        alt={image.alt ?? title}
        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
      />
    </button>
  );
}

/** GetYourGuide-style gallery: one large image + a 2×2 grid, with a "View all photos"
 *  button opening a keyboard-navigable lightbox. Falls back to a branded gradient. */
export function Gallery({ images, title }: { images: TourImage[]; title: string }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

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
      <div className="mb-6 flex h-[300px] items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] sm:h-[440px]">
        <span className="font-display text-5xl font-semibold text-cream/90">
          {title.slice(0, 1)}
        </span>
      </div>
    );
  }

  const grid = images.slice(0, 5);

  return (
    <div className="mb-6">
      <div className="relative grid h-[300px] grid-cols-2 gap-2 overflow-hidden rounded-2xl sm:h-[440px] sm:grid-cols-[1.5fr_1fr]">
        <div className="col-span-2 row-span-2 sm:col-span-1">
          <Tile image={grid[0]!} title={title} onOpen={() => openAt(0)} />
        </div>
        {grid.length > 1 && (
          <div className="hidden grid-cols-2 grid-rows-2 gap-2 sm:grid">
            {grid.slice(1, 5).map((img, i) => (
              <Tile key={img.id} image={img} title={title} onOpen={() => openAt(i + 1)} />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => openAt(0)}
          className="absolute bottom-3.5 right-3.5 rounded-xl border border-ink/10 bg-white/95 px-4 py-2 text-[13px] font-bold text-ink shadow-[0_6px_18px_-6px_rgba(10,46,54,0.4)] hover:bg-white"
        >
          View all {images.length} photos
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[300] flex flex-col bg-[rgba(7,30,36,0.94)] p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Photo gallery"
        >
          <div className="flex items-center justify-between text-white">
            <span className="text-sm font-semibold">
              {index + 1} / {images.length}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close gallery"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/15 hover:bg-white/25"
            >
              <IconX width={20} height={20} />
            </button>
          </div>
          <div className="relative flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute left-0 grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <IconChevronLeft width={24} height={24} />
            </button>
            <img
              src={images[index]!.url}
              alt={images[index]!.alt ?? title}
              className="max-h-full max-w-full rounded-xl object-contain"
            />
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute right-0 grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <IconChevronRight width={24} height={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
