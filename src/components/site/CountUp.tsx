'use client';

import { useEffect, useRef, useState } from 'react';

/** Explicit locale so the server and client render byte-identical text (no hydration mismatch). */
const format = (value: number, decimals: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

/**
 * Ticks a number up from zero once it scrolls into view, then stops for good.
 *
 * Decorative-safe by construction: the final value is what renders on the server, so no-JS and
 * prefers-reduced-motion show the real figure and never animate. The ticking text is aria-hidden
 * with the settled value in a sibling `sr-only` span, so assistive tech reads "4.8" once rather
 * than every intermediate frame. Used above the fold, where the group reveal's opacity:0 covers
 * the reset-to-zero frame.
 */
export function CountUp({
  value,
  decimals = 0,
  duration = 900,
  delay = 0,
}: {
  value: number;
  decimals?: number;
  duration?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start = 0;
    let cancelled = false;

    const step = (ts: number) => {
      if (cancelled) return;
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      // easeOutCubic — fast off the mark, settles gently onto the real figure.
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
      else setShown(value);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setShown(0);
        timer = setTimeout(() => {
          raf = requestAnimationFrame(step);
        }, delay);
      },
      { threshold: 0.2 },
    );
    io.observe(el);

    return () => {
      cancelled = true;
      io.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [value, duration, delay]);

  return (
    <span ref={ref}>
      <span aria-hidden="true">{format(shown, decimals)}</span>
      <span className="sr-only">{format(value, decimals)}</span>
    </span>
  );
}
