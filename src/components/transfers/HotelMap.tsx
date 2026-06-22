'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useGoogleMaps, MAP_ID } from '@/lib/maps/useGoogleMaps';
import { pinElement } from '@/components/maps/pin';
import { drawRoute } from '@/components/maps/draw-route';
import { transfers, type Transfer } from '@/lib/content/transfers';
import { Price } from '@/components/site/Price';
import { SSR_AIRPORT } from './TransferRouteMap';

/** Region pin colours — distinct but on-brand, so travellers can scan the coasts. */
const REGION_COLOR: Record<string, string> = {
  North: '#0E8C92',
  East: '#1D6FB8',
  South: '#D98324',
  West: '#B4532A',
  Central: '#6B7280',
};

/** Every hotel that has coordinates (geocoded into _transfers.gen.ts). */
const PINNED: Array<Transfer & { lat: number; lng: number }> = transfers.filter(
  (t): t is Transfer & { lat: number; lng: number } => typeof t.lat === 'number' && typeof t.lng === 'number',
);

/**
 * Interactive all-hotels map for /airport-transfers: every resort is pinned (coloured by coast), and
 * selecting one draws the real SSR Airport → hotel driving route and shows a card with the price + a
 * link to book. Degrades silently to the region list already on the page if Maps can't load.
 */
export function HotelMap() {
  const status = useGoogleMaps();
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const lineRef = useRef<google.maps.Polyline[]>([]);
  const [selected, setSelected] = useState<(Transfer & { lat: number; lng: number }) | null>(null);

  useEffect(() => {
    if (status !== 'ready' || !elRef.current || PINNED.length === 0) return;
    let cancelled = false;

    const map =
      mapRef.current ??
      (mapRef.current = new google.maps.Map(elRef.current, {
        mapId: MAP_ID,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      }));

    const bounds = new google.maps.LatLngBounds();

    // Airport (fixed origin).
    new google.maps.marker.AdvancedMarkerElement({
      map,
      position: { lat: SSR_AIRPORT.lat, lng: SSR_AIRPORT.lng },
      content: pinElement({ color: '#F76C5E', glyph: 'A' }),
      title: SSR_AIRPORT.title,
      zIndex: 1000,
    });
    bounds.extend({ lat: SSR_AIRPORT.lat, lng: SSR_AIRPORT.lng });

    async function select(hotel: Transfer & { lat: number; lng: number }) {
      setSelected(hotel);
      lineRef.current.forEach((pl) => pl.setMap(null));
      lineRef.current = [];
      const rbounds = new google.maps.LatLngBounds();
      rbounds.extend({ lat: SSR_AIRPORT.lat, lng: SSR_AIRPORT.lng });
      rbounds.extend({ lat: hotel.lat, lng: hotel.lng });
      map.fitBounds(rbounds, 64);
      try {
        const drawn = await drawRoute(
          map,
          [
            { lat: SSR_AIRPORT.lat, lng: SSR_AIRPORT.lng },
            { lat: hotel.lat, lng: hotel.lng },
          ],
          { strokeColor: REGION_COLOR[hotel.region] ?? '#0E8C92' },
        );
        if (cancelled) {
          drawn?.polylines.forEach((pl) => pl.setMap(null));
          return;
        }
        if (drawn) lineRef.current = drawn.polylines;
      } catch {
        /* Routes unavailable — the straight bounds + card still convey the trip */
      }
    }

    for (const hotel of PINNED) {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: hotel.lat, lng: hotel.lng },
        content: pinElement({ color: REGION_COLOR[hotel.region] ?? '#0E8C92', glyph: ' ' }),
        title: hotel.hotelName,
        gmpClickable: true,
      });
      marker.addListener('gmp-click', () => void select(hotel));
      bounds.extend({ lat: hotel.lat, lng: hotel.lng });
    }

    map.fitBounds(bounds, 48);

    return () => {
      cancelled = true;
      lineRef.current.forEach((pl) => pl.setMap(null));
      lineRef.current = [];
    };
  }, [status]);

  // Maps failed to load — the page already lists every hotel by region, so render nothing.
  if (status === 'error' || PINNED.length === 0) return null;

  return (
    <div className="relative">
      <div
        ref={elRef}
        className="h-[420px] w-full overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.04] lg:h-[520px]"
      />
      {/* Region legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink/70">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#F76C5E' }} /> SSR Airport
        </span>
        {Object.entries(REGION_COLOR)
          .filter(([region]) => PINNED.some((h) => h.region === region))
          .map(([region, color]) => (
            <span key={region} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {region}
            </span>
          ))}
      </div>

      {/* Selected-hotel card */}
      {selected && (
        <div className="pointer-events-auto absolute left-3 top-3 w-[min(20rem,calc(100%-1.5rem))] rounded-2xl border border-ink/10 bg-white/95 p-4 shadow-lg backdrop-blur">
          <div className="text-[11px] font-bold uppercase tracking-wide text-teal">{selected.area}</div>
          <h3 className="mt-0.5 text-[16px] font-extrabold leading-snug text-ink">{selected.hotelName}</h3>
          <div className="mt-2 flex items-center gap-3 text-[12.5px] text-ink/70">
            <span>~{selected.durationMinFromAirport} min</span>
            <span>·</span>
            <span>~{selected.distanceKmFromAirport} km</span>
            <span>·</span>
            <span className="font-bold text-ink">
              from <Price eur={selected.fromPriceEur} />
            </span>
          </div>
          <Link
            href={selected.path}
            className="mt-3 inline-flex items-center justify-center rounded-full bg-teal-dark px-4 py-2 text-[13px] font-bold text-white hover:bg-teal-dark/90"
          >
            Book this transfer →
          </Link>
        </div>
      )}
    </div>
  );
}
