'use client';

import { useEffect, useState } from 'react';
import { osmReverseName } from '@/lib/maps/osm-reverse';

/** "Pinned location (-20.20856, 57.78972)" — what a dropped pin was saved as while Google refused
 *  (an unpaid bill, Nov 2026). Returns the coordinates, or null for an ordinary pickup text. */
export function parsePinnedLocation(text: string): { lat: number; lng: number } | null {
  const m = text.match(/^\s*Pinned location \((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)\s*$/i);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** One lookup per pin per page session, however many rows show it. */
const names = new Map<string, Promise<string | null>>();

/**
 * A pickup as staff read it. Ordinary text prints as stored. A bare "Pinned location (lat, lng)" is
 * named from OpenStreetMap at display time (bookings saved before the fix still hold the raw
 * coordinates) and carries a map link, so the team and the driver see "Radisson, Belle Mare" instead
 * of numbers. Nothing is written back: the stored value stays what the customer chose.
 */
export function PickupText({ text }: { text: string }) {
  const pin = parsePinnedLocation(text);
  const key = pin ? `${pin.lat},${pin.lng}` : '';
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!pin) return;
    let live = true;
    if (!names.has(key)) names.set(key, osmReverseName(pin.lat, pin.lng));
    void names.get(key)!.then((n) => {
      if (live) setName(n);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the pin
  }, [key]);

  if (!pin) return <>{text}</>;
  return (
    <>
      {name ?? text}
      <span className="mt-0.5 block text-[12px] text-ink-muted">
        {name ? 'From the customer’s map pin · ' : ''}
        <a
          href={`https://www.google.com/maps?q=${pin.lat},${pin.lng}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-teal-dark underline"
        >
          Open the pin in Maps
        </a>
      </span>
    </>
  );
}
