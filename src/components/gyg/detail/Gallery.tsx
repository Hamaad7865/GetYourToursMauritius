'use client';

import { useMemo, useState } from 'react';
import type { TourImage } from '@/lib/validation/tours';
import { videoSource } from '@/lib/media';
import { PACKAGE_GRID_TILES, sideTileClasses } from '@/lib/catalogue/package-gallery';
import { responsiveImage } from '@/lib/images/resize';
import { IconPlay } from '@/components/ui/icons';
import { Lightbox, preloadLightbox, type LightboxItem } from '@/components/ui/Lightbox';
import { useT } from '@/components/site/PreferencesProvider';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** The lead tile is the big one (the page's LCP): ~60% of the column, or all of it on a phone. The four
 *  side tiles are a fifth of the width each and only exist from `sm` up. */
const LEAD_SIZES = '(min-width: 1280px) 700px, (min-width: 640px) 62vw, 100vw';
const LEAD_WIDTHS = [800, 1200, 1600] as const;
const SIDE_SIZES = '(min-width: 1280px) 240px, 20vw';
const SIDE_WIDTHS = [400, 800] as const;

/** The photoshoot page's grid: a wider lead (60%) beside a 2×2 block, or all of the width when it stands alone. */
const PKG_LEAD_SIZES = '(min-width: 1280px) 830px, (min-width: 640px) 60vw, 100vw';
const PKG_SOLO_SIZES = '(min-width: 1280px) 1200px, 100vw';
const PKG_SIDE_SIZES = '(min-width: 1280px) 270px, (min-width: 640px) 20vw, 50vw';

type TileSizing = { sizes: string; widths: readonly number[] };

function Tile({
  image,
  title,
  position,
  priority = false,
  onOpen,
  rounded,
  sizing,
  videoLabel,
  className,
}: {
  image: TourImage;
  title: string;
  /** 1-based photo number — gives each tile a distinct, descriptive alt (not the same tour title). */
  position: number;
  /** The large lead tile is the page's LCP — load it eagerly + high priority; the rest lazy. */
  priority?: boolean;
  onOpen: () => void;
  rounded: string;
  /** Overrides the default tour-card sizing (the photoshoot grid lays its tiles out differently). */
  sizing?: TileSizing;
  /** Accessible name for a video tile ("Video"), which has no picture to describe it. */
  videoLabel: string;
  className?: string;
}) {
  // An uploaded file plays from its first frame; a YouTube link shows its still; Vimeo offers none, so a
  // dark tile. All three carry a play badge so a visitor can tell a film from a photo.
  const video = videoSource(image.url);
  const fit = 'h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]';
  const size = sizing ?? {
    sizes: priority ? LEAD_SIZES : SIDE_SIZES,
    widths: priority ? LEAD_WIDTHS : SIDE_WIDTHS,
  };
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={video ? image.alt || `${title} — ${videoLabel}` : undefined}
      className={`group relative h-full w-full overflow-hidden ${rounded}${className ? ` ${className}` : ''}`}
    >
      {video?.kind === 'file' ? (
        <video src={image.url} muted playsInline preload="metadata" className={fit} />
      ) : video?.kind === 'youtube' ? (
        <img
          src={video.thumbUrl}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className={fit}
        />
      ) : video ? (
        <span aria-hidden className="block h-full w-full bg-ink" />
      ) : (
        <img
          {...responsiveImage(image.url, size)}
          alt={image.alt ?? `${title} — photo ${position}`}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          className={fit}
        />
      )}
      {video && (
        <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-ink/65 text-white shadow-lg ring-1 ring-white/30 backdrop-blur-sm">
            <IconPlay width={20} height={20} />
          </span>
        </span>
      )}
    </button>
  );
}

/** Fetch the full-screen viewer as soon as a visitor reaches for the gallery (a hover, a focus, a touch), so
 *  the first photo they open appears at once instead of after the viewer's code has downloaded. */
const PRELOAD_VIEWER = {
  onPointerEnter: preloadLightbox,
  onFocus: preloadLightbox,
  onTouchStart: preloadLightbox,
};

/** GetYourGuide-style gallery: one large image + a 2×2 grid (equal height), with a
 *  "View all photos" button opening a full-screen viewer (swipe, zoom, thumbnails, keyboard). Photos,
 *  uploaded videos and YouTube / Vimeo links all work. `variant="photography"` is the photoshoot package
 *  page's layout: the same lead + four, but filled for any number of photos and on a phone too. */
