'use client';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

import { responsiveImage } from '@/lib/images/resize';
import { useEffect, useRef, useState } from 'react';
import type { V3HeroSlide } from './packages-data';

/**
 * The v3 home hero's rotating collage: one tall tile + two stacked, cycling every 6s with progress
 * bars, pausing on hover and honouring prefers-reduced-motion (the rotation stops — the current
 * tiles just stay). The caption card links each slide to its matched package.
 */
export function PhotoHeroCollage({
  slides,
  viewLabel,
}: {
  slides: V3HeroSlide[];
  viewLabel: string;
}) {
  const [cur, setCur] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);
  const n = slides.length;

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (paused || reduced.current || n < 2) return;
    const timer = setInterval(() => setCur((c) => (c + 1) % n), 6000);
    return () => clearInterval(timer);
  }, [paused, n]);

  if (n === 0) return null;

  // With fewer than 3 slides the hidden slots reuse the visible ones — the collage keeps its shape.
  const at = (k: number) => slides[(cur + k) % n]!;
  const slide = slides[cur]!;

  const tileClass = (k: number) =>
    k === 0
      ? 'left-0 top-0 z-[2] h-full w-[calc((100%-14px)*0.574)]'
      : k === 1
        ? 'right-0 top-0 z-[1] h-[calc(50%-7px)] w-[calc((100%-14px)*0.426)]'
        : k === 2
          ? 'right-0 top-[calc(50%+7px)] z-[1] h-[calc(50%-7px)] w-[calc((100%-14px)*0.426)]'
          : 'pointer-events-none right-0 top-[calc(50%+7px)] z-0 h-[calc(50%-7px)] w-[calc((100%-14px)*0.426)] scale-90 opacity-0';

  const caption = (
    <div className="pointer-events-auto absolute bottom-3.5 left-3.5 z-[5] w-[calc((100%-14px)*0.574-28px)] min-w-0 rounded-[14px] bg-white/95 p-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-teal-dark">{slide.tag}</p>
          <p className="truncate text-sm font-bold text-ink">{slide.short}</p>
          {slide.priceLabel && (
            <p className="truncate text-xs text-ink-muted">{slide.priceLabel}</p>
          )}
        </div>
        {slide.href && (
          <a
            href={slide.href}
            {...(slide.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="flex-none rounded-full bg-ink px-3.5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal"
          >
            {viewLabel} ›
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative h-[420px] sm:h-[534px]"
    >
      {[0, 1, 2].map((k) => {
        const s = at(k);
        return (
          <button
            key={`${s.id}-${k === 0 ? 'main' : `stack-${k}`}`}
            type="button"
            onClick={() => setCur((cur + k) % n)}
            aria-label={s.alt}
            className={`absolute overflow-hidden rounded-[18px] bg-teal-tint transition-all duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${tileClass(k)}`}
          >
            <img
              {...responsiveImage(
                s.src,
                // The main tile is ~57% of the collage; the stacked ones ~43% and half its height.
                k === 0
                  ? { sizes: '(min-width: 1024px) 400px, 60vw', widths: [400, 800, 1200] }
                  : { sizes: '(min-width: 1024px) 280px, 42vw', widths: [400, 800] },
              )}
              alt={s.alt}
              className="h-full w-full object-cover"
              loading={k === 0 ? undefined : 'lazy'}
            />
            {k > 0 && (
              <span className="absolute bottom-2.5 left-2.5 max-w-[calc(100%-20px)] truncate rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-ink">
                {s.short}
              </span>
            )}
          </button>
        );
      })}

      {/* progress bars */}
      <div className="pointer-events-none absolute left-3.5 top-3.5 z-[5] flex w-[calc((100%-14px)*0.574-28px)] gap-1.5">
        {slides.map((s, i) => (
          <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded bg-white/50">
            <span
              key={`${cur}-${paused}`}
              className={`block h-full bg-white ${
                i < cur || (i === cur && paused)
                  ? 'w-full'
                  : i === cur
                    ? 'animate-[heroBar_6s_linear_forwards]'
                    : 'w-0'
              }`}
            />
          </span>
        ))}
      </div>

      {caption}
    </div>
  );
}
