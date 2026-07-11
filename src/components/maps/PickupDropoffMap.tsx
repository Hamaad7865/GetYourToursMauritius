'use client';

import { useEffect, useRef } from 'react';
import { useGoogleMaps, MAP_ID } from '@/lib/maps/useGoogleMaps';
import { pinElement, toLatLng } from './pin';

/* Belle Mare, east-coast Mauritius — the default map centre when no pickup is chosen yet. */
const BELLE_MARE = { lat: -20.1965, lng: 57.7669 };

/* Brand colours for the two markers so pickup and drop-off read as distinct. */
const PICKUP_COLOR = '#FF5A5F'; // coral — the pickup "P"
const DROPOFF_COLOR = '#0E8C92'; // teal — the drop-off "D"

/**
 * Checkout pickup + drop-off picker on ONE map. A coral "P" marker (+ Places-autocomplete input,
 * restricted to Mauritius) is the pickup. When `showDropoff` is true, a second teal "D" marker
 * (+ its own autocomplete input) is the drop-off, and the map fits its bounds to show both pins.
 * Both markers are draggable; clicking the map moves whichever marker is "active" — pickup when
 * drop-off is hidden, otherwise the last marker the user dragged (defaulting to drop-off so a
 * fresh drop-off is easy to drop). If the Maps JS API can't load, the plain text inputs still
 * work, so checkout never breaks.
 */
