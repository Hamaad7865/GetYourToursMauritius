import { ProviderError } from '@/lib/services/errors';
import { cacheGet, cacheSet } from './places-cache';
import type { PlannerPlace } from '@/lib/validation/planner';

const SEARCH_TTL_MS = 6 * 60 * 60 * 1000; // searches: 6h
const DETAILS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // place details: 30d (rarely change)

/**
 * Google Places API (New) client for the AI Road Trip Planner — live place discovery instead of a
 * seeded set. Text Search (browse + co-pilot) and Place Details (resolve ids / deep-links), mapped
 * into our `PlannerPlace` shape. Edge-compatible (native fetch). Restricted to Mauritius. The pure
 * mappers (category/region/duration/hours) are exported for unit tests.
 */
const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_BASE = 'https://places.googleapis.com/v1/places/';
const FIELDS =
  'places.id,places.displayName,places.location,places.types,places.primaryType,places.editorialSummary,places.regularOpeningHours,places.photos,nextPageToken';
const DETAIL_FIELDS = 'id,displayName,location,types,primaryType,editorialSummary,regularOpeningHours,photos';

/** Categories aggregated for the default "All" browse, so it shows a broad set (not just 20). */
const BROWSE_CATEGORIES = ['Beach', 'Waterfall', 'Viewpoint', 'Nature', 'Culture', 'Garden', 'Island', 'Landmark', 'Market'];

/** Mauritius bounding box — restricts results to the island. */
const MU_RECT = { low: { latitude: -20.55, longitude: 57.29 }, high: { latitude: -19.95, longitude: 57.81 } };

export interface PlacesSearchArgs {
  query?: string;
  category?: string;
  region?: string;
}

// ── pure mappers ────────────────────────────────────────────────────────────

/** Coarse N/S/E/W/Central region from Mauritius coordinates (rough, for the filter chips). */
export function regionFromCoords(lat: number, lng: number): string {
  if (lat >= -20.08) return 'North';
  if (lat <= -20.42) return 'South';
  if (lng >= 57.63) return 'East';
  if (lng <= 57.43) return 'West';
  return 'Central';
}

/** Best-effort map from Google place types + name to our planner categories. */
export function categoryFromTypes(types: string[], name: string): string {
  const t = new Set(types);
  const n = name.toLowerCase();
  if (/\b(waterfall|falls|cascade)\b/.test(n)) return 'Waterfall';
  if (/\b(viewpoint|view point|lookout|summit|peak|mountain|gorge|crater)\b/.test(n)) return 'Viewpoint';
  if (n.includes('île') || /\b(island|islet|ilot|ile)\b/.test(n)) return 'Island';
  if (/\b(garden|jardin)\b/.test(n) || t.has('garden') || t.has('botanical_garden')) return 'Garden';
  if (t.has('beach')) return 'Beach';
  if (t.has('market')) return 'Market';
  if (
    t.has('hindu_temple') || t.has('church') || t.has('mosque') || t.has('place_of_worship') ||
    t.has('museum') || t.has('art_gallery') || t.has('historical_place')
  )
    return 'Culture';
  if (
    t.has('national_park') || t.has('park') || t.has('hiking_area') || t.has('zoo') ||
    t.has('wildlife_park') || t.has('wildlife_refuge') || t.has('natural_feature')
  )
    return 'Nature';
  if (/\b(beach|plage)\b/.test(n)) return 'Beach';
  if (/\b(temple|church|museum|fort|heritage|cultural)\b/.test(n)) return 'Culture';
  if (/\b(park|reserve|forest|nature)\b/.test(n)) return 'Nature';
  return 'Landmark';
}

/** Sensible default "time to spend" per category (Google doesn't provide one). */
export function durationForCategory(category: string): number {
  const map: Record<string, number> = {
    Beach: 120, Waterfall: 60, Viewpoint: 30, Nature: 150, Culture: 60,
    Garden: 90, Island: 180, Market: 60, Landmark: 60, Food: 75,
  };
  return map[category] ?? 90;
}

interface OpeningHours {
  periods?: Array<{ close?: { hour?: number; minute?: number } }>;
}
/** A representative closing time "HH:MM" from Google opening hours, or null (open-access / 24h). */
export function closesAtFromHours(hours: OpeningHours | undefined): string | null {
  const close = hours?.periods?.find((p) => p.close && typeof p.close.hour === 'number')?.close;
  if (!close || typeof close.hour !== 'number') return null;
  const h = String(close.hour).padStart(2, '0');
  const m = String(close.minute ?? 0).padStart(2, '0');
  return `${h}:${m}`;
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  editorialSummary?: { text?: string };
  regularOpeningHours?: OpeningHours;
  photos?: Array<{ name?: string }>;
}

/** Our photo proxy URL for a Google photo resource name (keeps the API key server-side). */
export function photoProxyUrl(photoName: string): string {
  return `/api/planner/photo?ref=${encodeURIComponent(photoName)}`;
}

