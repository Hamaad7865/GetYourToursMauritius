'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, LatLngBounds, LatLngTuple } from 'leaflet';
import type { ItineraryStop } from '@/lib/validation/tours';
import { IconArrowRight } from '@/components/ui/icons';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function pinHtml(n: number, color: string): string {
  return (
    `<div style="position:relative;width:30px;height:38px;filter:drop-shadow(0 4px 4px rgba(10,46,54,.4))">` +
    `<svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M15 0C6.7 0 0 6.7 0 15c0 9.7 15 23 15 23s15-13.3 15-23C30 6.7 23.3 0 15 0z" fill="${color}"/>` +
    `<circle cx="15" cy="15" r="11" fill="rgba(255,255,255,.18)"/></svg>` +
    `<span style="position:absolute;top:4px;left:0;width:30px;text-align:center;color:#fff;` +
    `font:700 13px 'Plus Jakarta Sans',system-ui,sans-serif">${n}</span></div>`
  );
}

/** Interactive map dropping a pin at every itinerary stop, fit to the route. Leaflet is
 *  loaded client-side only (it touches `window`), so the page stays edge-safe. */
export function RouteMap({ stops }: { stops: ItineraryStop[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const boundsRef = useRef<LatLngBounds | null>(null);

  useEffect(() => {
    let cancelled = false;
    const points = stops.filter(
      (s): s is ItineraryStop & { lat: number; lng: number } =>
        typeof s.lat === 'number' && typeof s.lng === 'number',
    );
    if (points.length === 0 || !containerRef.current) return;

    (async () => {
      const L = await import('leaflet');
      if (cancelled || !containerRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: true });
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const latlngs: LatLngTuple[] = points.map((s) => [s.lat, s.lng]);
      L.polyline(latlngs, { color: '#0E8C92', weight: 3, opacity: 0.65, dashArray: '1 8' }).addTo(map);

      points.forEach((s, i) => {
        const icon = L.divIcon({
          className: '',
          html: pinHtml(i + 1, i === 0 ? '#F76C5E' : '#0A2E36'),
          iconSize: [30, 38],
          iconAnchor: [15, 38],
          popupAnchor: [0, -34],
        });
        L.marker([s.lat, s.lng], { icon, title: s.title })
          .addTo(map)
          .bindPopup(
            `<b>${escapeHtml(s.title)}</b>${s.area ? `<br/>${escapeHtml(s.area)}` : ''}`,
          );
      });

      const bounds = L.latLngBounds(latlngs);
      boundsRef.current = bounds;
      map.fitBounds(bounds, { padding: [44, 44] });
      // The container's final size is only known after layout — recompute so the
      // correct tiles load (otherwise Leaflet requests tiles for a 0-width map).
      setTimeout(() => {
        if (!cancelled && mapRef.current) {
          mapRef.current.invalidateSize();
          mapRef.current.fitBounds(bounds, { padding: [44, 44] });
        }
      }, 300);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [stops]);

  function recenter() {
    if (mapRef.current && boundsRef.current) {
      mapRef.current.fitBounds(boundsRef.current, { padding: [44, 44] });
    }
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="z-0 h-[300px] w-full overflow-hidden rounded-2xl border border-ink/10 lg:h-[360px]"
      />
      <button
        type="button"
        onClick={recenter}
        className="absolute right-3 top-3 z-[400] flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-bold text-cream shadow-md hover:bg-teal-dark"
      >
        <IconArrowRight width={14} height={14} /> Re-center
      </button>
    </div>
  );
}
