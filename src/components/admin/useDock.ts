'use client';

import { useEffect, useState } from 'react';

/**
 * A side panel that docks beside its list on a wide screen and slides over it on a narrow one — the
 * Calendar's day sheet and the Bookings detail. Both measure their OWN width, not the window's: the
 * assistant column narrows the page without a resize.
 */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** The admin top bar's real height, so a docked panel sits flush under it. */
export function useTopbarHeight(): number {
  const [height, setHeight] = useState(65);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-admin-topbar]');
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return height;
}
