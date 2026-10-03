'use client';

import { useEffect, useState } from 'react';
import { responsiveImage } from '@/lib/images/resize';
import { IconChevronLeft, IconChevronRight, IconMinus, IconPlay, IconPlus, IconX } from './icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** Full-screen photo: big, so the top of the ladder; the 64 px filmstrip needs only the smallest step. */
const MAIN_WIDTHS = [1200, 1600, 2400] as const;
const THUMB_WIDTHS = [400] as const;

export interface LightboxItem {
  src: string;
  thumb?: string | null;
  alt: string;
  /** A video of any kind: an uploaded file, or an embedded YouTube / Vimeo player (see `embedUrl`). */
  video: boolean;
  /** A YouTube / Vimeo player to embed instead of playing `src` as a file. */
  embedUrl?: string | null;
}

/**
 * Shared fullscreen viewer: counter, arrows, a thumbnail strip of every item below (click to
 * jump), and zoom in/out on photos (buttons + click toggles, wheel-free so page scroll is never
 * hijacked). Videos play with controls and skip the zoom UI. Keyboard arrows + Escape stay with
 * the caller (it owns the index state); focus trap + scroll lock come from useDialog there.
 */
export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
  dialogRef,
  closeLabel,
  prevLabel,
  nextLabel,
  zoomInLabel,
  zoomOutLabel,
}: {
  items: LightboxItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  dialogRef: React.RefObject<HTMLDivElement | null>;
  closeLabel: string;
  prevLabel: string;
  nextLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
}) {
  const [zoom, setZoom] = useState(1);
  // A new photo starts unzoomed — a carried-over 3x on the next slide looks broken.
  useEffect(() => {
    setZoom(1);
  }, [index]);
  const item = items[index];
  if (!item) return null;

  const zoomTo = (next: number) => setZoom(Math.min(4, Math.max(1, next)));

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[300] flex flex-col bg-[rgba(7,30,36,0.94)] p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between gap-3 text-white">
        <span className="text-sm font-semibold">
          {index + 1} / {items.length}
        </span>
        <span className="flex items-center gap-2">
          {!item.video && (
            <>
              <button
                type="button"
                onClick={() => zoomTo(zoom / 1.5)}
                disabled={zoom <= 1}
                aria-label={zoomOutLabel}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-40"
              >
                <IconMinus width={18} height={18} />
              </button>
              <button
                type="button"
                onClick={() => zoomTo(zoom * 1.5)}
                disabled={zoom >= 4}
                aria-label={zoomInLabel}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-40"
              >
                <IconPlus width={18} height={18} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/15 hover:bg-white/25"
          >
            <IconX width={20} height={20} />
          </button>
        </span>
      </div>

      <div className="relative mt-2 flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {items.length > 1 && (
          <button
            type="button"
            onClick={() => onIndex((index - 1 + items.length) % items.length)}
            aria-label={prevLabel}
            className="absolute left-2 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-ink/65 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-ink/85 sm:left-4"
          >
            <IconChevronLeft width={26} height={26} />
          </button>
        )}
        <div className="flex h-full w-full items-center justify-center overflow-auto">
          {item.embedUrl ? (
            <iframe
              key={item.embedUrl}
              src={item.embedUrl}
              title={item.alt}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              className="aspect-video max-h-full w-full max-w-5xl rounded-xl bg-black"
            />
          ) : item.video ? (
            <video
              key={item.src}
              src={item.src}
              controls
              playsInline
              autoPlay
              className="max-h-full max-w-full select-none rounded-xl"
            />
          ) : (
            <img
              key={item.src}
              {...responsiveImage(item.src, { sizes: '100vw', widths: MAIN_WIDTHS })}
              alt={item.alt}
              onClick={() => zoomTo(zoom > 1 ? 1 : 2.5)}
              className="max-h-full max-w-full select-none rounded-xl object-contain"
              style={{
                transform: `scale(${zoom})`,
                cursor: zoom > 1 ? 'zoom-out' : 'zoom-in',
              }}
            />
          )}
        </div>
        {items.length > 1 && (
          <button
            type="button"
            onClick={() => onIndex((index + 1) % items.length)}
            aria-label={nextLabel}
            className="absolute right-2 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-ink/65 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-ink/85 sm:right-4"
          >
            <IconChevronRight width={26} height={26} />
          </button>
        )}
      </div>

      {items.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {items.map((thumb, i) => (
            <button
              key={`${thumb.src}-${i}`}
              type="button"
              aria-label={`${i + 1} / ${items.length}`}
              aria-current={i === index}
              onClick={() => onIndex(i)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-2 transition ${
                i === index ? 'ring-white' : 'ring-transparent opacity-60 hover:opacity-100'
              }`}
            >
              {thumb.embedUrl && !thumb.thumb ? (
                // A Vimeo link has no still to show: a dark tile with a play mark.
                <span className="grid h-full w-full place-items-center bg-ink text-white">
                  <IconPlay width={18} height={18} />
                </span>
              ) : thumb.video && !thumb.embedUrl ? (
                <video
                  src={thumb.src}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : (
                <img
                  {...responsiveImage(thumb.thumb ?? thumb.src, {
                    sizes: '64px',
                    widths: THUMB_WIDTHS,
                  })}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
