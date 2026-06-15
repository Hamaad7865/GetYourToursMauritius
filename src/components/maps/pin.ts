/* Brand-coloured teardrop pin as a data-URI marker icon for the Google Maps JS API.
 * Called only after the API is ready (it references the `google` global at call time). */
export function pinIcon(color: string): google.maps.Icon {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">` +
    `<path d="M15 0C6.7 0 0 6.7 0 15c0 9.7 15 23 15 23s15-13.3 15-23C30 6.7 23.3 0 15 0z" fill="${color}"/>` +
    `<circle cx="15" cy="15" r="11" fill="rgba(255,255,255,.22)"/></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(30, 38),
    anchor: new google.maps.Point(15, 38),
    labelOrigin: new google.maps.Point(15, 14),
  };
}

/** Numbered label styling for a route-stop marker. */
export function pinLabel(n: number): google.maps.MarkerLabel {
  return { text: String(n), color: '#ffffff', fontSize: '12px', fontWeight: '700' };
}
