'use client';

import { useState } from 'react';
import { attractionImageSrc } from '@/lib/content/attractions';

/**
 * An attraction photo that degrades gracefully: it loads the (cached, proxied) image, and if that ever
 * fails — link-rot, an un-mapped slug, a transient error — it swaps to the branded category emoji over
 * the gradient instead of a broken-image icon.
 */
export function AttractionImage({ url, alt, emoji }: { url: string; alt: string; emoji: string }) {
  const [failed, setFailed] = useState(false);
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
      src={attractionImageSrc(url)}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
    />
  );
}
