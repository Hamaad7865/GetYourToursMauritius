'use client';

import { useEffect, useRef, useState } from 'react';
import { useGoogleMaps, MAP_ID } from '@/lib/maps/useGoogleMaps';
import { geocode } from '@/lib/maps/geocode';
import { mapsSearchUrl } from '@/lib/maps/urls';
import { MapLinkCard } from './MapLinkCard';
import { pinElement } from './pin';
import { IconPin } from '@/components/ui/icons';

/**
 * A Google Map dropping a single brand pin on the activity's location / meeting area. Geocodes
 * the place name with the Maps JS API; if the API isn't available (no key, not enabled, or the
 * place can't be found) it falls back to a keyless "View on Google Maps" card.
 */
export function LocationMap({ query, label }: { query: string; label?: string }) {
  const status = useGoogleMaps();
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (status !== 'ready' || !elRef.current) return;
    let cancelled = false;
    (async () => {
      const pos = await geocode(query);
      if (cancelled || !elRef.current) return;
      if (!pos) {
        setFailed(true);
        return;
      }
      const map = new google.maps.Map(elRef.current, {
        center: pos,
        zoom: 12,
        mapId: MAP_ID,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      new google.maps.marker.AdvancedMarkerElement({
        map,
        position: pos,
        content: pinElement({ color: '#F76C5E' }),
        title: label || query,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [status, query, label]);

  if (!query.trim()) return null;
  if (status === 'error' || failed) return <MapLinkCard href={mapsSearchUrl(query)} label={label || query} />;

  return (
    // `isolate` contains Google Maps' internal z-indexed layers so the map can't paint over
    // popovers (e.g. the booking date picker) that overhang it from a neighbouring column.
    <div className="isolate overflow-hidden rounded-2xl border border-ink/10">
      <div ref={elRef} className="h-[260px] w-full bg-ink/[0.04]" />
      {label && (
        <div className="flex items-center gap-2 bg-white px-4 py-3 text-[13.5px] text-ink/80">
          <IconPin width={16} height={16} className="shrink-0 text-teal" />
          <span>{label}</span>
        </div>
      )}
    </div>
  );
}
