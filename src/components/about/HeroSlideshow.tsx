'use client';

import { useEffect, useState } from 'react';

/**
 * Animated hero backdrop for the About page: a slow Ken Burns crossfade slideshow of island
 * photos, sitting under the hero's gradient scrim (the headline stays on top, untouched).
 * Animation is purely opacity + transform (GPU-friendly), and it pauses entirely under
 * prefers-reduced-motion — then it just shows the first frame, static. Decorative, so the
 * images are aria-hidden with empty alt (the hero <h1> carries the meaning).
 */
export function HeroSlideshow({
  images,
  intervalMs = 6000,
}: {
  images: string[];
  /** Time each slide is held before crossfading to the next. */
  intervalMs?: number;
}) {
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (images.length <= 1) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;
    setAnimate(true);
    const id = setInterval(() => setIndex((i) => (i + 1) % images.length), intervalMs);
    return () => clearInterval(id);
  }, [images.length, intervalMs]);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <style>{`@keyframes gytmHeroKen{from{transform:scale(1.06)}to{transform:scale(1.16)}}`}</style>
      {images.map((src, i) => {
        const visible = animate ? i === index : i === 0;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt=""
            loading={i === 0 ? 'eager' : 'lazy'}
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: visible ? 1 : 0,
              transition: 'opacity 1400ms ease-in-out',
              willChange: 'opacity, transform',
              // Ken Burns only on the active slide; restarts each time a slide becomes active.
              animation:
                animate && i === index ? `gytmHeroKen ${intervalMs + 1800}ms ease-out both` : 'none',
            }}
          />
        );
      })}
    </div>
  );
}
