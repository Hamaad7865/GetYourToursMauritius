'use client';

import { useState } from 'react';

/** Collapsible content block with a GetYourGuide-style "See more / See less" toggle.
 *  Assumes a cream section background for the fade. */
export function SeeMore({
  children,
  collapsedHeight = 168,
}: {
  children: React.ReactNode;
  collapsedHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div
        className="relative overflow-hidden transition-[max-height] duration-300"
        style={{ maxHeight: open ? 4000 : collapsedHeight }}
      >
        {children}
        {!open && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-cream to-transparent" />
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-2 text-sm font-bold text-teal underline underline-offset-2 hover:text-teal-dark"
      >
        {open ? 'See less' : 'See more'}
      </button>
    </div>
  );
}
