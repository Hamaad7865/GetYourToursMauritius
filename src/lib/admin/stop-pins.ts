import { lookupPlaceCoords } from '@/lib/maps/place-coords';
import { onMauritius, type Pin } from '@/lib/maps/osm-pin';

/**
 * Give every itinerary stop (and swappable alternative) a stored map pin when the tour is saved, so
 * the public page reads coordinates instead of paying Google to geocode the stop for every visitor.
 * Automatic — nobody has to run a script when a stop is added.
 *
 * A stop that already has a pin keeps it (hand-placed pins are never overwritten); renaming a stop
 * clears its pin in the editor, so the new name is looked up afresh here.
 */

type Pinnable = { title: string; lat?: number | null; lng?: number | null };
type StopLike = Pinnable & { options: Pinnable[] };

export const hasPin = (s: Pinnable): boolean =>
  typeof s.lat === 'number' &&
  typeof s.lng === 'number' &&
  Number.isFinite(s.lat) &&
  Number.isFinite(s.lng);

/** Server batch cap (see placePinsRequestSchema). More new names than this in one save: the rest are
 *  pinned on the next save. */
export const MAX_PIN_LOOKUPS = 12;

export type PinRequest = (names: string[]) => Promise<Record<string, Pin | null>>;

/**
 * Fills missing pins: the stored table first (no network), then one batched server lookup
 * (OpenStreetMap). Never throws — a failed lookup just leaves the stop unpinned and named in
 * `unpinned`, so the save itself always goes ahead.
 */
export async function pinItinerary<S extends StopLike>(
  stops: S[],
  request: PinRequest,
): Promise<{ stops: S[]; unpinned: string[] }> {
  const local = new Map<string, Pin | null>();
  const ask: string[] = [];
  const visit = (p: Pinnable) => {
    const title = p.title.trim();
    if (!title || hasPin(p) || local.has(title)) return;
    const stored = lookupPlaceCoords(title);
    if (stored !== undefined) local.set(title, stored);
    else if (!ask.includes(title)) ask.push(title);
  };
  for (const s of stops) {
    visit(s);
    s.options.forEach(visit);
  }

  let fetched: Record<string, Pin | null> = {};
  if (ask.length) {
    try {
      fetched = await request(ask.slice(0, MAX_PIN_LOOKUPS));
    } catch {
      fetched = {};
    }
  }

  const unpinned: string[] = [];
  const apply = <P extends Pinnable>(p: P): P => {
    const title = p.title.trim();
    if (!title || hasPin(p)) return p;
    const pin = local.has(title) ? local.get(title) : fetched[title];
    if (pin) return { ...p, lat: pin.lat, lng: pin.lng };
    // A table-known generic phrase ("Pick-up at all parts of the island") is not a place: no pin,
    // and nothing to report — the map simply leaves it out.
    if (!(local.has(title) && local.get(title) === null) && !unpinned.includes(title)) {
      unpinned.push(title);
    }
    return p;
  };
  return {
    stops: stops.map((s) => ({ ...apply(s), options: s.options.map(apply) })),
    unpinned,
  };
}

type FrStop = { title?: string; lat?: number; lng?: number; options?: FrOption[] } & Record<
  string,
  unknown
>;
type FrOption = { title?: string; lat?: number; lng?: number } & Record<string, unknown>;

/**
 * The French page reads the translation's own `extra.itinerary` (a shallow `a.extra || t.extra`
 * merge replaces the English array whole), so its stops need pins too. They are the same stops in
 * the same order, so pins are copied BY POSITION — only when the stop counts match (otherwise the
 * positions can't be trusted), and never over a pin the French stop already has. Pure. Returns null
 * when nothing changed.
 */
export function copyPinsByPosition(frStops: unknown, enStops: StopLike[]): FrStop[] | null {
  if (!Array.isArray(frStops) || frStops.length !== enStops.length) return null;
  let changed = false;
  const take = <T extends FrOption>(fr: T, en: Pinnable): T => {
    if (hasPin(fr as Pinnable) || !hasPin(en)) return fr;
    changed = true;
    return { ...fr, lat: en.lat as number, lng: en.lng as number };
  };
  const out = (frStops as FrStop[]).map((fr, i) => {
    if (!fr || typeof fr !== 'object') return fr;
    const en = enStops[i]!;
    const next = take(fr, en);
    const opts = Array.isArray(fr.options) ? fr.options : null;
    if (opts && opts.length === en.options.length) {
      return { ...next, options: opts.map((o, oi) => take(o, en.options[oi]!)) };
    }
    return next;
  });
  return changed ? out : null;
}

/** Parse a pasted "lat, lng" (what Google Maps copies on right-click: "-20.29163, 57.77963"). Only an
 *  on-island point is accepted — a swapped or foreign pair returns null. */
export function parseLatLng(text: string): Pin | null {
  const m = text.match(
    /^\s*\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?\s*$/,
  );
  if (!m) return null;
  const pin = { lat: Number(Number(m[1]).toFixed(5)), lng: Number(Number(m[2]).toFixed(5)) };
  return onMauritius(pin) ? pin : null;
}
