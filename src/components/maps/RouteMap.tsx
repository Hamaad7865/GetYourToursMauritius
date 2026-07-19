'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import { useGoogleMaps, MAP_ID } from '@/lib/maps/useGoogleMaps';
import { geocode } from '@/lib/maps/geocode';
import { mapsDirectionsUrl } from '@/lib/maps/urls';
import { MapLinkCard } from './MapLinkCard';
import { bmtMarkerContent, carContent, dinnerMarkerContent, pinElement } from './pin';

/** Marker role per stop: the start/pickup (coral), a fixed main stop (solid teal), or a swappable
 *  "other" stop (hollow teal). */
export type StopKind = 'start' | 'main' | 'other';

/** A Belle Mare Tours activity rendered as a branded pill marker. `selected` = recommended for the
 *  day on screen (filled coral, joins the map bounds); unselected = the browse layer (white pill,
 *  never affects bounds so browsing can't yank the camera off the route). */
export interface ActivityMarker {
  slug: string;
  title: string;
  lat: number;
  lng: number;
  priceLabel: string;
  selected: boolean;
}

async function resolveStop(s: ItineraryStop): Promise<google.maps.LatLngLiteral | null> {
  if (typeof s.lat === 'number' && typeof s.lng === 'number') return { lat: s.lat, lng: s.lng };
  return geocode(s.title);
}

/** Evenly-spaced points from `a` (exclusive) to `b` (inclusive). */
function samplePath(
  a: google.maps.LatLngLiteral,
  b: google.maps.LatLngLiteral,
  n: number,
): google.maps.LatLngLiteral[] {
  const out: google.maps.LatLngLiteral[] = [];
  for (let k = 1; k <= n; k += 1) {
    const t = k / n;
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return out;
}

/** Resample a polyline into ~`targetPoints` evenly-spaced points, so the car glides at a constant,
 *  gentle speed and a full loop takes roughly the same time regardless of how long the route is. */
function buildDrivePath(
  poly: google.maps.LatLngLiteral[],
  targetPoints: number,
): google.maps.LatLngLiteral[] {
  if (poly.length < 2) return poly;
  let total = 0;
  for (let i = 0; i < poly.length - 1; i += 1) {
    total += Math.hypot(poly[i + 1]!.lat - poly[i]!.lat, poly[i + 1]!.lng - poly[i]!.lng);
  }
  const step = total > 0 ? total / targetPoints : 0;
  const out: google.maps.LatLngLiteral[] = [poly[0]!];
  for (let i = 0; i < poly.length - 1; i += 1) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const d = Math.hypot(b.lat - a.lat, b.lng - a.lng);
    out.push(...samplePath(a, b, step > 0 ? Math.max(1, Math.round(d / step)) : 1));
  }
  return out;
}

/* Once the Directions API answers "not enabled / denied" for this key, stop calling it for the rest
 * of the session — every retry just re-spams the console. The straight-line fallback takes over. */
let directionsDenied = false;

/** Overlays added to the map: AdvancedMarkers (removed via `.map = null`) and route Polylines
 *  (removed via `setMap(null)`). */
type MapOverlay = google.maps.marker.AdvancedMarkerElement | google.maps.Polyline;
function clearOverlay(o: MapOverlay): void {
  if (o instanceof google.maps.marker.AdvancedMarkerElement) o.map = null;
  else o.setMap(null);
}

/**
 * Itinerary route map. Draws the real DRIVING route along the roads (Google Directions) with numbered
 * brand pins, and — when `animate` — a car marker that drives the route (out then back, rAF,
 * reduced-motion aware). When Directions is unavailable it degrades to clean numbered markers plus a
 * keyless "View on Google Maps" link — never a dashed line. If the map itself can't load, it falls
 * back to the link card. The map is created ONCE and only its overlays are redrawn when `stops`
 * change, so editing a route in the builder doesn't leak a fresh Map per edit.
 */
