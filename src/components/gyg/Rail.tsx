'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';

/**
 * Horizontal, scroll-snapping rail with GetYourGuide-style circular ‹ › arrow
 * buttons that appear only when there's more to scroll in that direction.
 */
export function Rail({
  children,
  ariaLabel,
  center = false,
}: {
  children: React.ReactNode;
  ariaLabel?: string;
  /** Centre the cards when they don't fill the width (still scrolls if they overflow). */
  center?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    update();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update]);

  function scrollBy(dir: 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: 'smooth' });
  }

  return (
    <div className="relative">
      <div
        ref={trackRef}
        aria-label={ariaLabel}
        className={`no-bar flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-2 ${
          center ? 'justify-center' : ''
        }`}
      >
        {children}
      </div>

      {!atStart && (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label="Scroll left"
          className="absolute -left-3 top-[38%] hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-white text-ink shadow-[0_6px_18px_-6px_rgba(10,46,54,0.5)] hover:border-teal hover:text-teal md:grid"
        >
          <IconChevronLeft width={20} height={20} />
        </button>
      )}
      {!atEnd && (
        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label="Scroll right"
          className="absolute -right-3 top-[38%] hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-white text-ink shadow-[0_6px_18px_-6px_rgba(10,46,54,0.5)] hover:border-teal hover:text-teal md:grid"
        >
          <IconChevronRight width={20} height={20} />
        </button>
      )}
    </div>
  );
}
