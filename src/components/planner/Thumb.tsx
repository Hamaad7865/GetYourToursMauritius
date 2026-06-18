'use client';

import { useState } from 'react';
import { hueFor, thumbGradient } from './planner-constants';

/** Place tile — a real Google photo when available (lazy + proxied), over a category-hued gradient
 *  that shows through while loading or if the photo is missing/broken. */
export function Thumb({
  place,
  size = 52,
}: {
  place: { id: string; name: string; category: string; imageUrl?: string | null };
  size?: number;
}) {
  const hue = hueFor(place);
  const [broken, setBroken] = useState(false);
  const showImg = Boolean(place.imageUrl) && !broken;
  return (
    <div
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-xl"
      style={{ width: size, height: size, background: thumbGradient(hue) }}
      aria-hidden
    >
      <span className="font-display font-semibold text-white/90" style={{ fontSize: size * 0.42 }}>
        {place.name[0]}
      </span>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(80% 60% at 70% 0%, rgba(255,255,255,.28), transparent)' }} />
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element -- dynamic Google photo via our proxy; next/image not suitable for many small thumbs
        <img
          src={place.imageUrl as string}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}