export function RouteMap({
  stops,
  kinds,
  labels,
  animate = false,
  carColor = '#0E8C92',
  className,
  activities,
  onActivityClick,
  dinner,
}: {
  stops: ItineraryStop[];
  /** Marker role per stop (aligned to `stops`). Defaults to start (index 0) + main (rest). */
  kinds?: StopKind[];
  /** Per-marker label override (aligned to `stops`). Defaults to the 1-based index. Use this to
   *  label pickup/drop-off endpoints with a glyph (e.g. "P"/"D") while stops stay numbered. */
  labels?: Array<string | number>;
  animate?: boolean;
  /** Colour of the animated car marker (default brand teal). */
  carColor?: string;
  /** Override the container classes (e.g. to fill a parent pane instead of the default fixed height). */
  className?: string;
  /** Belle Mare Tours activities as branded pill markers (recommended + browse layer). Memoize —
   *  a new array identity redraws the overlays. */
  activities?: ActivityMarker[];
  onActivityClick?: (slug: string) => void;
  /** The active day's dinner suggestion — its own fork marker, not part of the route. */
  dinner?: { title: string; lat: number; lng: number } | null;
}) {
  const status = useGoogleMaps();
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<MapOverlay[]>([]);
  const rafRef = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  // Map tiles render fine but Directions is unavailable: keep the numbered markers, draw NO line, and
  // surface a keyless "View on Google Maps" link beneath the map (never a dashed line).
  const [noRoute, setNoRoute] = useState(false);
  // Latest click handler behind a ref so a new callback identity doesn't force a full overlay redraw.
  const onActivityClickRef = useRef(onActivityClick);
  onActivityClickRef.current = onActivityClick;

  useEffect(() => {
    if (status !== 'ready' || !elRef.current || stops.length === 0) return;
    let cancelled = false;

    // Create the map once; reuse it across stops edits (so we don't orphan a Map + listeners per edit).
    const map =
      mapRef.current ??
      (mapRef.current = new google.maps.Map(elRef.current, {
        mapId: MAP_ID,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      }));

    // Tear down the previous render's overlays + animation before redrawing.
    overlaysRef.current.forEach(clearOverlay);
    overlaysRef.current = [];
    setNoRoute(false);
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
      ).filter(
        (r): r is { pos: google.maps.LatLngLiteral; kind: StopKind; title: string } => r !== null,
      );
      if (cancelled || !mapRef.current) return;
      if (resolved.length === 0) {
        setFailed(true);
        return;
      }
      const points = resolved.map((r) => r.pos);

      const bounds = new google.maps.LatLngBounds();
      resolved.forEach(({ pos, kind, title }, i) => {
        const hollow = kind === 'other';
        const color = kind === 'start' ? '#F76C5E' : '#0E8C92';
        track(
          new google.maps.marker.AdvancedMarkerElement({
            map,
            position: pos,
            content: pinElement({ color, hollow, glyph: labels?.[i] ?? i + 1 }),
            title,
          }),
        );
        bounds.extend(pos);
      });
      // Belle Mare Tours activity pills + the dinner fork. Selected activities and the dinner join
      // the bounds (they're part of the day); the browse layer never moves the camera.
      for (const a of activities ?? []) {
        const marker = track(
          new google.maps.marker.AdvancedMarkerElement({
            map,
            position: { lat: a.lat, lng: a.lng },
            content: bmtMarkerContent({ priceLabel: a.priceLabel, selected: a.selected }),
            title: a.title,
            gmpClickable: true,
            zIndex: a.selected ? 900 : 500,
          }),
        );
        // AdvancedMarkerElement is a DOM element; 'gmp-click' is its click event (plain 'click' via
        // addListener is deprecated and warns in console).
        marker.addEventListener('gmp-click', () => onActivityClickRef.current?.(a.slug));
        if (a.selected) bounds.extend({ lat: a.lat, lng: a.lng });
      }
      if (dinner) {
        track(
          new google.maps.marker.AdvancedMarkerElement({
            map,
            position: { lat: dinner.lat, lng: dinner.lng },
            content: dinnerMarkerContent(),
            title: dinner.title,
          }),
        );
        bounds.extend({ lat: dinner.lat, lng: dinner.lng });
      }

      const extraBoundPoints =
        (activities?.filter((a) => a.selected).length ?? 0) + (dinner ? 1 : 0);
      if (points.length === 1 && extraBoundPoints === 0) {
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
          // Routes API (the successor to the deprecated DirectionsService). We request only `path`
          // (the polyline points) and render it ourselves with createPolylines (real Polylines, not
          // the deprecated DirectionsRenderer). Intermediate stops are non-`via` waypoints.
          const { routes: computed } = await google.maps.routes.Route.computeRoutes({
            origin: points[0]!,
            destination: points[points.length - 1]!,
            intermediates: points.slice(1, -1).map((location) => ({ location })),
            travelMode: google.maps.TravelMode.DRIVING,
            fields: ['path'],
          });
          if (cancelled) return;
          const route = computed?.[0];
          if (route?.path?.length) {
            route
              .createPolylines({
                polylineOptions: { strokeColor: '#0E8C92', strokeWeight: 4, strokeOpacity: 0.9 },
              })
              .forEach((pl) => {
                pl.setMap(map);
                track(pl);
              });
            // LatLngAltitude exposes lat/lng as number getters (not methods).
            path = route.path.map((p) => ({ lat: p.lat, lng: p.lng }));
            drewRoute = true;
          }
        } catch (err: unknown) {
          // "not enabled / denied / disabled" is permanent for this key → stop retrying it this
          // session (every retry just re-spams the console); the straight-line fallback takes over.
          const code = (err as { code?: string })?.code ?? String(err);
          if (/denied|not.*activated|not.*enabled|disabled|permission/i.test(code))
            directionsDenied = true;
        }
      }
      if (!drewRoute) {
        if (cancelled) return;
        // Directions unavailable → draw NO line. The numbered markers (already placed) stay on the
        // map, and a keyless "View on Google Maps" link is surfaced beneath it so the traveller still
        // gets the full route. We never draw a dashed line, and we skip the car (nothing to drive
        // along), so the map degrades to clean markers + link.
        setNoRoute(true);
        return;
      }

      // The car drives out along the real route, then retraces it back — a continuous animation with
      // no return line. (We never draw a dashed "return to start" leg.)
      const drivePath =
        points.length > 1 ? buildDrivePath([...path, ...[...path].reverse()], 180) : path;

      // The car: static at the start, or driving out and back along the route when animated and
      // motion is allowed.
      const car = track(
        new google.maps.marker.AdvancedMarkerElement({
          map,
          position: drivePath[0]!,
          content: carContent(carColor),
          zIndex: 1000,
        }),
      );
      const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (animate && !reduce && drivePath.length > 1) {
        const STEP_MS = 65; // advance one (closely-spaced) point every ~65ms → ~12s per loop
        let i = 0;
        let lastT = 0;
        const tick = (t: number) => {
          if (cancelled) return;
          if (t - lastT >= STEP_MS) {
            i = (i + 1) % drivePath.length;
            car.position = drivePath[i]!;
            lastT = t;
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
  }, [status, stops, kinds, labels, animate, carColor, activities, dinner]);

  // Final teardown on unmount: drop every overlay and release the map.
  useEffect(() => {
    const overlays = overlaysRef;
    const mapHolder = mapRef;
    return () => {
      overlays.current.forEach(clearOverlay);
      overlays.current = [];
      mapHolder.current = null;
    };
  }, []);

  if (stops.length === 0) return null;
  if (status === 'error' || failed) {
    return (
      <MapLinkCard href={mapsDirectionsUrl(stops.map((s) => s.title))} label="See the full route" />
    );
  }

  return (
    <>
      <div
        ref={elRef}
        // `isolate` keeps Google Maps' internal z-indexed layers from escaping above the page —
        // without it the map paints over the booking widget's date/options popovers that overhang it.
        className={`${className ?? 'h-[300px] w-full overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.04] lg:h-[360px]'} isolate`}
      />
      {/* Directions unavailable: the map shows the numbered markers; this link carries the full route.
          We never fall back to a dashed line. */}
      {noRoute && stops.length > 1 && (
        <div className="mt-2">
          <MapLinkCard
            href={mapsDirectionsUrl(stops.map((s) => s.title))}
            label="See the full route"
          />
        </div>
      )}
    </>
  );
}
