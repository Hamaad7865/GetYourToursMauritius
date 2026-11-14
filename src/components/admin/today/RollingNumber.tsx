'use client';

import { useEffect, useState } from 'react';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
/** One row of the reel. Taller than 1em so no font's digits are clipped at the top. */
const ROW = 1.15;

/**
 * A figure whose digits roll up into place, each a beat after the one before (the "slot reel" from
 * ObsidianUI's analytics dashboard, done here with a CSS transform instead of its animation library,
 * so nothing new ships in the edge bundle). Anything that is not a digit (€, commas, "…", "—") simply
 * sits in line.
 *
 * Screen readers get the plain value once; the reels are hidden from them. With reduced motion the
 * transition is off, so the figure is simply there. Give it a `key` of its value to roll again when
 * the value arrives (a card mounts with "…" while its read loads).
 */
export function RollingNumber({ value, className = '' }: { value: string; className?: string }) {
  const [rolled, setRolled] = useState(false);
  useEffect(() => {
    // The next frame starts the roll. A tab opened in the background gets no frames, so a timer
    // makes sure the real figure is there (not a row of zeros) whenever the page is looked at.
    const id = window.requestAnimationFrame(() => setRolled(true));
    const late = window.setTimeout(() => setRolled(true), 150);
    return () => {
      window.cancelAnimationFrame(id);
      window.clearTimeout(late);
    };
  }, []);
  let digitIndex = 0;
  return (
    <span className={`inline-flex ${className}`}>
      <span className="sr-only">{value}</span>
      <span
        aria-hidden="true"
        className="inline-flex select-none"
        style={{ lineHeight: `${ROW}em` }}
      >
        {[...value].map((ch, i) => {
          if (!/[0-9]/.test(ch)) {
            return (
              <span key={i} className="inline-block" style={{ height: `${ROW}em` }}>
                {ch}
              </span>
            );
          }
          const order = digitIndex;
          digitIndex += 1;
          const target = rolled ? Number(ch) : 0;
          return (
            <span
              key={i}
              className="relative inline-block overflow-hidden"
              style={{ height: `${ROW}em` }}
            >
              {/* Holds the column at the digit's own width (tabular figures). */}
              <span className="invisible">{ch}</span>
              <span
                className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
                style={{
                  transform: `translateY(-${target * ROW}em)`,
                  transitionDelay: `${order * 45}ms`,
                }}
              >
                {DIGITS.map((d) => (
                  <span key={d} style={{ height: `${ROW}em` }}>
                    {d}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
