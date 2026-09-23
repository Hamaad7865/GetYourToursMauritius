'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Brings its children into focus as they scroll into view — a lens racking from soft to sharp,
 * which is the one motion idea the photography pages use.
 *
 * A port of Magic UI's BlurFade (Dillion Verma, MIT — 21st.dev/@dillionverma) without framer-motion:
 * one IntersectionObserver and a CSS transition (`.pg-blur-fade` in globals.css). Same safety rules
 * as RevealGroup: the content is only hidden once JS has confirmed motion is allowed, a watchdog
 * force-reveals if the observer never reports, and no-JS / reduced motion render it plainly visible.
 * Server children pass straight through.
 */
export function BlurFade({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [inView, setInView] = useState(false);

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
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    const watchdog = setTimeout(() => {
      if (!sawCallback) setInView(true);
    }, 1200);
    return () => {
      io.disconnect();
      clearTimeout(watchdog);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} ${armed ? 'pg-blur-fade' : ''} ${inView ? 'is-in' : ''}`.trim()}
    >
      {children}
    </div>
  );
}
