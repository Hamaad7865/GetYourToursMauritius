'use client';

import { useRef, useState } from 'react';
import { attractionImageSrc } from '@/lib/content/attractions';
import { responsiveImage } from '@/lib/images/resize';
import { PHOTO_CARD } from '@/lib/images/presets';

/**
 * An attraction photo that degrades gracefully: it loads the (cached, proxied) image, and if that ever
 * fails — link-rot, an un-mapped slug, a transient error — it swaps to the branded category emoji over
 * the gradient instead of a broken-image icon.
 */
export function AttractionImage({ url, alt, emoji }: { url: string; alt: string; emoji: string }) {
  const [failed, setFailed] = useState(false);
  // A resized photo that fails is first swapped back to its original by the page-wide fallback
  // script (src/lib/images/fallback.ts), which runs before this handler. That first error is the
  // resized copy's, not the photo's — only a second one means the photo itself is gone.
  const originalTried = useRef(false);
  const photo = responsiveImage(attractionImageSrc(url), PHOTO_CARD);
  if (failed) {
    return (
      <span aria-hidden className="absolute inset-0 grid place-items-center text-5xl opacity-90">
        {emoji}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...photo}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (photo['data-src-original'] && !originalTried.current) {
          originalTried.current = true;
          return;
        }
        setFailed(true);
      }}
      className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
    />
  );
}
