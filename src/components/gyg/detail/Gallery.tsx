'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TourImage } from '@/lib/validation/tours';
import { isVideoUrl } from '@/lib/media';
import { Lightbox } from '@/components/ui/Lightbox';
import { useT } from '@/components/site/PreferencesProvider';
import { useDialog } from '@/lib/a11y/useDialog';

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
      {isVideoUrl(image.url) ? (
        <video
          src={image.url}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <img
          src={image.url}
          alt={image.alt ?? `${title} — photo ${position}`}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
        />
      )}
    </button>
  );
}

/** GetYourGuide-style gallery: one large image + a 2×2 grid (equal height), with a
 *  "View all photos" button opening a keyboard-navigable lightbox. */
export function Gallery({
  images,
  title,
  leadOnly = false,
}: {
  images: TourImage[];
  title: string;
  leadOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const t = useT();
  // Focus moves into the lightbox on open, Tab is trapped, Escape closes, body scroll locks, and focus
  // returns to the trigger on close — the shared modal hook the rest of the app's dialogs use.
  const dialogRef = useDialog(open, () => setOpen(false));

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + images.length) % Math.max(1, images.length)),
    [images.length],
  );

  // Left/right arrows page through the photos (useDialog owns Escape / Tab-trap / scroll-lock).
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
      {/* grid-rows-1 clamps the row to the pinned height — without it a portrait photo's
          intrinsic ratio inflates the implicit row and the tiles paint over the content below. */}
      <div
        className={`relative grid h-[240px] grid-rows-1 gap-2 sm:h-[360px] ${leadOnly ? '' : 'sm:grid-cols-[1.6fr_1fr]'}`}
      >
        <Tile
          image={grid[0]!}
          title={title}
          position={1}
          priority
          onOpen={() => openAt(0)}
          rounded="rounded-2xl"
        />
        {!leadOnly && grid.length > 1 && (
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
          {images.length === 1 ? t('View photo') : t('View all {n} photos', { n: images.length })}
        </button>
      </div>

      {open && (
        <Lightbox
          items={images.map((img, i) => ({
            src: img.url,
            alt: img.alt ?? `${title} — photo ${i + 1}`,
            video: isVideoUrl(img.url),
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
    </div>
  );
}