/** Map one Google place to our PlannerPlace, or null if it lacks the essentials. */
export function mapGooglePlace(raw: RawPlace): PlannerPlace | null {
  const id = raw.id;
  const name = raw.displayName?.text;
  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  if (!id || !name || typeof lat !== 'number' || typeof lng !== 'number') return null;
  const category = categoryFromTypes(raw.types ?? [], name);
  const photoName = raw.photos?.[0]?.name;
  return {
    id,
    name,
    category,
    region: regionFromCoords(lat, lng),
    lat,
    lng,
    durationMin: durationForCategory(category),
    closesAt: closesAtFromHours(raw.regularOpeningHours),
    blurb: raw.editorialSummary?.text ?? null,
    imageUrl: photoName ? photoProxyUrl(photoName) : null,
  };
}

/** Build the Text Search query from a free-text term and/or a category. */
function buildQuery(args: PlacesSearchArgs): string {
  const q = args.query?.trim();
  if (q) return `${q} in Mauritius`;
  const cat = args.category && args.category !== 'All' ? args.category : null;
  const byCat: Record<string, string> = {
    Beach: 'best beaches', Waterfall: 'waterfalls', Viewpoint: 'scenic viewpoints and lookouts',
    Nature: 'nature parks and reserves', Culture: 'temples, museums and cultural sites',
    Garden: 'botanical gardens', Island: 'islands and islets to visit', Market: 'local markets',
    Landmark: 'famous landmarks',
  };
  return cat ? `${byCat[cat] ?? cat} in Mauritius` : 'top tourist attractions in Mauritius';
}

// ── API calls ───────────────────────────────────────────────────────────────

/** One Text Search page. Returns the mapped places + a token for the next page (if any). */
async function searchTextPage(
  textQuery: string,
  apiKey: string,
  pageToken?: string,
): Promise<{ places: PlannerPlace[]; nextPageToken?: string }> {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({
      textQuery,
      locationRestriction: { rectangle: MU_RECT },
      pageSize: 20,
      regionCode: 'MU',
      languageCode: 'en',
      ...(pageToken ? { pageToken } : {}),
    }),
  });
  if (!res.ok) throw new ProviderError(`Places searchText HTTP ${res.status}`);
  const data = (await res.json()) as { places?: RawPlace[]; nextPageToken?: string };
  return {
    places: (data.places ?? []).map(mapGooglePlace).filter((p): p is PlannerPlace => p !== null),
    nextPageToken: data.nextPageToken,
  };
}

/** A full search for one query, paginated up to `maxPages` (≤3 → up to ~60 results), cached. */
async function searchTextCached(textQuery: string, apiKey: string, maxPages: number): Promise<PlannerPlace[]> {
  const cacheKey = `s:${textQuery}|${maxPages}`;
  const hit = await cacheGet<PlannerPlace[]>(cacheKey);
  if (hit) return hit;
  const out: PlannerPlace[] = [];
  let token: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    let res: { places: PlannerPlace[]; nextPageToken?: string };
    try {
      res = await searchTextPage(textQuery, apiKey, token);
    } catch (err) {
      if (page === 0) throw err; // a first-page failure is a real error
      break; // later pages: keep what we already have
    }
    out.push(...res.places);
    token = res.nextPageToken;
    if (!token) break;
  }
  await cacheSet(cacheKey, out, SEARCH_TTL_MS);
  return out;
}

function dedupeById(places: PlannerPlace[]): PlannerPlace[] {
  const seen = new Set<string>();
  const out: PlannerPlace[] = [];
  for (const p of places) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/**
 * Live place discovery, mapped to PlannerPlace[]. The default "All" browse aggregates across
 * categories (one page each) for a broad set — not just 20; a specific category or free-text search
 * paginates up to ~60. Region is filtered after the cache so region variants reuse one set of calls.
 */
export async function searchGooglePlaces(args: PlacesSearchArgs, apiKey: string): Promise<PlannerPlace[]> {
  const q = args.query?.trim();
  const cat = args.category && args.category !== 'All' ? args.category : null;
  let places: PlannerPlace[];
  if (!q && !cat) {
    const lists = await Promise.all(BROWSE_CATEGORIES.map((c) => searchTextCached(buildQuery({ category: c }), apiKey, 1)));
    places = dedupeById(lists.flat());
  } else {
    places = await searchTextCached(buildQuery(args), apiKey, 3);
  }
  if (args.region && args.region !== 'All') return places.filter((p) => p.region === args.region);
  return places;
}

/** Resolve specific place ids via Place Details (for the AI's chosen ids + shareable deep-links).
 *  Per-id cached, so only the ids we haven't seen are fetched. */
export async function placeDetailsByIds(ids: string[], apiKey: string): Promise<PlannerPlace[]> {
  const results = await Promise.all(
    ids.map(async (id) => {
      const cached = await cacheGet<PlannerPlace>(`d:${id}`);
      if (cached) return cached;
      try {
        const res = await fetch(`${DETAILS_BASE}${encodeURIComponent(id)}`, {
          headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': DETAIL_FIELDS },
        });
        if (!res.ok) return null;
        const place = mapGooglePlace((await res.json()) as RawPlace);
        if (place) await cacheSet(`d:${place.id}`, place, DETAILS_TTL_MS);
        return place;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((p): p is PlannerPlace => p !== null);
}
