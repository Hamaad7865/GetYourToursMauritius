import { lookupPlaceCoords } from '@/lib/maps/place-coords';
import { onMauritius, type Pin } from '@/lib/maps/osm-pin';

/**
 * Typed pickup text → a map pin, for when the customer typed their hotel but never picked it from the
 * suggestions or dragged the pin. Without a pin api_book charges no transport add-on, so checkout
 * resolves the text itself before leaving step ①.
 *
 * Order: the stored place table (free) → OpenStreetMap from the browser (free; Nominatim refuses
 * Cloudflare's servers, not visitors) → Google's Geocoder last (billed, and refused while the Google
 * bill was unpaid in Nov 2026). OSM is asked with the full text, then with just the part before the
 * first comma — a pasted "Shangri-La, Belle Mare, Poste de Flacq, Flacq 41511" is too specific for it.
 *
 * Providers are injected so this stays testable and framework-free. Never throws: null = not found.
 */
export async function resolvePickupText(
  text: string,
  deps: {
    nominatim: (query: string) => Promise<Pin | null>;
    google: (query: string) => Promise<Pin | null>;
  },
): Promise<Pin | null> {
  const full = text.trim();
  if (!full) return null;

  const stored = lookupPlaceCoords(full);
  if (stored) return stored;

  const ok = (p: Pin | null | undefined): p is Pin =>
    !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && onMauritius(p);

  const head = full.split(',')[0]!.trim();
  const queries = head && head !== full ? [full, head] : [full];
  for (const q of queries) {
    try {
      const pin = await deps.nominatim(q);
      if (ok(pin)) return pin;
    } catch {
      break; // unreachable / rate-limited — a second OSM call won't fare better; try Google
    }
  }

  try {
    const pin = await deps.google(full);
    if (ok(pin)) return pin;
  } catch {
    /* Geocoder unavailable */
  }
  return null;
}
