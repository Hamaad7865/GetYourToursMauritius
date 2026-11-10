'use client';

import { useEffect, useRef, useState } from 'react';

/** Calls `onNear` once, when `el` first comes within `margin` of the viewport. Returns a cleanup.
 *  No IntersectionObserver → calls it at once (old browsers keep the map). */
export function observeNear(el: Element, margin: string, onNear: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onNear();
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        onNear();
      }
    },
    { rootMargin: margin },
  );
  io.observe(el);
  return () => io.disconnect();
}

/**
 * True once the element comes within `margin` of the viewport (a one-way latch). Lets a map — and
 * every billed Google call it makes (geocode, computeRoutes, the map load) — wait until a visitor
 * actually scrolls to it. Crawlers and visitors who never scroll that far cost nothing.
 */
export function useNearViewport<T extends Element>(margin = '400px') {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !ref.current) return;
    return observeNear(ref.current, margin, () => setNear(true));
  }, [near, margin]);
  return [ref, near] as const;
}
