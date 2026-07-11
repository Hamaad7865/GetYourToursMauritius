/* Keyless Google Maps URLs — these open Google Maps in a new tab and require NO API key or
 * billing, so they're a reliable fallback whenever the JS Maps API isn't available. */

function withCountry(s: string): string {
  return /mauritius/i.test(s) ? s : `${s}, Mauritius`;
}

/** A "search" deep-link that drops a pin on the given place. */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(withCountry(query))}`;
}

/** A "directions" deep-link routing through every stop in order. */
export function mapsDirectionsUrl(stops: string[]): string {
  const pts = stops.map(withCountry);
  if (pts.length === 1) return mapsSearchUrl(pts[0]!);
  const origin = encodeURIComponent(pts[0]!);
  const destination = encodeURIComponent(pts[pts.length - 1]!);
  const waypoints = pts
    .slice(1, -1)
    .map((s) => encodeURIComponent(s))
    .join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${
    waypoints ? `&waypoints=${waypoints}` : ''
  }&travelmode=driving`;
}
