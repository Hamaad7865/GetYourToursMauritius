'use client';

import { useEffect, useRef } from 'react';

/**
 * Scroll to `#id` once `ready`, when the URL fragment names it.
 *
 * Why this exists: the booking page fetches its content on the client, so the section a delivery
 * email links to (`/bookings/REF#gallery`, `/bookings/REF#balance-payment`) does not exist when the
 * browser runs its own fragment scroll — it has nothing to land on and the guest is left at the top
 * of a long page. Call this with `ready` flipping true on the render that mounts the target.
 *
 * Once per mount: the guest may scroll away straight after, and a later re-render must not drag them
 * back. `scroll-margin-top` on the target (the sections carry `scroll-mt-*`) clears the sticky header.
 */
export function useScrollToHash(id: string, ready: boolean): void {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    if (window.location.hash !== `#${id}`) return;
    const el = document.getElementById(id);
    if (!el) return;
    done.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [id, ready]);
}
