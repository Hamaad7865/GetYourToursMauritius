'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import { useGoogleMaps } from '@/lib/maps/useGoogleMaps';
import { geocode } from '@/lib/maps/geocode';
import { mapsDirectionsUrl } from '@/lib/maps/urls';
import { MapLinkCard } from './MapLinkCard';
import { pinIcon, pinLabel } from './pin';

async function resolveStop(s: ItineraryStop): Promise<google.maps.LatLngLiteral | null> {
  if (typeof s.lat === 'number' && typeof s.lng === 'number') return { lat: s.lat, lng: s.lng };
  return geocode(s.title);
}

/**
 * Itinerary route map: a numbered brand pin at every stop (coral first, ink for the rest)
 * joined by a dashed line, fit to the whole route — the GetYourGuide look, rendered with the
 * Maps JS API. Stops with stored coordinates are used directly; the rest are geocoded once.
 * Falls back to a keyless Google Maps directions link if the API isn't available.
 */
export function RouteMap({ stops }: { stops: ItineraryStop[] }) {
  const status = useGoogleMaps();
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (status !== 'ready' || !elRef.current || stops.length === 0) return;
    let cancelled = false;
    (async () => {
      const points = (await Promise.all(stops.map(resolveStop))).filter(
        (p): p is google.maps.LatLngLiteral => p !== null,
      );
      if (cancelled || !elRef.current) return;
      if (points.length === 0) {
        setFailed(true);
        return;
      }

      const map = new google.maps.Map(elRef.current, {
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });

      new google.maps.Polyline({
        map,
        path: points,
        geodesic: true,
        strokeColor: '#0E8C92',
        strokeOpacity: 0,
        icons: [
          {
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, scale: 3, strokeColor: '#0E8C92' },
            offset: '0',
            repeat: '12px',
          },
        ],
      });

      const bounds = new google.maps.LatLngBounds();
      points.forEach((pos, i) => {
        new google.maps.Marker({
          map,
          position: pos,
          icon: pinIcon(i === 0 ? '#F76C5E' : '#0A2E36'),
          label: pinLabel(i + 1),
          title: stops[i]?.title,
        });
        bounds.extend(pos);
      });

      if (points.length === 1) {
        map.setCenter(points[0]!);
        map.setZoom(13);
      } else {
        map.fitBounds(bounds, 48);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, stops]);

  if (stops.length === 0) return null;
  if (status === 'error' || failed) {
    return <MapLinkCard href={mapsDirectionsUrl(stops.map((s) => s.title))} label="See the full route" />;
  }

  return (
    <div
      ref={elRef}
      className="h-[300px] w-full overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.04] lg:h-[360px]"
    />
  );
}
