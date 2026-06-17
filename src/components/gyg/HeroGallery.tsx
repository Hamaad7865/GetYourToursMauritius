'use client';

import { useEffect, useState } from 'react';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** Curated Belle Mare "5 islands" trip photos that slide through the hero's square frame. */
const ISLAND_PHOTOS = [
  '/hero/islands/aerial-lagoon.jpg',
  '/hero/islands/blue-lagoon.jpg',
  '/hero/islands/ile-aux-aigrettes.jpg',
  '/hero/islands/snorkel.jpg',
  '/hero/islands/ile-de-la-passe.jpg',
  '/hero/islands/cliff-jump.jpg',
  '/hero/islands/marine-park.jpg',
  '/hero/islands/speedboat.jpg',
];

const N = ISLAND_PHOTOS.length;
const SLIDE_MS = 700;
const HOLD_MS = 3200;

/**
 * Decorative photo slideshow for the hero's open (right) side: real Belle Mare island shots that
 * slide through a single square frame, auto-advancing and looping seamlessly (a clone of the first
 * slide lets it wrap forward without a visible rewind). Hidden below lg (no room) and static under
 * prefers-reduced-motion. Decorative + non-interactive, so aria-hidden + pointer-events-none.
 */
export function HeroGallery() {
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);

  // Auto-advance (skipped entirely under reduced-motion).
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setIndex((n) => n + 1), HOLD_MS);
    return () => window.clearInterval(t);
  }, []);

  // When we reach the appended clone of slide 0, snap back to the real slide 0 with no transition.
  useEffect(() => {
    if (index === N) {
      const t = window.setTimeout(() => {
        setAnimate(false);
        setIndex(0);
      }, SLIDE_MS);
      return () => window.clearTimeout(t);
    }
    if (!animate) {
      const r = requestAnimationFrame(() => setAnimate(true));
      return () => cancelAnimationFrame(r);
    }
  }, [index, animate]);

  const active = index % N;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-[4%] top-1/2 z-[5] hidden w-[42vw] max-w-[440px] -translate-y-1/2 lg:block xl:right-[6%]"
    >
      <div className="relative aspect-square overflow-hidden rounded-[28px] bg-ink/20 shadow-[0_44px_88px_-34px_rgba(5,28,32,0.9)] ring-1 ring-white/20">
        <div
          className="flex h-full"
          style={{
            transform: `translateX(-${index * 100}%)`,
            transition: animate ? `transform ${SLIDE_MS}ms cubic-bezier(0.5, 0, 0.2, 1)` : 'none',
          }}
        >
          {[...ISLAND_PHOTOS, ISLAND_PHOTOS[0]!].map((src, i) => (
            <img key={`${src}-${i}`} src={src} alt="" className="h-full w-full shrink-0 object-cover" />
          ))}
        </div>

        {/* Inner frame + bottom scrim so the dots read against any photo. */}
        <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/15" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink/55 to-transparent" />
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
          {ISLAND_PHOTOS.map((src, i) => (
            <span
              key={src}
              className={`h-1.5 rounded-full transition-all duration-500 ${i === active ? 'w-5 bg-white' : 'w-1.5 bg-white/45'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
