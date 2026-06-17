'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import { useGoogleMaps } from '@/lib/maps/useGoogleMaps';
import { geocode } from '@/lib/maps/geocode';
import { mapsDirectionsUrl } from '@/lib/maps/urls';
import { MapLinkCard } from './MapLinkCard';
import { carIcon, pinIcon } from './pin';

/** Marker role per stop: the start/pickup (coral), a fixed main stop (solid teal), or a swappable
 *  "other" stop (hollow teal). */
export type StopKind = 'start' | 'main' | 'other';

async function resolveStop(s: ItineraryStop): Promise<google.maps.LatLngLiteral | null> {
  if (typeof s.lat === 'number' && typeof s.lng === 'number') return { lat: s.lat, lng: s.lng };
  return geocode(s.title);
}

/* Once the Directions API answers "not enabled / denied" for this key, stop calling it for the rest
 * of the session — every retry just re-spams the console. The straight-line fallback takes over. */
let directionsDenied = false;

/** Anything with `setMap` — markers, polylines, the directions renderer. */
type MapOverlay = { setMap: (map: google.maps.Map | null) => void };

/**
 * Itinerary route map. Draws the real DRIVING route along the roads (Google Directions) with numbered
 * brand pins, and — when `animate` — a car marker that drives the route on a loop (rAF, reduced-motion
 * aware). Falls back to a dashed straight-line route, then to a keyless Google Maps link, so it
 * degrades but never breaks. The map is created ONCE and only its overlays are redrawn when `stops`
 * change, so editing a route in the builder doesn't leak a fresh Map per edit.
 */
export function RouteMap({
  stops,
  kinds,
  animate = false,
}: {
  stops: ItineraryStop[];
  /** Marker role per stop (aligned to `stops`). Defaults to start (index 0) + main (rest). */
  kinds?: StopKind[];
  animate?: boolean;
}) {
  const status = useGoogleMaps();
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<MapOverlay[]>([]);
  const rafRef = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (status !== 'ready' || !elRef.current || stops.length === 0) return;
    let cancelled = false;

    // Create the map once; reuse it across stops edits (so we don't orphan a Map + listeners per edit).
    const map =
      mapRef.current ??
      (mapRef.current = new google.maps.Map(elRef.current, {
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      }));

    // Tear down the previous render's overlays + animation before redrawing.
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const track = <T extends MapOverlay>(o: T): T => {
      overlaysRef.current.push(o);
      return o;
    };

    (async () => {
      // Resolve point + kind + title together and drop unresolved stops as a unit, so a stop that
      // fails to geocode can't shift the kind/title of the remaining markers.
      const resolved = (
        await Promise.all(
          stops.map(async (s, idx) => {
            const pos = await resolveStop(s);
            if (!pos) return null;
            const kind: StopKind = kinds?.[idx] ?? (idx === 0 ? 'start' : 'main');
            return { pos, kind, title: s.title };
          }),
        )
      ).filter((r): r is { pos: google.maps.LatLngLiteral; kind: StopKind; title: string } => r !== null);
      if (cancelled || !mapRef.current) return;
      if (resolved.length === 0) {
        setFailed(true);
        return;
      }
      const points = resolved.map((r) => r.pos);

      const bounds = new google.maps.LatLngBounds();
      resolved.forEach(({ pos, kind, title }) => {
        const icon =
          kind === 'start'
            ? pinIcon('#F76C5E')
            : kind === 'other'
              ? pinIcon('#0E8C92', { hollow: true })
              : pinIcon('#0E8C92');
        track(new google.maps.Marker({ map, position: pos, icon, title }));
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
            track(
              new google.maps.DirectionsRenderer({
                map,
                directions: res,
                suppressMarkers: true,
                preserveViewport: true,
                polylineOptions: { strokeColor: '#0E8C92', strokeWeight: 4, strokeOpacity: 0.9 },
              }),
            );
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
        track(
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
          }),
        );
        path = points;
      }

      // The car: static at the start, or animated along the path on a loop.
      const car = track(new google.maps.Marker({ map, position: path[0]!, icon: carIcon(), zIndex: 1000 }));
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
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [status, stops, kinds, animate]);

  // Final teardown on unmount: drop every overlay and release the map.
  useEffect(() => {
    const overlays = overlaysRef;
    const mapHolder = mapRef;
    return () => {
      overlays.current.forEach((o) => o.setMap(null));
      overlays.current = [];
      mapHolder.current = null;
    };
  }, []);

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
