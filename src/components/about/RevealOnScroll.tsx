'use client';

import { useEffect } from 'react';

/**
 * Replicates the About-page prototype's scroll-reveal: on mount, every `[data-reveal]`
 * element starts at opacity:0 + translateY(28px) and eases into place when it scrolls
 * into view, honouring an optional `data-reveal-delay` (ms). Bails out entirely under
 * `prefers-reduced-motion`. Renders nothing.
 */
export function RevealOnScroll() {
  useEffect(() => {
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    // Defer one frame so the (streamed) DOM is in place before we measure.
    const raf = requestAnimationFrame(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
      els.forEach((el) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(28px)';
        el.style.transition =
          'opacity .8s cubic-bezier(.2,.7,.2,1), transform .8s cubic-bezier(.2,.7,.2,1)';
      });

      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const el = entry.target as HTMLElement;
            const delay = el.getAttribute('data-reveal-delay') ?? '0';
            el.style.transitionDelay = `${delay}ms`;
            el.style.opacity = '1';
            el.style.transform = 'none';
            io.unobserve(el);
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
      );

      els.forEach((el) => io.observe(el));
    });

    return () => cancelAnimationFrame(raf);
  }, []);

  return null;
}
