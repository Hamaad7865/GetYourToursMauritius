/* AdvancedMarkerElement content builders + a LatLng normaliser. Called only after the Maps JS API
 * (with the `marker` library) is ready — they reference the `google` global at call time. */

/**
 * A brand-coloured map pin as AdvancedMarkerElement `content`, built with Google's PinElement.
 * `glyph` is the centred number/letter; `hollow` renders a WHITE pin with a coloured glyph + border
 * (used for swappable "other" stops, so they read as secondary against the solid "main" stops).
 */
export function pinElement(opts: {
  color: string;
  glyph?: string | number;
  hollow?: boolean;
}): HTMLElement {
  const { color, glyph, hollow = false } = opts;
  const pin = new google.maps.marker.PinElement({
    background: hollow ? '#ffffff' : color,
    borderColor: color,
    glyphColor: hollow ? color : '#ffffff',
    glyph: glyph != null ? String(glyph) : undefined,
  });
  return pin.element;
}

/**
 * A small car marker as AdvancedMarkerElement `content` (data-URI SVG <img>) for animating along the
 * route. `color` is the body + ring colour (default brand teal; the planner uses red so the moving car
 * stands out from coral pins). AdvancedMarkerElement anchors content by its bottom-centre, so the img
 * is shifted down half its height to sit CENTRED on the route point.
 */
export function carContent(color = '#0E8C92'): HTMLElement {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">` +
    `<circle cx="17" cy="17" r="16" fill="#fff" stroke="${color}" stroke-width="2"/>` +
    `<path d="M9 19.5c0-.4.1-.8.3-1.1l1.3-2.2c.3-.6.9-.9 1.6-.9h7.6c.7 0 1.3.3 1.6.9l1.3 2.2c.2.3.3.7.3 1.1V22a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-.5h-9V22a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2.5z" fill="${color}"/>` +
    `<circle cx="12.5" cy="21.5" r="1.4" fill="#0A2E36"/><circle cx="21.5" cy="21.5" r="1.4" fill="#0A2E36"/></svg>`;
  const img = document.createElement('img');
  img.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  img.width = 28;
  img.height = 28;
  img.alt = '';
  img.style.transform = 'translateY(50%)';
  return img;
}

/** Normalise a marker position (LatLng | LatLngLiteral | null) to a plain literal. */
export function toLatLng(
  pos: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined,
): google.maps.LatLngLiteral | null {
  if (!pos) return null;
  const ll = pos as google.maps.LatLng;
  if (typeof ll.lat === 'function') return { lat: ll.lat(), lng: ll.lng() };
  const lit = pos as google.maps.LatLngLiteral;
  return { lat: lit.lat, lng: lit.lng };
}
