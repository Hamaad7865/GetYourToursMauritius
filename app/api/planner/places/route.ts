import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { rateLimit } from '@/lib/http/rate-limit';
import { getServerEnv } from '@/lib/config/env';
import { searchGooglePlaces, placeDetailsByIds } from '@/lib/maps/google-places';
import { nominatimSearch } from '@/lib/maps/osm-pin';
import { geoPointId } from '@/lib/geo/pickup-name';
import type { PlannerPlace } from '@/lib/validation/planner';

export const runtime = 'edge';

function mapsKey(): string | null {
  const env = getServerEnv();
  return env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
}

/**
 * GET /api/planner/places — live place discovery for the AI Road Trip Planner, from Google Places
 * (New). `?q=` free text, `?category=`, `?region=` for browse; `?ids=a,b` resolves specific places
 * (the AI's chosen ids + shareable deep-links). Cached at the edge since places change rarely.
 *
 * Public + unauthenticated, and a cache MISS calls the billed Places (New) API, so it is wallet-DoS-prone.
 * Per-IP rate limit (DB-backed, defence in depth) caps floods BEFORE the upstream call; Cloudflare is the
 * edge backstop. The limit runs ahead of the early empty-key return so an unconfigured key can't be probed.
 */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  await rateLimit(req, 'planner:places', 30);
  const key = mapsKey();
  if (!key) return jsonOk([]);

  const url = new URL(req.url);
  const ids = url.searchParams.get('ids');
  const q = url.searchParams.get('q')?.trim();
  const pickupBox = url.searchParams.get('pages') === '1';
  const search = ids
    ? await placeDetailsByIds(
        ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 25),
        key,
      )
    : await searchGooglePlaces(
        {
          query: url.searchParams.get('q') ?? undefined,
          category: url.searchParams.get('category') ?? undefined,
          region: url.searchParams.get('region') ?? undefined,
          // The pick-up box shows 6 results: one page (one billed request) is plenty.
          maxPages: url.searchParams.get('pages') === '1' ? 1 : undefined,
        },
        key,
      );

  let places: PlannerPlace[];
  try {
    places = await search;
  } catch (err) {
    // The pick-up box must keep finding hotels when Google refuses (Nov 2026: an unpaid Google bill
    // made every search 403 and customers typed half-names or dropped bare coordinates). Fall back
    // to OpenStreetMap for that one caller; everything else still reports the failure.
    if (!pickupBox || !q) throw err;
    const osm = await nominatimSearch(q);
    if (!osm.length) throw err;
    places = osm.map((p) => ({
      id: geoPointId(p.lat, p.lng),
      name: p.name,
      category: p.kind,
      region: p.area,
      lat: p.lat,
      lng: p.lng,
      durationMin: 0,
      closesAt: null,
      blurb: null,
      imageUrl: null,
    }));
    // Short cache: when Google is back, its richer results should return within minutes.
    return jsonOk(places, { headers: { 'Cache-Control': 'public, s-maxage=300' } });
  }

  return jsonOk(places, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
