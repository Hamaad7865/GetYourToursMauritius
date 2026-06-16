'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import { useGoogleMaps } from '@/lib/maps/useGoogleMaps';
import { geocode } from '@/lib/maps/geocode';
import { mapsDirectionsUrl } from '@/lib/maps/urls';
import { MapLinkCard } from './MapLinkCard';
import { carIcon, pinIcon, pinLabel } from './pin';

async function resolveStop(s: ItineraryStop): Promise<google.maps.LatLngLiteral | null> {
  if (typeof s.lat === 'number' && typeof s.lng === 'number') return { lat: s.lat, lng: s.lng };
  return geocode(s.title);
}

/* Once the Directions API answers "not enabled / denied" for this key, stop calling it for the rest
 * of the session — every retry just re-spams the console. The straight-line fallback takes over. */
let directionsDenied = false;

/**
 * Itinerary route map. Draws the real DRIVING route along the roads (Google Directions) with numbered
 * brand pins, and — when `animate` — a car marker that drives the route on a loop (rAF, reduced-motion
 * aware). Falls back to a dashed straight-line route, then to a keyless Google Maps link, so it
 * degrades but never breaks. Re-renders when `stops` change.
 */
export function RouteMap({ stops, animate = false }: { stops: ItineraryStop[]; animate?: boolean }) {
  const status = useGoogleMaps();
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const rafRef = useRef<number | null>(null);

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

      // The path the car drives: the real road route if Directions is available, else straight lines.
      let path: google.maps.LatLngLiteral[] = points;
      let drewRoute = false;
      if (points.length >= 2 && !directionsDenied) {
        try {
          const ds = new google.maps.DirectionsService();
          const res = await ds.route({
            origin: points[0]!,
            destination: points[points.length - 1]!,
            waypoints: points.slice(1, -1).map((location) => ({ location, stopover: true })),
            travelMode: google.maps.TravelMode.DRIVING,
          });
          if (cancelled) return;
          const route = res.routes[0];
          if (route) {
            new google.maps.DirectionsRenderer({
              map,
              directions: res,
              suppressMarkers: true,
              preserveViewport: true,
              polylineOptions: { strokeColor: '#0E8C92', strokeWeight: 4, strokeOpacity: 0.9 },
            });
            path = route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
            drewRoute = true;
          }
        } catch (err: unknown) {
          // "not enabled / denied" is permanent for this key → stop retrying it this session.
          const code = (err as { code?: string })?.code ?? String(err);
          if (/denied|not.*activated|not.*enabled/i.test(code)) directionsDenied = true;
        }
      }
      if (!drewRoute) {
        if (cancelled) return;
        // Directions unavailable → dashed straight-line fallback.
        new google.maps.Polyline({
          map,
          path: points,
          geodesic: true,
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, scale: 3, strokeColor: '#0E8C92' },
              offset: '0',
              repeat: '12px',
            },
          ],
        });
        path = points;
      }

      // The car: static at the start, or animated along the path on a loop.
      const car = new google.maps.Marker({ map, position: path[0]!, icon: carIcon(), zIndex: 1000 });
      const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (animate && !reduce && path.length > 1) {
        const STEP_MS = 90; // advance one path point every ~90ms
        let i = 0;
        let last = 0;
        const tick = (t: number) => {
          if (cancelled) return;
          if (t - last >= STEP_MS) {
            i = (i + 1) % path.length;
            car.setPosition(path[i]!);
            last = t;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [status, stops, animate]);

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
