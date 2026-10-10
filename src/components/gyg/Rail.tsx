'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';
import { useT } from '@/components/site/PreferencesProvider';

/**
 * Horizontal, scroll-snapping rail with GetYourGuide-style circular ‹ › arrow
 * buttons that appear only when there's more to scroll in that direction.
 */
export function Rail({
  children,
  ariaLabel,
  center = false,
  bleed = false,
  arrowTop = 'top-[38%]',
}: {
  children: React.ReactNode;
  ariaLabel?: string;
  /** Centre the cards when they don't fill the width (still scrolls if they overflow). */
  center?: boolean;
  /** Phones: run the track to the screen edges so the next card peeks in, instead of clipping at the
   *  page gutter. Assumes the parent's `px-6` gutter — scroll-px-6 must mirror it, because snapping
   *  aligns cards to the snapport (the padding box), not the content box. */
  bleed?: boolean;
  /** Vertical position of the arrows — the default suits tall photo cards (centres on the photo). */
  arrowTop?: string;
}) {
  const t = useT();
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
    // Re-measure when the cards change: a rail that fills in after mount would otherwise keep the
    // arrow state it measured while empty.
  }, [update, children]);

  function scrollBy(dir: 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: 'smooth' });
  }

  const arrow = `absolute ${arrowTop} hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-white text-ink shadow-[0_6px_18px_-6px_rgba(10,46,54,0.5)] hover:border-teal hover:text-teal md:grid`;

  return (
    <div className="relative">
      <div
        ref={trackRef}
        aria-label={ariaLabel}
        className={`no-bar flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-2 ${
          center ? 'justify-center' : ''
        } ${bleed ? '-mx-6 scroll-px-6 px-6 sm:mx-0 sm:scroll-px-0 sm:px-0' : ''}`}
      >
        {children}
      </div>

      {!atStart && (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label={t('Scroll left')}
          className={`${arrow} -left-3`}
        >
          <IconChevronLeft width={20} height={20} />
        </button>
      )}
      {!atEnd && (
        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label={t('Scroll right')}
          className={`${arrow} -right-3`}
        >
          <IconChevronRight width={20} height={20} />
        </button>
      )}
    </div>
  );
}