export function Gallery({
  images,
  title,
  leadOnly = false,
  variant = 'tour',
}: {
  images: TourImage[];
  title: string;
  leadOnly?: boolean;
  variant?: 'tour' | 'photography';
}) {
  // `index` is only where the viewer opens; once open it pages through the photos itself, and it brings its
  // own focus handling, Escape, arrow keys and scroll lock (no useDialog needed here).
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const t = useT();

  // What the viewer shows. Memoised because the viewer rebuilds its slides whenever this changes.
  const viewerItems = useMemo(
    () =>
      images.map((img, i): LightboxItem => {
        const v = videoSource(img.url);
        return {
          src: img.url,
          ...(v?.kind === 'youtube' ? { thumb: v.thumbUrl } : {}),
          alt: img.alt ?? `${title} — ${v ? 'video' : 'photo'} ${i + 1}`,
          video: v !== null,
          ...(v && v.kind !== 'file' ? { embedUrl: v.embedUrl } : {}),
        };
      }),
    [images, title],
  );

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

  const grid = images.slice(0, PACKAGE_GRID_TILES);
  const videoLabel = t('Video');
  const hasVideo = images.some((img) => videoSource(img.url) !== null);
  const viewAll =
    images.length === 1
      ? t('View photo')
      : hasVideo
        ? t('View all {n} photos and videos', { n: images.length })
        : t('View all {n} photos', { n: images.length });

  const lightbox = open && (
    <Lightbox items={viewerItems} index={index} onClose={() => setOpen(false)} />
  );

  const viewAllButton = (
    <button
      type="button"
      onClick={() => openAt(0)}
      className="absolute bottom-3.5 right-3.5 rounded-xl border border-ink/10 bg-white/95 px-4 py-2 text-[13px] font-bold text-ink shadow-[0_6px_18px_-6px_rgba(10,46,54,0.4)] hover:bg-white"
    >
      {viewAll}
    </button>
  );

  if (variant === 'photography') {
    const sides = grid.slice(1);
    const spans = sideTileClasses(sides.length);
    const solo = sides.length === 0;
    return (
      <div>
        {/* sm+: a fixed-height row (grid-rows-1 clamps it — a portrait photo's intrinsic ratio must not
            inflate it), the lead on the left and a 2×2 block on the right. A phone stacks them: the lead
            on top, the block below in 120 px rows. */}
        <div
          {...PRELOAD_VIEWER}
          className={`relative grid gap-3 ${
            solo
              ? ''
              : `sm:h-[452px] sm:grid-rows-1 ${sides.length >= 3 ? 'sm:grid-cols-[1.5fr_1fr]' : 'sm:grid-cols-[2fr_1fr]'}`
          }`}
        >
          <div className={solo ? 'aspect-[16/9] sm:aspect-[21/9]' : 'h-[210px] sm:h-full'}>
            <Tile
              image={grid[0]!}
              title={title}
              position={1}
              priority
              onOpen={() => openAt(0)}
              rounded="rounded-[18px]"
              className="bg-teal-tint"
              videoLabel={videoLabel}
              sizing={{
                sizes: solo ? PKG_SOLO_SIZES : PKG_LEAD_SIZES,
                widths: solo ? [800, 1200, 1600, 2400] : LEAD_WIDTHS,
              }}
            />
          </div>
          {!solo && (
            <div className="grid auto-rows-[120px] grid-cols-2 gap-3 sm:h-full sm:auto-rows-auto sm:grid-rows-2">
              {sides.map((img, i) => (
                <div key={img.id} className={spans[i] || undefined}>
                  <Tile
                    image={img}
                    title={title}
                    position={i + 2}
                    onOpen={() => openAt(i + 1)}
                    rounded="rounded-[18px]"
                    className="bg-teal-tint"
                    videoLabel={videoLabel}
                    sizing={{ sizes: PKG_SIDE_SIZES, widths: SIDE_WIDTHS }}
                  />
                </div>
              ))}
            </div>
          )}
          {viewAllButton}
        </div>
        {lightbox}
      </div>
    );
  }

  return (
    <div className="mb-6">
      {/* grid-rows-1 clamps the row to the pinned height — without it a portrait photo's
          intrinsic ratio inflates the implicit row and the tiles paint over the content below. */}
      <div
        {...PRELOAD_VIEWER}
        className={`relative grid h-[240px] grid-rows-1 gap-2 sm:h-[360px] ${leadOnly ? '' : 'sm:grid-cols-[1.6fr_1fr]'}`}
      >
        <Tile
          image={grid[0]!}
          title={title}
          position={1}
          priority
          onOpen={() => openAt(0)}
          rounded="rounded-2xl"
          videoLabel={videoLabel}
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
                videoLabel={videoLabel}
              />
            ))}
          </div>
        )}
        {viewAllButton}
      </div>

      {lightbox}
    </div>
  );
}
