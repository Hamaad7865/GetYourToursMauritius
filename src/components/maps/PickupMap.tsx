'use client';

import { useEffect, useRef } from 'react';
import { useGoogleMaps } from '@/lib/maps/useGoogleMaps';

/* Belle Mare, east-coast Mauritius — the default map centre when no pickup is chosen yet. */
const BELLE_MARE = { lat: -20.1965, lng: 57.7669 };

/**
 * Checkout pickup picker: a Mauritius map with a draggable pin plus a Places-autocomplete
 * address input (restricted to Mauritius). Selecting a place or dragging the pin reports the
 * chosen location back via `onChange`. If the Maps JS API can't load (no key / billing), the
 * map is hidden and the plain text input still works, so checkout never breaks.
 */
export function PickupMap({
  value,
  onChange,
  onCoords,
  placeholder = 'Hotel name or address',
}: {
  value: string;
  onChange: (address: string) => void;
  /** Reports the chosen coordinates (place selected / pin dragged / map clicked), or null when the user
   *  edits the address text freely (no resolved point). Optional — checkout's plain pickup ignores it. */
  onCoords?: (coords: { lat: number; lng: number } | null) => void;
  placeholder?: string;
}) {
  const status = useGoogleMaps();
  const inputRef = useRef<HTMLInputElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  // Keep the latest callbacks without re-running the map-setup effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCoordsRef = useRef(onCoords);
  onCoordsRef.current = onCoords;

  useEffect(() => {
    if (status !== 'ready' || !mapElRef.current || !inputRef.current) return;

    const map = new google.maps.Map(mapElRef.current, {
      center: BELLE_MARE,
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });
    mapRef.current = map;

    const marker = new google.maps.Marker({
      map,
      position: BELLE_MARE,
      draggable: true,
      title: 'Pickup location',
    });
    markerRef.current = marker;

    const place = (pos: google.maps.LatLngLiteral, zoom = 15) => {
      marker.setPosition(pos);
      map.panTo(pos);
      if (zoom) map.setZoom(zoom);
    };

    // Address autocomplete is a separate API (Places). Wrap it so the map + draggable pin keep
    // working even if Places isn't enabled — the traveller can still drag the pin or type freely.
    let autocomplete: google.maps.places.Autocomplete | null = null;
    try {
      autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'mu' },
        fields: ['formatted_address', 'name', 'geometry'],
      });
      autocomplete.bindTo('bounds', map);
      autocomplete.addListener('place_changed', () => {
        const p = autocomplete!.getPlace();
        if (p.geometry?.location) {
          const lat = p.geometry.location.lat();
          const lng = p.geometry.location.lng();
          place({ lat, lng });
          onCoordsRef.current?.({ lat, lng });
        }
        onChangeRef.current(p.formatted_address ?? p.name ?? inputRef.current?.value ?? '');
      });
    } catch {
      autocomplete = null;
    }

    // Dragging the pin reports its coordinates (the typed address text is kept as-is).
    marker.addListener('dragend', () => {
      const pos = marker.getPosition();
      if (pos) {
        map.panTo(pos);
        onCoordsRef.current?.({ lat: pos.lat(), lng: pos.lng() });
      }
    });

    // Click on the map to move the pin too.
    map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) {
        place({ lat: e.latLng.lat(), lng: e.latLng.lng() }, 0);
        onCoordsRef.current?.({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      }
    });

    return () => {
      if (autocomplete) google.maps.event.clearInstanceListeners(autocomplete);
      google.maps.event.clearInstanceListeners(marker);
      google.maps.event.clearInstanceListeners(map);
      marker.setMap(null);
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [status]);

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // Free-typed text isn't a resolved point — drop any prior coords so a stale lat/lng
          // (from an earlier pin/selection) can't price a different address.
          onCoords?.(null);
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
      />
      {status === 'ready' && (
        <div
          ref={mapElRef}
          className="mt-2 h-[220px] w-full overflow-hidden rounded-xl border border-ink/10"
        />
      )}
      {status === 'ready' && (
        <p className="mt-1.5 text-[12px] text-ink-muted">
          Search for your hotel or drag the pin to mark your pickup point.
        </p>
      )}
    </div>
  );
}
