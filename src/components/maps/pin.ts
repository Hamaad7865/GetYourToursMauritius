/* Brand-coloured teardrop pin as a data-URI marker icon for the Google Maps JS API.
 * Called only after the API is ready (it references the `google` global at call time).
 * `hollow` renders an outline pin (white fill + coloured border + coloured dot) — used for
 * swappable "other" stops, so they read as secondary against the solid "main" stops. */
export function pinIcon(color: string, opts?: { hollow?: boolean }): google.maps.Icon {
  const hollow = opts?.hollow ?? false;
  const svg = hollow
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">` +
      `<path d="M15 1.2C7.4 1.2 1.2 7.4 1.2 15c0 9.4 13.8 22 13.8 22s13.8-12.6 13.8-22C28.8 7.4 22.6 1.2 15 1.2z" fill="#ffffff" stroke="${color}" stroke-width="2.4"/>` +
      `<circle cx="15" cy="15" r="5.5" fill="${color}"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">` +
      `<path d="M15 0C6.7 0 0 6.7 0 15c0 9.7 15 23 15 23s15-13.3 15-23C30 6.7 23.3 0 15 0z" fill="${color}"/>` +
      `<circle cx="15" cy="15" r="11" fill="rgba(255,255,255,.22)"/></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(30, 38),
    anchor: new google.maps.Point(15, 38),
    labelOrigin: new google.maps.Point(15, 14),
  };
}

/** Numbered label styling for a route-stop marker. `color` is the digit colour — white on a solid
 *  pin, brand teal on a hollow (white) pin so the number stays legible. */
export function pinLabel(n: number, color = '#ffffff'): google.maps.MarkerLabel {
  return { text: String(n), color, fontSize: '12px', fontWeight: '700' };
}

/** A small car marker (data-URI SVG) for animating along the route. */
export function carIcon(): google.maps.Icon {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">` +
    `<circle cx="17" cy="17" r="16" fill="#fff" stroke="#0E8C92" stroke-width="2"/>` +
    `<path d="M9 19.5c0-.4.1-.8.3-1.1l1.3-2.2c.3-.6.9-.9 1.6-.9h7.6c.7 0 1.3.3 1.6.9l1.3 2.2c.2.3.3.7.3 1.1V22a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-.5h-9V22a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2.5z" fill="#0E8C92"/>` +
    `<circle cx="12.5" cy="21.5" r="1.4" fill="#0A2E36"/><circle cx="21.5" cy="21.5" r="1.4" fill="#0A2E36"/></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(28, 28),
    anchor: new google.maps.Point(14, 14),
  };
}
