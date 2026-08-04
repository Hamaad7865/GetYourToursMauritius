/**
 * The guest's OWN hotel, carried across the unlisted-hotel handoff.
 *
 * The transfer search lets a guest pick any place in Mauritius via Google Places, then routes them
 * to the nearest LISTED hotel's page — that page owns the airport zone and therefore the fixed
 * fare. Before this existed, the handoff dropped the guest's hotel entirely: search "Veranda Palmar
 * Beach" and everything from the H1 to the booking's driver-facing dropoff said "The Residence
 * Mauritius" instead. The fare was right; the words were wrong everywhere it mattered.
 *
 * So the pick travels in the URL (?hotel=&hlat=&hlng=), and this module is the single gate that
 * text passes through: TransferSearch and AirportQuote write it with `guestHotelQuery`, the
 * per-hotel page reads it with `parseGuestHotel`. It is guest-controlled input that ends up in an
 * H1, a map pin and a booking payload — parse defensively, never trust a consumer to clean it.
 */

export interface GuestHotel {
  name: string;
  lat?: number;
  lng?: number;
}

/** Mauritius bounding box (generous). A coordinate outside it is a tampered or mangled URL. */
const LAT_MIN = -20.7;
const LAT_MAX = -19.8;
const LNG_MIN = 57.2;
const LNG_MAX = 58.0;

const NAME_MAX = 80;

// Control characters (C0 range + DEL). Built with fromCharCode so no raw control byte and no
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'g',
);

type ParamValue = string | string[] | undefined;

function first(v: ParamValue): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** ?hotel=&hlat=&hlng= → a clean GuestHotel, or null when no usable hotel name is present. */
export function parseGuestHotel(params: {
  hotel?: ParamValue;
  hlat?: ParamValue;
  hlng?: ParamValue;
}): GuestHotel | null {
  const raw = first(params.hotel);
  if (!raw) return null;
  const name = raw
    // Markup-significant characters — the name reaches an H1 and a booking payload.
    .replace(/[<>"'`]/g, '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  if (!name) return null;

  const lat = Number(first(params.hlat));
  const lng = Number(first(params.hlng));
  const inMauritius =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= LAT_MIN &&
    lat <= LAT_MAX &&
    lng >= LNG_MIN &&
    lng <= LNG_MAX;
  // Coordinates are all-or-nothing: half a position can only mislead the map.
  return inMauritius ? { name, lat, lng } : { name };
}

/** The query-string fragment the pickers append to the listed hotel's path. */
export function guestHotelQuery(name: string, lat?: number, lng?: number): string {
  const q = new URLSearchParams({ hotel: name });
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    q.set('hlat', lat.toFixed(5));
    q.set('hlng', lng.toFixed(5));
  }
  return q.toString();
}