export function PickupDropoffMap({
  pickupValue,
  onPickupChange,
  onPickupCoords,
  showDropoff,
  dropoffValue,
  onDropoffChange,
  onDropoffCoords,
  pickupPlaceholder = 'Hotel name or address',
  dropoffPlaceholder = 'Drop-off address',
  pickupDescribedBy,
}: {
  pickupValue: string;
  onPickupChange: (address: string) => void;
  onPickupCoords: (coords: { lat: number; lng: number } | null) => void;
  showDropoff: boolean;
  dropoffValue: string;
  onDropoffChange: (address: string) => void;
  onDropoffCoords: (coords: { lat: number; lng: number } | null) => void;
  pickupPlaceholder?: string;
  dropoffPlaceholder?: string;
  // The id of an external hint (e.g. the disabled-CTA gate hint) describing the pickup input — so a
  // screen-reader user hears why this required field matters. Optional; omit to leave it undescribed.
  pickupDescribedBy?: string;
}) {
  const status = useGoogleMaps();
  const pickupInputRef = useRef<HTMLInputElement>(null);
  const dropoffInputRef = useRef<HTMLInputElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const dropoffMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  // Whether the drop-off marker is currently shown — read inside the map's click handler (which is
  // bound once) so a click moves the right marker without re-running the setup effect.
  const showDropoffRef = useRef(showDropoff);
  // Which marker a map-click should move: 'pickup' when drop-off is hidden, else 'dropoff'.
  const clickTargetRef = useRef<'pickup' | 'dropoff'>('pickup');
  // Keep the latest callbacks without re-running the map-setup effect.
  const onPickupChangeRef = useRef(onPickupChange);
  onPickupChangeRef.current = onPickupChange;
  const onPickupCoordsRef = useRef(onPickupCoords);
  onPickupCoordsRef.current = onPickupCoords;
  const onDropoffChangeRef = useRef(onDropoffChange);
  onDropoffChangeRef.current = onDropoffChange;
  const onDropoffCoordsRef = useRef(onDropoffCoords);
  onDropoffCoordsRef.current = onDropoffCoords;
  // Holds the live fitToMarkers + drop-off autocomplete from the setup effect, so the toggle effect
  // can drive bounds-fit and (re)bind the drop-off input when it mounts/unmounts.
  const fitRef = useRef<(() => void) | null>(null);
  const dropoffAcRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Build the map + pickup marker once Maps is ready. The drop-off marker is created lazily here
  // too but only attached to the map (and bounds-fitted) when `showDropoff` is on — see the second
  // effect below, which reacts to the toggle.
  useEffect(() => {
    if (status !== 'ready' || !mapElRef.current || !pickupInputRef.current) return;

    const map = new google.maps.Map(mapElRef.current, {
      center: BELLE_MARE,
      zoom: 11,
      mapId: MAP_ID,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });
    mapRef.current = map;

    const pickupMarker = new google.maps.marker.AdvancedMarkerElement({
      map,
      position: BELLE_MARE,
      gmpDraggable: true,
      title: 'Pickup location',
      content: pinElement({ color: PICKUP_COLOR, glyph: 'P' }),
    });
    pickupMarkerRef.current = pickupMarker;

    // The drop-off marker is created up front but kept OFF the map until the toggle reveals it.
    const dropoffMarker = new google.maps.marker.AdvancedMarkerElement({
      map: null,
      position: BELLE_MARE,
      gmpDraggable: true,
      title: 'Drop-off location',
      content: pinElement({ color: DROPOFF_COLOR, glyph: 'D' }),
    });
    dropoffMarkerRef.current = dropoffMarker;

    const moveMarker = (
      marker: google.maps.marker.AdvancedMarkerElement,
      pos: google.maps.LatLngLiteral,
      zoom = 15,
    ) => {
      marker.position = pos;
      map.panTo(pos);
      if (zoom) map.setZoom(zoom);
    };

    // Wire a Places autocomplete onto an input. Wrapped so the map + draggable pins keep working
    // even if Places isn't enabled — the traveller can still drag a pin or type freely.
    const bindAutocomplete = (
      input: HTMLInputElement,
      marker: google.maps.marker.AdvancedMarkerElement,
      onChangeRef: React.MutableRefObject<(s: string) => void>,
      onCoordsRef: React.MutableRefObject<(c: { lat: number; lng: number } | null) => void>,
    ): google.maps.places.Autocomplete | null => {
      try {
        const ac = new google.maps.places.Autocomplete(input, {
          componentRestrictions: { country: 'mu' },
          fields: ['formatted_address', 'name', 'geometry'],
        });
        ac.bindTo('bounds', map);
        ac.addListener('place_changed', () => {
          const p = ac.getPlace();
          if (p.geometry?.location) {
            const lat = p.geometry.location.lat();
            const lng = p.geometry.location.lng();
            marker.map = map;
            moveMarker(marker, { lat, lng });
            onCoordsRef.current?.({ lat, lng });
            fitToMarkers();
          }
          onChangeRef.current(p.formatted_address ?? p.name ?? input.value ?? '');
        });
        return ac;
      } catch {
        return null;
      }
    };

    // Fit the map to whichever markers are on it: both when drop-off is shown and placed, else
    // just centre on the pickup.
    const fitToMarkers = () => {
      const positions: google.maps.LatLngLiteral[] = [];
      const pp = toLatLng(pickupMarker.position);
      if (pp) positions.push(pp);
      if (showDropoffRef.current && dropoffMarker.map) {
        const dp = toLatLng(dropoffMarker.position);
        if (dp) positions.push(dp);
      }
      if (positions.length >= 2) {
        const bounds = new google.maps.LatLngBounds();
        positions.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 64);
      } else if (positions.length === 1) {
        map.panTo(positions[0]!);
      }
    };

    const pickupAc = bindAutocomplete(
      pickupInputRef.current,
      pickupMarker,
      onPickupChangeRef as React.MutableRefObject<(s: string) => void>,
      onPickupCoordsRef as React.MutableRefObject<(c: { lat: number; lng: number } | null) => void>,
    );
    // The drop-off input only exists in the DOM when showDropoff is on; bind if present.
    let dropoffAc: google.maps.places.Autocomplete | null = null;
    if (dropoffInputRef.current) {
      dropoffAc = bindAutocomplete(
        dropoffInputRef.current,
        dropoffMarker,
        onDropoffChangeRef as React.MutableRefObject<(s: string) => void>,
        onDropoffCoordsRef as React.MutableRefObject<
          (c: { lat: number; lng: number } | null) => void
        >,
      );
    }
    // Stash the drop-off autocomplete so the toggle effect can (re)bind it when the input appears.
    dropoffAcRef.current = dropoffAc;

    // Dragging a pin reports its coordinates (the typed address text is kept as-is).
    pickupMarker.addListener('dragend', () => {
      const pos = toLatLng(pickupMarker.position);
      if (pos) {
        clickTargetRef.current = 'pickup';
        onPickupCoordsRef.current?.(pos);
        fitToMarkers();
      }
    });
    dropoffMarker.addListener('dragend', () => {
      const pos = toLatLng(dropoffMarker.position);
      if (pos) {
        clickTargetRef.current = 'dropoff';
        onDropoffCoordsRef.current?.(pos);
        fitToMarkers();
      }
    });

    // Click the map to move the active marker (pickup when drop-off hidden, else the drop-off so a
    // fresh drop-off pin is easy to place). It's placed onto the map if it wasn't visible yet.
    map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const target = showDropoffRef.current ? clickTargetRef.current : 'pickup';
      if (target === 'dropoff') {
        dropoffMarker.map = map;
        dropoffMarker.position = pos;
        onDropoffCoordsRef.current?.(pos);
      } else {
        pickupMarker.position = pos;
        onPickupCoordsRef.current?.(pos);
      }
      fitToMarkers();
    });

    // Expose fitToMarkers to the toggle effect.
    fitRef.current = fitToMarkers;

    return () => {
      if (pickupAc) google.maps.event.clearInstanceListeners(pickupAc);
      if (dropoffAcRef.current) google.maps.event.clearInstanceListeners(dropoffAcRef.current);
      google.maps.event.clearInstanceListeners(pickupMarker);
      google.maps.event.clearInstanceListeners(dropoffMarker);
      google.maps.event.clearInstanceListeners(map);
      pickupMarker.map = null;
      dropoffMarker.map = null;
      mapRef.current = null;
      pickupMarkerRef.current = null;
      dropoffMarkerRef.current = null;
      fitRef.current = null;
      dropoffAcRef.current = null;
    };
  }, [status]);

  // React to the showDropoff toggle: reveal/hide the drop-off marker, bind its input's autocomplete
  // the first time the input mounts, and refit the map bounds.
  useEffect(() => {
    showDropoffRef.current = showDropoff;
    const map = mapRef.current;
    const dropoffMarker = dropoffMarkerRef.current;
    if (!map || !dropoffMarker) return;

    if (showDropoff) {
      // Default a fresh map-click to drop the drop-off pin (the pickup is usually already set).
      clickTargetRef.current = 'dropoff';
      // Bind the drop-off autocomplete now that the input exists (only if not already bound).
      if (dropoffInputRef.current && !dropoffAcRef.current) {
        try {
          const ac = new google.maps.places.Autocomplete(dropoffInputRef.current, {
            componentRestrictions: { country: 'mu' },
            fields: ['formatted_address', 'name', 'geometry'],
          });
          ac.bindTo('bounds', map);
          ac.addListener('place_changed', () => {
            const p = ac.getPlace();
            if (p.geometry?.location) {
              const lat = p.geometry.location.lat();
              const lng = p.geometry.location.lng();
              dropoffMarker.map = map;
              dropoffMarker.position = { lat, lng };
              map.panTo({ lat, lng });
              onDropoffCoordsRef.current?.({ lat, lng });
              fitRef.current?.();
            }
            onDropoffChangeRef.current(
              p.formatted_address ?? p.name ?? dropoffInputRef.current?.value ?? '',
            );
          });
          dropoffAcRef.current = ac;
        } catch {
          dropoffAcRef.current = null;
        }
      }
      // Show the drop-off pin: reuse any saved drop-off position, else seed it near the pickup so
      // it's visible and draggable.
      if (!dropoffMarker.map) {
        const pickupPos = toLatLng(pickupMarkerRef.current?.position);
        if (pickupPos && !toLatLng(dropoffMarker.position)) {
          dropoffMarker.position = pickupPos;
        }
        dropoffMarker.map = map;
      }
      fitRef.current?.();
    } else {
      // Hide the drop-off marker and re-centre on the pickup. The drop-off autocomplete listener is
      // detached so a stale ref can't fire against an unmounted input.
      clickTargetRef.current = 'pickup';
      if (dropoffAcRef.current) {
        google.maps.event.clearInstanceListeners(dropoffAcRef.current);
        dropoffAcRef.current = null;
      }
      dropoffMarker.map = null;
      fitRef.current?.();
    }
  }, [showDropoff, status]);

  return (
    <div className="mt-2">
      <input
        ref={pickupInputRef}
        value={pickupValue}
        onChange={(e) => {
          onPickupChange(e.target.value);
          // Free-typed text isn't a resolved point — drop any prior coords so a stale lat/lng
          // (from an earlier pin/selection) can't price a different address.
          onPickupCoords(null);
        }}
        // The placeholder is only a hint and isn't an accessible name; name the input so a
        // screen-reader user knows this required field is the pickup address. autoComplete off
        // so browser autofill doesn't collide with the Google Places suggestion dropdown.
        aria-label={pickupPlaceholder}
        aria-describedby={pickupDescribedBy}
        autoComplete="off"
        placeholder={pickupPlaceholder}
        className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
      />

      {status === 'ready' && (
        <div
          ref={mapElRef}
          className="mt-2 h-[240px] w-full overflow-hidden rounded-xl border border-ink/10"
        />
      )}

      {showDropoff && (
        <input
          ref={dropoffInputRef}
          value={dropoffValue}
          onChange={(e) => {
            onDropoffChange(e.target.value);
            onDropoffCoords(null);
          }}
          // Name the drop-off input for the same reason as the pickup input above.
          aria-label={dropoffPlaceholder}
          autoComplete="off"
          placeholder={dropoffPlaceholder}
          className="mt-2 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
        />
      )}

      {status === 'ready' && (
        <p className="mt-1.5 text-[12px] text-ink-muted">
          {showDropoff
            ? 'Search or drag the coral “P” for pickup and the teal “D” for drop-off.'
            : 'Search for your hotel or drag the pin to mark your pickup point.'}
        </p>
      )}
    </div>
  );
}
