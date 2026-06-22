/* Draw the real driving route between ordered points using the Routes API (the successor to the
 * deprecated DirectionsService/Renderer). Called only after the Maps JS API (with the `routes` library)
 * is ready. Returns the created Polylines (already added to the map — track them to remove later) and the
 * route path, or null when Routes is unavailable. Throws on a denied/disabled key so callers can stop
 * retrying. */
export async function drawRoute(
  map: google.maps.Map,
  points: google.maps.LatLngLiteral[],
  opts?: { strokeColor?: string; strokeWeight?: number; strokeOpacity?: number },
): Promise<{ polylines: google.maps.Polyline[]; path: google.maps.LatLngLiteral[] } | null> {
  if (points.length < 2) return null;
  const { routes } = await google.maps.routes.Route.computeRoutes({
    origin: points[0]!,
    destination: points[points.length - 1]!,
    intermediates: points.slice(1, -1).map((location) => ({ location })),
    travelMode: google.maps.TravelMode.DRIVING,
    fields: ['path'],
  });
  const route = routes?.[0];
  if (!route?.path?.length) return null;
  const polylines = route.createPolylines({
    polylineOptions: {
      strokeColor: opts?.strokeColor ?? '#0E8C92',
      strokeWeight: opts?.strokeWeight ?? 4,
      strokeOpacity: opts?.strokeOpacity ?? 0.9,
    },
  });
  polylines.forEach((pl) => pl.setMap(map));
  // LatLngAltitude exposes lat/lng as number getters (not methods).
  const path = route.path.map((p) => ({ lat: p.lat, lng: p.lng }));
  return { polylines, path };
}
