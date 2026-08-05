'use client';

import { useEffect, type RefObject } from 'react';

/** The CSS variable a mobile sticky bottom bar publishes its own height into. */
export const BOTTOM_BAR_VAR = '--gyt-bottom-bar';

/**
 * Publish a mobile sticky bottom bar's height as `--gyt-bottom-bar` on <html>, so anything floating
 * above it (today: the ContactFloat bubble) can clear it with `calc(… + var(--gyt-bottom-bar, 0px))`
 * instead of hardcoding a guess.
 *
 * Why a measured variable rather than a fixed offset: the float used to sit at `bottom-24` on every
 * page to clear MobileBookBar — which exists only on activity pages — so on the home page, listings
 * and blog it hovered ~96px up the screen for no reason instead of resting in the corner.
 *
 * The bars are all `lg:hidden`, so on desktop they measure 0 and the variable collapses to 0px on
 * its own (ResizeObserver reports the display:none change). At most ONE of these bars is mounted at
 * a time — they live on different routes — so a single shared variable needs no registry; the
 * cleanup REMOVES the property, which matters: consumers fall back to
 * `env(safe-area-inset-bottom)` when it's absent, and a 0px value would swallow that fallback and
 * park the float under the iOS home indicator. A measured height already includes the bar's own
 * safe-area padding, so the two never stack.
 */
export function useBottomBarOffset(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const publish = () => {
      document.documentElement.style.setProperty(
        BOTTOM_BAR_VAR,
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(BOTTOM_BAR_VAR);
    };
  }, [ref]);
}
