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

/**
 * A branded Belle Mare Tours activity marker (AdvancedMarkerElement `content`): a rounded pill with
 * the brand mark (the tropical favicon) + the from-price. `selected` (an AI-recommended activity for
 * the active day) fills the pill coral with a gentle pop, so recommendations read louder than the
 * browse layer around them. Pure DOM (no PinElement) so the shape stays ours.
 */
export function bmtMarkerContent(opts: { priceLabel: string; selected?: boolean }): HTMLElement {
  const { priceLabel, selected = false } = opts;
  const coral = '#F76C5E';
  const pill = document.createElement('div');
  pill.style.cssText =
    `display:flex;align-items:center;gap:5px;padding:3px 9px 3px 3px;border-radius:999px;` +
    `border:2px solid ${coral};box-shadow:0 4px 12px rgba(10,46,54,.28);cursor:pointer;` +
    `font:800 12px/1 system-ui,sans-serif;transition:transform .15s ease;` +
    (selected
      ? `background:${coral};color:#fff;transform:scale(1.08);`
      : `background:#fff;color:#0A2E36;`);
  // The brand mark — the same tropical icon as the site favicon (served by app/icon.svg).
  const badge = document.createElement('img');
  badge.src = '/icon.svg';
  badge.alt = '';
  badge.width = 18;
  badge.height = 18;
  badge.style.cssText = 'display:block;border-radius:6px;';
  const price = document.createElement('span');
  price.textContent = priceLabel;
  pill.append(badge, price);
  return pill;
}

/** The dinner-suggestion marker: a small white circle with a teal fork & knife. Visually distinct
 *  from numbered stops (it isn't part of the drive) and from the coral BMT pills. */
export function dinnerMarkerContent(): HTMLElement {
  const teal = '#0E8C92';
  const el = document.createElement('div');
  el.style.cssText =
    `display:grid;place-items:center;width:30px;height:30px;border-radius:999px;background:#fff;` +
    `border:2px solid ${teal};box-shadow:0 3px 10px rgba(10,46,54,.25);`;
  el.innerHTML =
    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">` +
    `<path d="M7 3v7a2 2 0 0 0 2 2v9M7 3v4M11 3v7a2 2 0 0 1-2 2M11 3v4M17 3c-1.7 1-2.5 3-2.5 5.5 0 2 .8 3 2 3.5v9M17 3v18" ` +
    `stroke="${teal}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  return el;
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
