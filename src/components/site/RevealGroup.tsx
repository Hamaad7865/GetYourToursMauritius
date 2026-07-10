'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Reveals its children one after another as the group scrolls into view — a single
 * IntersectionObserver for the whole group, with the stagger done in CSS (`.gyt-reveal > *:nth-child`).
 * Server children pass straight through, so review lists stay server-rendered.
 *
 * Decorative-safe by construction: children are only ever hidden once JS has confirmed motion is
 * allowed, and a watchdog force-reveals if the observer never fires its initial callback (zero-height
 * embeds, broken IO). No-JS and prefers-reduced-motion render the plain, fully visible list.
 */
export function RevealGroup({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    setArmed(true);

    let sawCallback = false;
    const io = new IntersectionObserver(
      (entries) => {
        sawCallback = true;
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold: 0.08 },
    );
    io.observe(el);
    const watchdog = setTimeout(() => {
      if (!sawCallback) setRevealed(true);
    }, 1200);

    return () => {
      io.disconnect();
      clearTimeout(watchdog);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} ${armed ? 'gyt-reveal' : ''} ${revealed ? 'is-in' : ''}`.trim()}
    >
      {children}
    </div>
  );
}
